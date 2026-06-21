import type { AIActorDef, ActorEdgeDef, ActorGraph, CanticaPrompt, CanticaServer, LogEntry, McpLogEntry, PromptEventDef, PromptRef } from './types/index.js';

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export class StudioClient {
  private readonly baseUrl: string;
  private readonly getAuth: (() => string | null) | undefined;
  onLog?: (entry: LogEntry) => void;

  constructor(baseUrl = 'http://localhost:8043', getAuth?: () => string | null) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getAuth = getAuth;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async _fetch(path: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const t0 = Date.now();
    const token = this.getAuth?.();
    let requestInit = init;
    if (token) {
      const base = (init?.headers as Record<string, string> | undefined) ?? {};
      requestInit = { ...init, headers: { ...base, Authorization: `Bearer ${token}` } };
    }
    const r = await fetch(this.url(path), requestInit);
    this.onLog?.({ ts: t0, method, url: path, status: r.status, durationMs: Date.now() - t0 });
    return r;
  }

  async fetchResolvedModel(actorName: string): Promise<string | null> {
    try {
      const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(actorName)}/model`);
      if (!r.ok) return null;
      const data = (await r.json()) as { resolved_model: string | null };
      return data.resolved_model ?? null;
    } catch {
      return null;
    }
  }

  async registerClientKey(clientId: string, publicKeyPem: string): Promise<void> {
    const r = await fetch(this.url('/v1/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, public_key_pem: publicKeyPem }),
    });
    if (!r.ok) throw new Error(`Registration failed [${r.status}]: ${await r.text()}`);
  }

  async ping(): Promise<{ ok: boolean; serverId?: string; version?: string; uptimeSeconds?: number; workspace?: string; containerized?: boolean }> {
    try {
      const r = await fetch(this.url('/health'), { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return { ok: false };
      const d = await r.json() as Record<string, unknown>;
      return {
        ok: true,
        ...(typeof d['server_id'] === 'string' ? { serverId: d['server_id'] } : {}),
        ...(typeof d['version'] === 'string' ? { version: d['version'] } : {}),
        ...(typeof d['uptime_seconds'] === 'number' ? { uptimeSeconds: d['uptime_seconds'] as number } : {}),
        ...(typeof d['workspace'] === 'string' ? { workspace: d['workspace'] } : {}),
        ...(typeof d['containerized'] === 'boolean' ? { containerized: d['containerized'] as boolean } : {}),
      };
    } catch {
      return { ok: false };
    }
  }

  // ── Graph ────────────────────────────────────────────────────────────────────

  async loadGraph(filePath?: string): Promise<ActorGraph | null> {
    try {
      const r = await this._fetch('/v1/graph');
      if (!r.ok) return null;
      const raw = (await r.json()) as Record<string, unknown>;
      return parseGraph(raw, filePath);
    } catch {
      return null;
    }
  }

  async saveGraph(graph: ActorGraph): Promise<void> {
    const r = await this._fetch('/v1/graph', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ data: serializeGraph(graph) }),
    });
    if (!r.ok) throw new Error(`Save failed: ${r.status}`);
  }

  // ── Prompts ──────────────────────────────────────────────────────────────────

  /**
   * Push provider API keys into the server's database.
   * Called after the server starts to ensure the DB holds the current keys
   * regardless of whether the server was started via the extension or manually.
   *
   * Each non-empty key is upserted as a provider + "setup" token. Empty keys
   * are silently skipped (existing DB entries are left untouched).
   */
  async syncProviderKeys(keys: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    geminiApiKey?: string;
    githubToken?: string;
  }): Promise<void> {
    const entries: { type: string; name: string; token: string }[] = [
      { type: 'claude',  name: 'Anthropic',      token: keys.anthropicApiKey ?? '' },
      { type: 'gpt',    name: 'OpenAI',          token: keys.openaiApiKey    ?? '' },
      { type: 'gemini', name: 'Google Gemini',   token: keys.geminiApiKey    ?? '' },
      { type: 'copilot',name: 'GitHub Copilot',  token: keys.githubToken     ?? '' },
    ];

    for (const { type, name, token } of entries) {
      if (!token.trim()) continue;
      try {
        // List providers to find or create the one for this type.
        const lr = await this._fetch('/v1/providers', { signal: AbortSignal.timeout(5000) });
        if (!lr.ok) continue;
        const providers = await lr.json() as { id: string; type: string }[];
        let provider = providers.find(p => p.type === type);

        if (!provider) {
          const cr = await this._fetch('/v1/providers', {
            method: 'POST',
            body: JSON.stringify({ name, type }),
            signal: AbortSignal.timeout(5000),
          });
          if (!cr.ok) continue;
          provider = await cr.json() as { id: string; type: string };
        }

        // List existing tokens; upsert the "setup" labelled one.
        const tr = await this._fetch(`/v1/providers/${provider.id}/tokens`, { signal: AbortSignal.timeout(5000) });
        if (!tr.ok) continue;
        const tokens = await tr.json() as { id: string; label: string }[];
        const existing = tokens.find(t => t.label === 'setup');

        if (existing) {
          // Delete and recreate to update the value (no PATCH on tokens).
          await this._fetch(`/v1/providers/${provider.id}/tokens/${existing.id}`, {
            method: 'DELETE', signal: AbortSignal.timeout(5000),
          });
        }

        await this._fetch(`/v1/providers/${provider.id}/tokens`, {
          method: 'POST',
          body: JSON.stringify({ label: 'setup', token }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Non-fatal — server may still be starting
      }
    }
  }

  async fetchProviderModels(refresh = false): Promise<Record<string, string[]>> {
    try {
      const path = refresh ? '/v1/models?refresh=true' : '/v1/models';
      const r = await this._fetch(path, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return {};
      return r.json() as Promise<Record<string, string[]>>;
    } catch {
      return {};
    }
  }

  async fetchPrompts(_servers: CanticaServer[]): Promise<CanticaPrompt[]> {
    // Ask the studio API which aggregates from all configured Cantica servers
    try {
      const r = await this._fetch('/v1/prompts', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      return r.json() as Promise<CanticaPrompt[]>;
    } catch {
      return [];
    }
  }

  // ── Runtime ──────────────────────────────────────────────────────────────────

  async listRunning(): Promise<string[]> {
    const r = await this._fetch('/v1/runtime/actors');
    if (!r.ok) return [];
    return r.json() as Promise<string[]>;
  }

  async startActor(def: AIActorDef): Promise<{ initialOutput: string | null; resolvedModel?: string }> {
    const isCode = def.actorType === 'python' || def.actorType === 'typescript';
    const body = isCode
      ? {
          name: def.name,
          actor_type: def.actorType,
          script_path: def.scriptPath ?? '',
          script_command: def.scriptCommand ?? '',
          ...(def.directory ? { directory: def.directory } : {}),
        }
      : {
          name: def.name,
          define_prompt: def.definePrompt.uri ?? def.definePrompt.content ?? '',
          provider: def.provider,
          model: def.model,
          max_tokens: def.maxTokens,
          max_history: def.maxHistory,
          prompt_events: def.promptEvents.map((e) => ({
            name: e.name,
            prompt: e.prompt.uri ?? e.prompt.content ?? '',
            ...(e.filePattern ? { filePattern: e.filePattern } : {}),
            ...(e.targetActors?.length ? { targetActors: e.targetActors } : {}),
            ...(e.sendResponse ? { sendResponse: true } : {}),
          })),
          cron_jobs: def.cronJobs.map((c) => ({
            ...(c.name ? { name: c.name } : {}),
            schedule: c.schedule,
            prompt: c.prompt.uri ?? c.prompt.content ?? '',
            ...(c.targetActor ? { targetActor: c.targetActor } : {}),
            ...(c.targetEvent ? { targetEvent: c.targetEvent } : {}),
            ...(c.sendResponse ? { sendResponse: true } : {}),
          })),
          outbox: {},
          ...(def.directory ? { directory: def.directory } : {}),
        };
    const r = await this._fetch('/v1/runtime/actors', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch { /* ignore */ }
      throw new Error(`Failed to start actor [${r.status}]${detail ? `: ${detail}` : ''}`);
    }
    const data = (await r.json()) as { initial_output?: string; resolved_model?: string };
    return { initialOutput: data.initial_output ?? null, ...(data.resolved_model ? { resolvedModel: data.resolved_model } : {}) };
  }

  async stopAllActors(): Promise<{ stopped: string[] }> {
    const r = await this._fetch('/v1/runtime/actors', { method: 'DELETE' });
    if (!r.ok) return { stopped: [] };
    return r.json() as Promise<{ stopped: string[] }>;
  }

  async stopActor(name: string): Promise<void> {
    await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async pauseActor(name: string): Promise<void> {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/pause`, {
      method: 'POST', headers: headers(),
    });
    if (!r.ok) throw new Error(`Pause failed [${r.status}]`);
  }

  async resumeActor(name: string): Promise<void> {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/resume`, {
      method: 'POST', headers: headers(),
    });
    if (!r.ok) throw new Error(`Resume failed [${r.status}]`);
  }

  async instructActor(name: string, instruction: string): Promise<{ output: string; resolvedModel?: string }> {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/instruct`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ instruction }),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch { /* ignore */ }
      throw new Error(`Instruct failed [${r.status}]${detail ? `: ${detail}` : ''}`);
    }
    const data = (await r.json()) as { output: string; resolved_model?: string };
    return { output: data.output, ...(data.resolved_model ? { resolvedModel: data.resolved_model } : {}) };
  }

  async drainNotifications(): Promise<Array<{ name: string; prompt: string; output: string }>> {
    try {
      const r = await this._fetch('/v1/runtime/notifications', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return [];
      return r.json() as Promise<Array<{ name: string; prompt: string; output: string }>>;
    } catch {
      return [];
    }
  }

  async drainMcpLog(): Promise<McpLogEntry[]> {
    try {
      const r = await this._fetch('/v1/runtime/mcp-log', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return [];
      return r.json() as Promise<McpLogEntry[]>;
    } catch {
      return [];
    }
  }

  async fireEvent(name: string, eventName: string, context = ''): Promise<{ output: string; forwarded: Array<{ name: string; prompt: string; output: string }> }> {
    const r = await this._fetch(
      `/v1/runtime/actors/${encodeURIComponent(name)}/event/${encodeURIComponent(eventName)}`,
      { method: 'POST', headers: headers(), body: JSON.stringify({ context }) },
    );
    if (!r.ok) throw new Error(`Fire event failed: ${r.status}`);
    const data = (await r.json()) as { output: string; forwarded?: Array<{ name: string; prompt: string; output: string }> };
    return { output: data.output, forwarded: data.forwarded ?? [] };
  }
}

// ── JSON-LD ↔ ActorGraph conversion (host side) ───────────────────────────────

/** DJB2 8-char hex hash of any string. */
function _h(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * Build a compound actor URN from file path, actor name, and provider+model.
 * Format: urn:cantica:studio:actor:{fileHash}:{nameHash}:{modelHash}
 */
function _compoundActorId(filePath: string, name: string, provider: string, model: string): string {
  return `urn:cantica:studio:actor:${_h(filePath)}:${_h(name)}:${_h(`${provider}:${model}`)}`;
}

/**
 * Extract the model-hash segment from a compound or legacy AIActor id.
 * Returns null for ids without a recognisable hash (legacy no-hash or CodeActor).
 */
function _extractModelHash(id: string): string | null {
  const local = id.replace(/^urn:cantica:studio:actor:/, '');
  // New compound format: {8hex}:{8hex}:{8hex}
  const newFmt = local.match(/^[0-9a-f]{8}:[0-9a-f]{8}:([0-9a-f]{8})$/);
  if (newFmt) return newFmt[1] ?? null;
  // Legacy format: actor-{digits}-{digits}-{8hexchars}
  const legacyFmt = local.match(/^actor-\d+-\d+-([0-9a-f]{8})$/);
  return legacyFmt ? (legacyFmt[1] ?? null) : null;
}

export function parseGraph(raw: Record<string, unknown>, filePath?: string): ActorGraph {
  const rawActors = (raw['actors'] ?? []) as Record<string, unknown>[];
  // Map old IDs → new compound IDs so edges can be remapped in the same pass.
  const idMap = new Map<string, string>();
  const actors = rawActors.map(r => {
    const actor = _parseActor(r);
    if (filePath && actor.actorType === 'ai') {
      const newId = _compoundActorId(filePath, actor.name, actor.provider, actor.model);
      if (newId !== actor.id) {
        idMap.set(actor.id, newId);
        return { ...actor, id: newId };
      }
    }
    return actor;
  });
  // Drop: kindless legacy edges AND self-loop edges; remap from/to through idMap.
  const edges = ((raw['edges'] ?? []) as Record<string, unknown>[])
    .map(_parseEdge)
    .filter((e): e is ActorEdgeDef => e !== null)
    .map(e => ({
      ...e,
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }))
    .filter(e => e.from !== e.to);
  return {
    id: (raw['@id'] as string | undefined) ?? 'urn:cantica:studio:graph:default',
    name: (raw['name'] as string | undefined) ?? 'Workflow',
    actors,
    edges,
  };
}

function _parseActor(r: Record<string, unknown>): AIActorDef {
  const pos = (r['position'] as { x?: number; y?: number } | undefined) ?? {};
  const events: PromptEventDef[] = ((r['promptEvents'] ?? []) as Record<string, unknown>[]).map((e) => {
    const fp = e['filePattern'] as string | undefined;
    // Support both new targetActors[] and legacy single targetActor string.
    const tas = e['targetActors'] as string[] | undefined;
    const oldTa = e['targetActor'] as string | undefined;
    const targetActors = tas ?? (oldTa ? [oldTa] : undefined);
    return {
      name: (e['name'] as string) ?? '',
      prompt: _parseRef(e['prompt']),
      ...(fp ? { filePattern: fp } : {}),
      ...(targetActors?.length ? { targetActors } : {}),
      ...(e['sendResponse'] ? { sendResponse: e['sendResponse'] as boolean } : {}),
    };
  });
  const crons = ((r['cronJobs'] ?? []) as Record<string, unknown>[]).map((c) => {
    const cn = c['name'] as string | undefined;
    const ta = c['targetActor'] as string | undefined;
    const te = c['targetEvent'] as string | undefined;
    return {
      ...(cn ? { name: cn } : {}),
      schedule: (c['schedule'] as string) ?? '',
      prompt: _parseRef(c['prompt']),
      ...(ta ? { targetActor: ta } : {}),
      ...(te ? { targetEvent: te } : {}),
      ...(c['sendResponse'] ? { sendResponse: c['sendResponse'] as boolean } : {}),
    };
  });
  const actorType = ((r['actorType'] as string | undefined) ?? 'ai') as 'ai' | 'python' | 'typescript';
  const id = (r['@id'] as string) ?? '';
  const provider = (r['provider'] as string) ?? 'claude';
  const model = (r['model'] as string) ?? 'claude-sonnet-4-6';
  // Detect provider/model mismatch vs what's stored in the ID hash.
  const idModelHash = actorType === 'ai' ? _extractModelHash(id) : null;
  const corrupted = idModelHash !== null && idModelHash !== _h(`${provider}:${model}`);
  return {
    id,
    name: (r['name'] as string) ?? '',
    actorType,
    ...(r['scriptPath'] ? { scriptPath: r['scriptPath'] as string } : {}),
    ...(r['scriptCommand'] ? { scriptCommand: r['scriptCommand'] as string } : {}),
    ...(r['directory'] ? { directory: r['directory'] as string } : {}),
    definePrompt: _parseRef(r['definePrompt']),
    provider,
    model,
    ...(corrupted ? { corrupted: true } : {}),
    maxTokens: (r['maxTokens'] as number) ?? 4096,
    maxHistory: (r['maxHistory'] as number) ?? 10,
    position: { x: (pos.x ?? 0), y: (pos.y ?? 0) },
    promptEvents: events,
    cronJobs: crons,
    resources: ((r['resources'] ?? []) as Record<string, unknown>[]).map((res) => ({
      id: (res['id'] as string) ?? '',
      name: (res['name'] as string) ?? '',
      type: (res['type'] as 'file' | 'api' | 'text' | 'other') ?? 'other',
      uri: (res['uri'] as string) ?? '',
      ...(res['description'] ? { description: res['description'] as string } : {}),
      ...(res['dynamic'] !== undefined ? { dynamic: res['dynamic'] as boolean } : {}),
      ...(res['sharedWith'] ? { sharedWith: res['sharedWith'] as string[] } : {}),
    })),
  };
}

function _parseEdge(r: Record<string, unknown>): ActorEdgeDef | null {
  const kind = r['kind'] as 'event' | 'cron' | undefined;
  if (!kind) return null;  // drop legacy kindless edges (old outbox 'message' edges)
  const te = r['targetEvent'] as string | null | undefined;
  return {
    id: (r['@id'] as string) ?? '',
    from: (r['from'] as string) ?? '',
    to: (r['to'] as string) ?? '',
    ...(te ? { targetEvent: te } : {}),
    prompt: _parseRef(r['prompt']),
    label: (r['label'] as string) ?? '',
    kind,
  };
}

function _parseRef(v: unknown): PromptRef {
  if (typeof v === 'string') return v.startsWith('cantica://') ? { uri: v } : { content: v };
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    const uri = o['uri'] as string | undefined;
    const content = o['content'] as string | undefined;
    return { ...(uri ? { uri } : {}), ...(content ? { content } : {}) };
  }
  return {};  // null or {} both produce an empty PromptRef
}

export function serializeGraph(g: ActorGraph): Record<string, unknown> {
  return {
    '@context': { '@vocab': 'https://cantica.dev/studio/', 'schema': 'http://schema.org/', 'name': 'schema:name' },
    '@type': 'ActorGraph',
    '@id': g.id,
    'name': g.name,
    'actors': g.actors.map(_serializeActor),
    'edges': g.edges.map(_serializeEdge),
  };
}

function _serializeActor(a: AIActorDef): Record<string, unknown> {
  return {
    '@type': a.actorType === 'ai' ? 'AIActor' : 'CodeActor',
    '@id': a.id,
    'name': a.name,
    'actorType': a.actorType ?? 'ai',
    ...(a.scriptPath ? { 'scriptPath': a.scriptPath } : {}),
    ...(a.scriptCommand ? { 'scriptCommand': a.scriptCommand } : {}),
    ...(a.directory ? { 'directory': a.directory } : {}),
    'definePrompt': _serializeRef(a.definePrompt),
    'provider': a.provider,
    'model': a.model,
    'maxTokens': a.maxTokens,
    'maxHistory': a.maxHistory,
    'position': a.position,
    'promptEvents': a.promptEvents.map((e) => ({
      '@type': 'PromptEvent',
      'name': e.name,
      'prompt': _serializeRef(e.prompt),
      ...(e.filePattern ? { 'filePattern': e.filePattern } : {}),
      ...(e.targetActors?.length ? { 'targetActors': e.targetActors } : {}),
      ...(e.sendResponse ? { 'sendResponse': true } : {}),
    })),
    'cronJobs': a.cronJobs.map((c) => ({
      '@type': 'CronJob',
      ...(c.name ? { 'name': c.name } : {}),
      'schedule': c.schedule,
      'prompt': _serializeRef(c.prompt),
      ...(c.targetActor ? { 'targetActor': c.targetActor } : {}),
      ...(c.targetEvent ? { 'targetEvent': c.targetEvent } : {}),
      ...(c.sendResponse ? { 'sendResponse': true } : {}),
    })),
    'resources': (a.resources ?? []).map((res) => ({
      '@type': 'AgentResource',
      'id': res.id,
      'name': res.name,
      'type': res.type,
      'uri': res.uri,
      ...(res.description ? { 'description': res.description } : {}),
      ...(res.dynamic !== undefined ? { 'dynamic': res.dynamic } : {}),
      ...(res.sharedWith?.length ? { 'sharedWith': res.sharedWith } : {}),
    })),
  };
}

function _serializeEdge(e: ActorEdgeDef): Record<string, unknown> {
  return {
    '@type': 'ActorMessage',
    '@id': e.id,
    'from': e.from,
    'to': e.to,
    ...(e.targetEvent ? { 'targetEvent': e.targetEvent } : {}),
    'prompt': _serializeRef(e.prompt),
    'label': e.label,
    'kind': e.kind,
  };
}

function _serializeRef(r: PromptRef): string | null {
  if (r.uri) return r.uri;
  if (r.content) return r.content;
  return null;
}
