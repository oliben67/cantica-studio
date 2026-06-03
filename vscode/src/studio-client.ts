import type { AIActorDef, ActorEdgeDef, ActorGraph, CanticaPrompt, CanticaServer, PromptEventDef, PromptRef } from './types/index.js';

const STUDIO_BASE = 'http://localhost:8043';

function studioUrl(path: string, port: number): string {
  return `http://localhost:${port}${path}`;
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export class StudioClient {
  private readonly port: number;

  constructor(port: number = 8043) {
    this.port = port;
  }

  private url(path: string): string {
    return studioUrl(path, this.port);
  }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(this.url('/health'), { signal: AbortSignal.timeout(4000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  // ── Graph ────────────────────────────────────────────────────────────────────

  async loadGraph(): Promise<ActorGraph | null> {
    try {
      const r = await fetch(this.url('/v1/graph'));
      if (!r.ok) return null;
      const raw = (await r.json()) as Record<string, unknown>;
      return parseGraph(raw);
    } catch {
      return null;
    }
  }

  async saveGraph(graph: ActorGraph): Promise<void> {
    const r = await fetch(this.url('/v1/graph'), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ data: serializeGraph(graph) }),
    });
    if (!r.ok) throw new Error(`Save failed: ${r.status}`);
  }

  // ── Prompts ──────────────────────────────────────────────────────────────────

  async fetchPrompts(servers: CanticaServer[]): Promise<CanticaPrompt[]> {
    // Ask the studio API which aggregates from all configured Cantica servers
    try {
      const r = await fetch(this.url('/v1/prompts'), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      return r.json() as Promise<CanticaPrompt[]>;
    } catch {
      return [];
    }
  }

  // ── Runtime ──────────────────────────────────────────────────────────────────

  async listRunning(): Promise<string[]> {
    const r = await fetch(this.url('/v1/runtime/actors'));
    if (!r.ok) return [];
    return r.json() as Promise<string[]>;
  }

  async startActor(def: AIActorDef): Promise<void> {
    const isCode = def.actorType === 'python' || def.actorType === 'typescript';
    const body = isCode
      ? {
          name: def.name,
          actor_type: def.actorType,
          script_path: def.scriptPath ?? '',
          script_command: def.scriptCommand ?? '',
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
          })),
          cron_jobs: def.cronJobs.map((c) => ({
            ...(c.name ? { name: c.name } : {}),
            schedule: c.schedule,
            prompt: c.prompt.uri ?? c.prompt.content ?? '',
            ...(c.targetActor ? { targetActor: c.targetActor } : {}),
            ...(c.targetEvent ? { targetEvent: c.targetEvent } : {}),
          })),
          outbox: {},
        };
    const r = await fetch(this.url('/v1/runtime/actors'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Failed to start actor: ${r.status}`);
  }

  async stopActor(name: string): Promise<void> {
    await fetch(this.url(`/v1/runtime/actors/${encodeURIComponent(name)}`), { method: 'DELETE' });
  }

  async instructActor(name: string, instruction: string): Promise<string> {
    const r = await fetch(this.url(`/v1/runtime/actors/${encodeURIComponent(name)}/instruct`), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ instruction }),
    });
    if (!r.ok) throw new Error(`Instruct failed: ${r.status}`);
    const data = (await r.json()) as { output: string };
    return data.output;
  }

  async fireEvent(name: string, eventName: string, context = ''): Promise<string> {
    const r = await fetch(
      this.url(`/v1/runtime/actors/${encodeURIComponent(name)}/event/${encodeURIComponent(eventName)}`),
      { method: 'POST', headers: headers(), body: JSON.stringify({ context }) },
    );
    if (!r.ok) throw new Error(`Fire event failed: ${r.status}`);
    const data = (await r.json()) as { output: string };
    return data.output;
  }
}

// ── JSON-LD ↔ ActorGraph conversion (host side) ───────────────────────────────

export function parseGraph(raw: Record<string, unknown>): ActorGraph {
  const actors = ((raw['actors'] ?? []) as Record<string, unknown>[]).map(_parseActor);
  // Drop: kindless legacy edges AND self-loop edges.
  // Self-targeting is stored purely in actor.promptEvents / actor.cronJobs;
  // no edge is created or preserved for it.
  const edges = ((raw['edges'] ?? []) as Record<string, unknown>[])
    .map(_parseEdge)
    .filter((e): e is ActorEdgeDef => e !== null && e.from !== e.to);
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
    };
  });
  const actorType = ((r['actorType'] as string | undefined) ?? 'ai') as 'ai' | 'python' | 'typescript';
  return {
    id: (r['@id'] as string) ?? '',
    name: (r['name'] as string) ?? '',
    actorType,
    ...(r['scriptPath'] ? { scriptPath: r['scriptPath'] as string } : {}),
    ...(r['scriptCommand'] ? { scriptCommand: r['scriptCommand'] as string } : {}),
    definePrompt: _parseRef(r['definePrompt']),
    provider: (r['provider'] as string) ?? 'claude',
    model: (r['model'] as string) ?? 'claude-sonnet-4-6',
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
    })),
    'cronJobs': a.cronJobs.map((c) => ({
      '@type': 'CronJob',
      ...(c.name ? { 'name': c.name } : {}),
      'schedule': c.schedule,
      'prompt': _serializeRef(c.prompt),
      ...(c.targetActor ? { 'targetActor': c.targetActor } : {}),
      ...(c.targetEvent ? { 'targetEvent': c.targetEvent } : {}),
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
