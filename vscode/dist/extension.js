"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/actors-panel.ts
var vscode = __toESM(require("vscode"));

// src/studio-client.ts
function headers(token) {
  const h = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}
var StudioClient = class {
  baseUrl;
  onLog;
  constructor(baseUrl = "http://localhost:8043") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  url(path3) {
    return `${this.baseUrl}${path3}`;
  }
  async _fetch(path3, init) {
    const method = (init?.method ?? "GET").toUpperCase();
    const t0 = Date.now();
    const r = await fetch(this.url(path3), init);
    this.onLog?.({ ts: t0, method, url: path3, status: r.status, durationMs: Date.now() - t0 });
    return r;
  }
  async ping() {
    try {
      const r = await fetch(this.url("/health"), { signal: AbortSignal.timeout(4e3) });
      return r.ok;
    } catch {
      return false;
    }
  }
  // ── Graph ────────────────────────────────────────────────────────────────────
  async loadGraph() {
    try {
      const r = await this._fetch("/v1/graph");
      if (!r.ok) return null;
      const raw = await r.json();
      return parseGraph(raw);
    } catch {
      return null;
    }
  }
  async saveGraph(graph) {
    const r = await this._fetch("/v1/graph", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ data: serializeGraph(graph) })
    });
    if (!r.ok) throw new Error(`Save failed: ${r.status}`);
  }
  // ── Prompts ──────────────────────────────────────────────────────────────────
  async fetchProviderModels(refresh = false) {
    try {
      const path3 = refresh ? "/v1/providers/models?refresh=true" : "/v1/providers/models";
      const r = await this._fetch(path3, { signal: AbortSignal.timeout(3e4) });
      if (!r.ok) return {};
      return r.json();
    } catch {
      return {};
    }
  }
  async fetchPrompts(_servers) {
    try {
      const r = await this._fetch("/v1/prompts", { signal: AbortSignal.timeout(8e3) });
      if (!r.ok) return [];
      return r.json();
    } catch {
      return [];
    }
  }
  // ── Runtime ──────────────────────────────────────────────────────────────────
  async listRunning() {
    const r = await this._fetch("/v1/runtime/actors");
    if (!r.ok) return [];
    return r.json();
  }
  async startActor(def) {
    const isCode = def.actorType === "python" || def.actorType === "typescript";
    const body = isCode ? {
      name: def.name,
      actor_type: def.actorType,
      script_path: def.scriptPath ?? "",
      script_command: def.scriptCommand ?? "",
      ...def.directory ? { directory: def.directory } : {}
    } : {
      name: def.name,
      define_prompt: def.definePrompt.uri ?? def.definePrompt.content ?? "",
      provider: def.provider,
      model: def.model,
      max_tokens: def.maxTokens,
      max_history: def.maxHistory,
      prompt_events: def.promptEvents.map((e) => ({
        name: e.name,
        prompt: e.prompt.uri ?? e.prompt.content ?? "",
        ...e.filePattern ? { filePattern: e.filePattern } : {},
        ...e.targetActors?.length ? { targetActors: e.targetActors } : {}
      })),
      cron_jobs: def.cronJobs.map((c) => ({
        ...c.name ? { name: c.name } : {},
        schedule: c.schedule,
        prompt: c.prompt.uri ?? c.prompt.content ?? "",
        ...c.targetActor ? { targetActor: c.targetActor } : {},
        ...c.targetEvent ? { targetEvent: c.targetEvent } : {}
      })),
      outbox: {},
      ...def.directory ? { directory: def.directory } : {}
    };
    const r = await this._fetch("/v1/runtime/actors", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      let detail = "";
      try {
        detail = await r.text();
      } catch {
      }
      throw new Error(`Failed to start actor [${r.status}]${detail ? `: ${detail}` : ""}`);
    }
    const data = await r.json();
    return data.initial_output ?? null;
  }
  async stopActor(name) {
    await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  async pauseActor(name) {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/pause`, {
      method: "POST",
      headers: headers()
    });
    if (!r.ok) throw new Error(`Pause failed [${r.status}]`);
  }
  async resumeActor(name) {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/resume`, {
      method: "POST",
      headers: headers()
    });
    if (!r.ok) throw new Error(`Resume failed [${r.status}]`);
  }
  async instructActor(name, instruction) {
    const r = await this._fetch(`/v1/runtime/actors/${encodeURIComponent(name)}/instruct`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction })
    });
    if (!r.ok) {
      let detail = "";
      try {
        detail = await r.text();
      } catch {
      }
      throw new Error(`Instruct failed [${r.status}]${detail ? `: ${detail}` : ""}`);
    }
    const data = await r.json();
    return data.output;
  }
  async drainNotifications() {
    try {
      const r = await this._fetch("/v1/runtime/notifications", { signal: AbortSignal.timeout(5e3) });
      if (!r.ok) return [];
      return r.json();
    } catch {
      return [];
    }
  }
  async fireEvent(name, eventName, context = "") {
    const r = await this._fetch(
      `/v1/runtime/actors/${encodeURIComponent(name)}/event/${encodeURIComponent(eventName)}`,
      { method: "POST", headers: headers(), body: JSON.stringify({ context }) }
    );
    if (!r.ok) throw new Error(`Fire event failed: ${r.status}`);
    const data = await r.json();
    return { output: data.output, forwarded: data.forwarded ?? [] };
  }
};
function parseGraph(raw) {
  const actors = (raw["actors"] ?? []).map(_parseActor);
  const edges = (raw["edges"] ?? []).map(_parseEdge).filter((e) => e !== null && e.from !== e.to);
  return {
    id: raw["@id"] ?? "urn:cantica:studio:graph:default",
    name: raw["name"] ?? "Workflow",
    actors,
    edges
  };
}
function _parseActor(r) {
  const pos = r["position"] ?? {};
  const events = (r["promptEvents"] ?? []).map((e) => {
    const fp = e["filePattern"];
    const tas = e["targetActors"];
    const oldTa = e["targetActor"];
    const targetActors = tas ?? (oldTa ? [oldTa] : void 0);
    return {
      name: e["name"] ?? "",
      prompt: _parseRef(e["prompt"]),
      ...fp ? { filePattern: fp } : {},
      ...targetActors?.length ? { targetActors } : {}
    };
  });
  const crons = (r["cronJobs"] ?? []).map((c) => {
    const cn = c["name"];
    const ta = c["targetActor"];
    const te = c["targetEvent"];
    return {
      ...cn ? { name: cn } : {},
      schedule: c["schedule"] ?? "",
      prompt: _parseRef(c["prompt"]),
      ...ta ? { targetActor: ta } : {},
      ...te ? { targetEvent: te } : {}
    };
  });
  const actorType = r["actorType"] ?? "ai";
  return {
    id: r["@id"] ?? "",
    name: r["name"] ?? "",
    actorType,
    ...r["scriptPath"] ? { scriptPath: r["scriptPath"] } : {},
    ...r["scriptCommand"] ? { scriptCommand: r["scriptCommand"] } : {},
    ...r["directory"] ? { directory: r["directory"] } : {},
    definePrompt: _parseRef(r["definePrompt"]),
    provider: r["provider"] ?? "claude",
    model: r["model"] ?? "claude-sonnet-4-6",
    maxTokens: r["maxTokens"] ?? 4096,
    maxHistory: r["maxHistory"] ?? 10,
    position: { x: pos.x ?? 0, y: pos.y ?? 0 },
    promptEvents: events,
    cronJobs: crons,
    resources: (r["resources"] ?? []).map((res) => ({
      id: res["id"] ?? "",
      name: res["name"] ?? "",
      type: res["type"] ?? "other",
      uri: res["uri"] ?? "",
      ...res["description"] ? { description: res["description"] } : {},
      ...res["dynamic"] !== void 0 ? { dynamic: res["dynamic"] } : {},
      ...res["sharedWith"] ? { sharedWith: res["sharedWith"] } : {}
    }))
  };
}
function _parseEdge(r) {
  const kind = r["kind"];
  if (!kind) return null;
  const te = r["targetEvent"];
  return {
    id: r["@id"] ?? "",
    from: r["from"] ?? "",
    to: r["to"] ?? "",
    ...te ? { targetEvent: te } : {},
    prompt: _parseRef(r["prompt"]),
    label: r["label"] ?? "",
    kind
  };
}
function _parseRef(v) {
  if (typeof v === "string") return v.startsWith("cantica://") ? { uri: v } : { content: v };
  if (typeof v === "object" && v !== null) {
    const o = v;
    const uri = o["uri"];
    const content = o["content"];
    return { ...uri ? { uri } : {}, ...content ? { content } : {} };
  }
  return {};
}
function serializeGraph(g) {
  return {
    "@context": { "@vocab": "https://cantica.dev/studio/", "schema": "http://schema.org/", "name": "schema:name" },
    "@type": "ActorGraph",
    "@id": g.id,
    "name": g.name,
    "actors": g.actors.map(_serializeActor),
    "edges": g.edges.map(_serializeEdge)
  };
}
function _serializeActor(a) {
  return {
    "@type": a.actorType === "ai" ? "AIActor" : "CodeActor",
    "@id": a.id,
    "name": a.name,
    "actorType": a.actorType ?? "ai",
    ...a.scriptPath ? { "scriptPath": a.scriptPath } : {},
    ...a.scriptCommand ? { "scriptCommand": a.scriptCommand } : {},
    ...a.directory ? { "directory": a.directory } : {},
    "definePrompt": _serializeRef(a.definePrompt),
    "provider": a.provider,
    "model": a.model,
    "maxTokens": a.maxTokens,
    "maxHistory": a.maxHistory,
    "position": a.position,
    "promptEvents": a.promptEvents.map((e) => ({
      "@type": "PromptEvent",
      "name": e.name,
      "prompt": _serializeRef(e.prompt),
      ...e.filePattern ? { "filePattern": e.filePattern } : {},
      ...e.targetActors?.length ? { "targetActors": e.targetActors } : {}
    })),
    "cronJobs": a.cronJobs.map((c) => ({
      "@type": "CronJob",
      ...c.name ? { "name": c.name } : {},
      "schedule": c.schedule,
      "prompt": _serializeRef(c.prompt),
      ...c.targetActor ? { "targetActor": c.targetActor } : {},
      ...c.targetEvent ? { "targetEvent": c.targetEvent } : {}
    })),
    "resources": (a.resources ?? []).map((res) => ({
      "@type": "AgentResource",
      "id": res.id,
      "name": res.name,
      "type": res.type,
      "uri": res.uri,
      ...res.description ? { "description": res.description } : {},
      ...res.dynamic !== void 0 ? { "dynamic": res.dynamic } : {},
      ...res.sharedWith?.length ? { "sharedWith": res.sharedWith } : {}
    }))
  };
}
function _serializeEdge(e) {
  return {
    "@type": "ActorMessage",
    "@id": e.id,
    "from": e.from,
    "to": e.to,
    ...e.targetEvent ? { "targetEvent": e.targetEvent } : {},
    "prompt": _serializeRef(e.prompt),
    "label": e.label,
    "kind": e.kind
  };
}
function _serializeRef(r) {
  if (r.uri) return r.uri;
  if (r.content) return r.content;
  return null;
}

// src/actors-panel.ts
var ActorsPanel = class _ActorsPanel {
  static viewType = "canticaScores.panel";
  static _current;
  static get current() {
    return _ActorsPanel._current;
  }
  /** Call after studio API becomes ready so the webview gets a fresh model list. */
  static async refreshProviderModels(client) {
    if (_ActorsPanel._current) {
      _ActorsPanel._current.client = client;
      _ActorsPanel._current._attachLogCallback();
      await _ActorsPanel._current.pushProviderModels(true);
    }
  }
  panel;
  disposables = [];
  settings;
  client;
  fileSaveWatcher;
  _activeSongbookUri;
  get activeSongbookUri() {
    return this._activeSongbookUri;
  }
  static show(context, client, settings) {
    if (_ActorsPanel._current !== void 0) {
      _ActorsPanel._current.panel.reveal(vscode.ViewColumn.Beside, true);
      _ActorsPanel._current.client = client;
      _ActorsPanel._current.settings = settings;
      return _ActorsPanel._current;
    }
    const panel = vscode.window.createWebviewPanel(
      _ActorsPanel.viewType,
      "Songbook",
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
        retainContextWhenHidden: true
      }
    );
    _ActorsPanel._current = new _ActorsPanel(panel, context, client, settings);
    return _ActorsPanel._current;
  }
  constructor(panel, context, client, settings) {
    this.panel = panel;
    this.client = client;
    this.settings = settings;
    this._attachLogCallback();
    this.panel.webview.html = this.buildHtml(context);
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "icons", "activitybar.svg");
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.handleMessage(msg),
      null,
      this.disposables
    );
  }
  async handleMessage(msg) {
    if (typeof msg !== "object" || msg === null) return;
    const raw = msg;
    switch (raw["type"]) {
      case "ready":
        await this.pushSettings();
        await this.pushGraph();
        await this.pushPrompts();
        void this.pushProviderModels(true);
        break;
      case "saveGraph": {
        const graph = raw["graph"];
        const errs = [];
        try {
          await this.client.saveGraph(graph);
          await this.registerFileSaveWatcher(graph);
        } catch (err) {
          errs.push(`Studio API: ${String(err)}`);
        }
        const songbookUri = this._activeSongbookUri ?? await this.detectSongbookUri(graph);
        if (songbookUri) {
          try {
            const content = Buffer.from(JSON.stringify(serializeGraph(graph), null, 2), "utf-8");
            await vscode.workspace.fs.writeFile(songbookUri, content);
            if (!this._activeSongbookUri) this.setActiveSongbook(songbookUri);
          } catch (err) {
            errs.push(`File: ${String(err)}`);
          }
        }
        if (errs.length > 0) {
          void vscode.window.showErrorMessage(`Save failed: ${errs.join("; ")}`);
        }
        break;
      }
      case "addActor":
        break;
      case "openSongbook": {
        const uri = raw["uri"];
        const content = raw["content"];
        try {
          let graph;
          let songbookUri;
          if (uri) {
            songbookUri = vscode.Uri.parse(uri);
            const bytes = await vscode.workspace.fs.readFile(songbookUri);
            graph = parseGraph(JSON.parse(Buffer.from(bytes).toString("utf-8")));
          } else if (content) {
            graph = parseGraph(content);
          } else {
            break;
          }
          try {
            await this.client.saveGraph(graph);
          } catch {
          }
          if (songbookUri) this.setActiveSongbook(songbookUri);
          await this.post({ type: "loadGraph", graph });
        } catch (err) {
          void vscode.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
        }
        break;
      }
      case "runActor": {
        const name = raw["name"];
        const instruction = raw["instruction"];
        const isStartOnly = instruction === "__start__";
        let alreadyRunning;
        try {
          const runningNames = await this.client.listRunning();
          alreadyRunning = runningNames.includes(name);
        } catch (err) {
          await this.post({
            type: "actorOutput",
            name,
            output: `\u26A0 Studio API not reachable \u2014 ${String(err)}`
          });
          break;
        }
        if (!alreadyRunning) {
          const graph = await this.client.loadGraph();
          const def = graph?.actors.find((a) => a.name === name);
          if (!def) {
            await this.post({
              type: "actorOutput",
              name,
              output: `\u26A0 Actor "${name}" not found in the graph \u2014 open the songbook first.`
            });
            break;
          }
          const tag = def.actorType === "ai" ? `${def.provider} / ${def.model}` : def.actorType;
          await this.post({ type: "actorOutput", name, output: `\u23F3 Initialising ${tag}\u2026` });
          try {
            const initialOutput = await this.client.startActor(def);
            if (initialOutput) {
              await this.post({ type: "actorOutput", name, output: initialOutput });
            }
            await this.post({ type: "actorOutput", name, output: `\u2713 Ready \xB7 ${tag}` });
            await this.post({ type: "actorStatus", name, running: true });
          } catch (err) {
            await this.post({ type: "actorOutput", name, output: `\u26A0 Start failed: ${String(err)}` });
            break;
          }
        } else if (isStartOnly) {
          await this.post({ type: "actorOutput", name, output: `\xB7 ${name} is already running` });
          await this.post({ type: "actorStatus", name, running: true });
        }
        if (isStartOnly) break;
        try {
          const output = await this.client.instructActor(name, instruction);
          await this.post({ type: "actorOutput", name, output });
          await this.pushNotifications();
        } catch (err) {
          await this.post({ type: "actorOutput", name, output: `\u26A0 Prompt failed: ${String(err)}` });
        }
        break;
      }
      case "fireEvent": {
        const name = raw["name"];
        const eventName = raw["eventName"];
        const context = raw["context"] ?? "";
        try {
          const result = await this.client.fireEvent(name, eventName, context);
          await this.post({ type: "actorOutput", name, output: result.output });
          await this.pushForwarded(result.forwarded);
          await this.pushNotifications();
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "refreshActor": {
        const name = raw["name"];
        const answer = await vscode.window.showWarningMessage(
          `Refresh actor "${name}"? It will be stopped and restarted. Conversation history is preserved.`,
          { modal: true },
          "Refresh"
        );
        if (answer !== "Refresh") break;
        try {
          await this.client.stopActor(name);
          await this.post({ type: "actorStatus", name, running: false });
          await this.post({ type: "actorPaused", name, paused: false });
        } catch (err) {
          await this.post({ type: "error", message: `Stop failed: ${String(err)}` });
          break;
        }
        const graph = await this.client.loadGraph();
        const def = graph?.actors.find((a) => a.name === name);
        if (!def) {
          await this.post({ type: "actorOutput", name, output: "\u26A0 Actor not found in graph \u2014 could not restart" });
          break;
        }
        await this.post({ type: "actorOutput", name, output: `\u267B Refreshing ${name}\u2026` });
        try {
          const initialOutput = await this.client.startActor(def);
          if (initialOutput) {
            await this.post({ type: "actorOutput", name, output: initialOutput });
          }
          await this.post({ type: "actorOutput", name, output: "\u2713 Ready" });
          await this.post({ type: "actorStatus", name, running: true });
        } catch (err) {
          await this.post({ type: "error", message: `Restart failed: ${String(err)}` });
        }
        break;
      }
      case "stopActor": {
        const name = raw["name"];
        try {
          await this.client.stopActor(name);
          await this.post({ type: "actorStatus", name, running: false });
          await this.post({ type: "actorPaused", name, paused: false });
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "pauseActor": {
        const name = raw["name"];
        try {
          await this.client.pauseActor(name);
          await this.post({ type: "actorPaused", name, paused: true });
          await this.post({ type: "actorOutput", name, output: "\u23F8 Paused \u2014 prompts will be queued" });
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "resumeActor": {
        const name = raw["name"];
        try {
          await this.client.resumeActor(name);
          await this.post({ type: "actorPaused", name, paused: false });
          await this.post({ type: "actorOutput", name, output: "\u25B6 Resumed" });
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "refreshPrompts":
        await this.pushPrompts();
        break;
      case "explorerSideChanged": {
        const side = raw["side"];
        if (side === "left" || side === "right") {
          await vscode.workspace.getConfiguration().update("canticaScores.explorerSide", side, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "configureServer":
        await vscode.commands.executeCommand("workbench.action.openSettings", "canticaScores");
        break;
      case "startLocalStudio":
        await vscode.commands.executeCommand("canticaScores.startLocalStudio");
        break;
      case "stopLocalStudio":
        await vscode.commands.executeCommand("canticaScores.stopLocalStudio");
        break;
      case "playSongbook": {
        const graph = await this.client.loadGraph();
        if (!graph) break;
        let runningNames = [];
        try {
          runningNames = await this.client.listRunning();
        } catch {
        }
        for (const actor of graph.actors) {
          if (runningNames.includes(actor.name)) {
            await this.post({ type: "actorOutput", name: actor.name, output: `\xB7 ${actor.name} already running` });
            await this.post({ type: "actorStatus", name: actor.name, running: true });
            continue;
          }
          const tag = actor.actorType === "ai" ? `${actor.provider} / ${actor.model}` : actor.actorType;
          await this.post({ type: "actorOutput", name: actor.name, output: `\u23F3 Initialising ${tag}\u2026` });
          try {
            const initialOutput = await this.client.startActor(actor);
            if (initialOutput) {
              await this.post({ type: "actorOutput", name: actor.name, output: initialOutput });
            }
            await this.post({ type: "actorOutput", name: actor.name, output: `\u2713 Ready \xB7 ${tag}` });
            await this.post({ type: "actorStatus", name: actor.name, running: true });
          } catch (err) {
            await this.post({ type: "actorOutput", name: actor.name, output: `\u26A0 Start failed: ${String(err)}` });
          }
        }
        break;
      }
      case "stopSongbook": {
        const running = await this.client.listRunning();
        for (const name of running) {
          try {
            await this.client.stopActor(name);
            await this.post({ type: "actorStatus", name, running: false });
          } catch {
          }
        }
        break;
      }
    }
  }
  async pushGraph() {
    const graph = await this.client.loadGraph();
    if (graph) {
      await this.post({ type: "loadGraph", graph });
      await this.registerFileSaveWatcher(graph);
    }
  }
  async pushPrompts() {
    const prompts = await this.client.fetchPrompts(this.settings.servers);
    await this.post({ type: "updatePrompts", prompts });
  }
  async pushSettings() {
    await this.post({ type: "updateSettings", settings: this.settings });
  }
  async pushProviderModels(refresh = false) {
    let models = await this.client.fetchProviderModels(refresh);
    if (Object.keys(models).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      models = await this.client.fetchProviderModels(refresh);
    }
    if (Object.keys(models).length > 0) {
      await this.post({ type: "providerModels", models });
    }
  }
  setActiveSongbook(uri) {
    this._activeSongbookUri = uri;
    const name = uri?.path.split("/").pop()?.replace(/\.jsonld$/i, "");
    this.panel.title = name ? `${name} - Songbook` : "Songbook";
  }
  async detectSongbookUri(graph) {
    const home = (this.settings.canticaHome ?? "").trim() || `${process.env["HOME"] ?? "~"}/.cantica`;
    const dir = vscode.Uri.file(`${home}/songbooks`);
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const candidates = [];
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith(".jsonld")) {
          candidates.push(vscode.Uri.joinPath(dir, name));
        } else if (type === vscode.FileType.Directory) {
          try {
            const subEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(dir, name));
            for (const [subName, subType] of subEntries) {
              if (subType === vscode.FileType.File && subName.endsWith(".jsonld")) {
                candidates.push(vscode.Uri.joinPath(dir, name, subName));
              }
            }
          } catch {
          }
        }
      }
      if (candidates.length === 1 && candidates[0]) {
        return candidates[0];
      }
      for (const uri of candidates) {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const raw = JSON.parse(Buffer.from(bytes).toString("utf-8"));
          if (raw["@id"] === graph.id || raw["name"] === graph.name) return uri;
        } catch {
        }
      }
    } catch {
    }
    return void 0;
  }
  _attachLogCallback() {
    this.client.onLog = (entry) => {
      void this.post({ type: "apiLog", entry });
    };
  }
  updateSettings(settings, client) {
    this.settings = settings;
    this.client = client;
    this._attachLogCallback();
    void this.pushSettings();
    void this.pushPrompts();
  }
  async registerFileSaveWatcher(graph) {
    this.fileSaveWatcher?.dispose();
    const patterns = graph.actors.flatMap((a) => a.promptEvents).filter((e) => !!e.filePattern).map((e) => e.filePattern);
    if (patterns.length === 0) return;
    const watcher = vscode.workspace.createFileSystemWatcher(
      `{${patterns.join(",")}}`
    );
    watcher.onDidChange((uri) => {
      for (const actor of graph.actors) {
        for (const evt of actor.promptEvents) {
          if (evt.filePattern && vscode.languages.match({ pattern: evt.filePattern }, { uri, languageId: "" }) !== 0) {
            void this.client.fireEvent(actor.name, evt.name, uri.fsPath).then(async (result) => {
              await this.post({ type: "actorOutput", name: actor.name, output: result.output });
              await this.pushForwarded(result.forwarded);
              await this.pushNotifications();
            });
          }
        }
      }
    });
    this.fileSaveWatcher = watcher;
    this.disposables.push(watcher);
  }
  async post(msg) {
    await this.panel.webview.postMessage(msg);
  }
  /** Push forwarded prompt+response pairs to the receiver's chat panel. */
  async pushForwarded(forwarded) {
    for (const fwd of forwarded) {
      const promptLine = fwd.prompt.replace(/[\r\n]+/g, " ").trim();
      await this.post({ type: "actorOutput", name: fwd.name, output: `> ${promptLine}` });
      await this.post({ type: "actorOutput", name: fwd.name, output: fwd.output });
    }
  }
  /** Drain the runtime's actor-to-actor notification log and push to the webview. */
  async pushNotifications() {
    const notes = await this.client.drainNotifications();
    await this.pushForwarded(notes);
  }
  buildHtml(context) {
    const wv = this.panel.webview;
    const scriptUri = wv.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.js")
    );
    const styleUri = wv.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.css")
    );
    const nonce = _nonce();
    return (
      /* html */
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${wv.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 font-src ${wv.cspSource} data:;
                 img-src ${wv.cspSource} data:;" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Cantica Studio</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    );
  }
  dispose() {
    _ActorsPanel._current = void 0;
    this.fileSaveWatcher?.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
};
function _nonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)] ?? "A").join("");
}

// src/songbooks-provider.ts
var vscode2 = __toESM(require("vscode"));
var SongbookItem = class extends vscode2.TreeItem {
  constructor(label, uri) {
    super(label, vscode2.TreeItemCollapsibleState.None);
    this.label = label;
    this.uri = uri;
    this.iconPath = new vscode2.ThemeIcon("file-code");
    this.description = vscode2.workspace.asRelativePath(uri, false);
    this.tooltip = uri.fsPath;
    this.contextValue = "songbook";
    this.command = {
      command: "canticaScores.viewSongbook",
      title: "Open Songbook",
      arguments: [this]
    };
  }
  kind = "file";
};
var SongbookFolderItem = class extends vscode2.TreeItem {
  constructor(label, uri, children) {
    super(label, vscode2.TreeItemCollapsibleState.Expanded);
    this.label = label;
    this.uri = uri;
    this.children = children;
    this.iconPath = new vscode2.ThemeIcon("folder-opened");
    this.tooltip = uri.fsPath;
    this.contextValue = "songbookFolder";
  }
  kind = "folder";
};
var SongbooksProvider = class {
  _evt = new vscode2.EventEmitter();
  onDidChangeTreeData = this._evt.event;
  // Accept both internal moves and drops from the VS Code Explorer / OS
  dropMimeTypes = ["application/vnd.code.tree.canticaScores.songbooksView", "text/uri-list"];
  dragMimeTypes = ["application/vnd.code.tree.canticaScores.songbooksView"];
  _mode = "tree";
  _entries = [];
  _dropHandler;
  setMode(mode) {
    this._mode = mode;
    this._evt.fire(void 0);
  }
  update(entries) {
    this._entries = entries;
    this._evt.fire(void 0);
  }
  setDropHandler(fn) {
    this._dropHandler = fn;
  }
  handleDrag(source, dataTransfer) {
    const files = source.filter((n) => n.kind === "file");
    const uriList = files.map((f) => f.uri.toString()).join("\r\n");
    dataTransfer.set(
      "application/vnd.code.tree.canticaScores.songbooksView",
      new vscode2.DataTransferItem(uriList)
    );
    if (files.length > 0) {
      dataTransfer.set("text/uri-list", new vscode2.DataTransferItem(uriList));
    }
  }
  async handleDrop(target, dataTransfer) {
    if (!this._dropHandler) return;
    const folder = target?.kind === "folder" ? target : void 0;
    const item = dataTransfer.get("application/vnd.code.tree.canticaScores.songbooksView") ?? dataTransfer.get("text/uri-list");
    if (!item) return;
    const raw = await item.asString();
    const uris = raw.split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith("#")).map((u) => vscode2.Uri.parse(u));
    if (uris.length > 0) {
      await this._dropHandler(uris, folder);
    }
  }
  getTreeItem(el) {
    return el;
  }
  getChildren(el) {
    if (this._mode === "list") {
      if (el) return [];
      return this._entries.flatMap(
        (e) => e.kind === "file" ? [new SongbookItem(e.label, e.uri)] : e.children.map((c) => new SongbookItem(`${e.label}/${c.label}`, c.uri))
      );
    }
    if (!el) {
      return this._entries.map(
        (e) => e.kind === "file" ? new SongbookItem(e.label, e.uri) : new SongbookFolderItem(
          e.label,
          e.uri,
          e.children.map((c) => new SongbookItem(c.label, c.uri))
        )
      );
    }
    if (el.kind === "folder") return el.children;
    return [];
  }
};

// src/songbooks-fs-provider.ts
var path = __toESM(require("path"));
var vscode3 = __toESM(require("vscode"));
var SONGBOOKS_SCHEME = "cantica-songbooks";
var SongbooksFileSystemProvider = class {
  _onDidChangeFile = new vscode3.EventEmitter();
  onDidChangeFile = this._onDidChangeFile.event;
  _root;
  constructor(root) {
    this._root = root;
  }
  updateRoot(root) {
    this._root = root;
  }
  _real(uri) {
    return vscode3.Uri.file(path.join(this._root, uri.path));
  }
  watch(uri, options) {
    const watcher = vscode3.workspace.createFileSystemWatcher(
      new vscode3.RelativePattern(this._real(uri), options.recursive ? "**" : "*")
    );
    const emit = (type) => (changed) => {
      const rel = path.relative(this._root, changed.fsPath).split(path.sep).join("/");
      this._onDidChangeFile.fire([{ type, uri: vscode3.Uri.parse(`${SONGBOOKS_SCHEME}:///${rel}`) }]);
    };
    watcher.onDidCreate(emit(vscode3.FileChangeType.Created));
    watcher.onDidChange(emit(vscode3.FileChangeType.Changed));
    watcher.onDidDelete(emit(vscode3.FileChangeType.Deleted));
    return watcher;
  }
  stat(uri) {
    return vscode3.workspace.fs.stat(this._real(uri));
  }
  readDirectory(uri) {
    return vscode3.workspace.fs.readDirectory(this._real(uri));
  }
  createDirectory(uri) {
    return vscode3.workspace.fs.createDirectory(this._real(uri));
  }
  readFile(uri) {
    return vscode3.workspace.fs.readFile(this._real(uri));
  }
  writeFile(uri, content, _options) {
    return vscode3.workspace.fs.writeFile(this._real(uri), content);
  }
  delete(uri, options) {
    return vscode3.workspace.fs.delete(this._real(uri), { recursive: options.recursive, useTrash: true });
  }
  rename(oldUri, newUri, options) {
    return vscode3.workspace.fs.rename(this._real(oldUri), this._real(newUri), { overwrite: options.overwrite });
  }
  copy(source, destination, options) {
    return vscode3.workspace.fs.copy(this._real(source), this._real(destination), { overwrite: options.overwrite });
  }
};

// src/servers-provider.ts
var vscode4 = __toESM(require("vscode"));
var ServerItem = class extends vscode4.TreeItem {
  constructor(server) {
    let host;
    try {
      host = new URL(server.url).host;
    } catch {
      host = server.url;
    }
    super(host, vscode4.TreeItemCollapsibleState.None);
    this.server = server;
    this.iconPath = new vscode4.ThemeIcon("server");
    this.description = server.url;
    this.tooltip = server.url;
    this.contextValue = "server";
  }
};
var ServersProvider = class {
  _evt = new vscode4.EventEmitter();
  onDidChangeTreeData = this._evt.event;
  items = [];
  update(servers) {
    this.items = servers.map((s) => new ServerItem(s));
    this._evt.fire();
  }
  getTreeItem(el) {
    return el;
  }
  getChildren() {
    return this.items;
  }
};

// src/studio-provider.ts
var StudioProvider = class {
  getTreeItem() {
    throw new Error("no items");
  }
  getChildren() {
    return [];
  }
};

// src/studioManager.ts
var child_process = __toESM(require("node:child_process"));
var os = __toESM(require("node:os"));
var path2 = __toESM(require("node:path"));
var vscode5 = __toESM(require("vscode"));
var IMAGE = "cantica-studio-api:latest";
var CONTAINER = "cantica-studio-api";
var INTERNAL_PORT = 8043;
var StudioManager = class _StudioManager {
  outputChannel;
  constructor() {
    this.outputChannel = vscode5.window.createOutputChannel("Cantica Studio");
  }
  dispose() {
    this.outputChannel.dispose();
  }
  /** Resolved canticaHome from settings or OS default. */
  static canticaHome() {
    const cfg = vscode5.workspace.getConfiguration("canticaScores");
    const configured = cfg.get("canticaHome") ?? "";
    return configured || path2.join(os.homedir(), ".cantica");
  }
  /** Port for the local studio API (from settings or default). */
  static studioPort() {
    const cfg = vscode5.workspace.getConfiguration("canticaScores");
    return cfg.get("studioPort") ?? INTERNAL_PORT;
  }
  /** URL for the local studio API. */
  static studioUrl() {
    return `http://localhost:${_StudioManager.studioPort()}`;
  }
  /** Returns true if Docker is available on PATH. */
  async isDockerAvailable() {
    return new Promise((resolve) => {
      child_process.exec("docker info", { timeout: 5e3 }, (err) => resolve(!err));
    });
  }
  /** Returns true if the container is currently running. */
  async isRunning() {
    return new Promise((resolve) => {
      child_process.exec(
        `docker inspect --format "{{.State.Running}}" ${CONTAINER}`,
        { timeout: 5e3 },
        (err, stdout) => resolve(!err && stdout.trim() === "true")
      );
    });
  }
  /** Returns true if the image exists locally. */
  async imageExists() {
    return new Promise((resolve) => {
      child_process.exec(
        `docker image inspect ${IMAGE}`,
        { timeout: 5e3 },
        (err) => resolve(!err)
      );
    });
  }
  /** Pull the image from the registry. */
  async pullImage(progress) {
    return new Promise((resolve, reject) => {
      progress.report({ message: `Pulling ${IMAGE}\u2026` });
      this.outputChannel.appendLine(`[studio] Pulling ${IMAGE}`);
      const proc = child_process.spawn("docker", ["pull", IMAGE], { stdio: "pipe" });
      proc.stdout.on("data", (d) => this.outputChannel.append(d.toString()));
      proc.stderr.on("data", (d) => this.outputChannel.append(d.toString()));
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`docker pull exited with code ${code}`));
        }
      });
    });
  }
  /** Start the container. Assumes the image is present. */
  async start(progress) {
    const port = _StudioManager.studioPort();
    const home = _StudioManager.canticaHome();
    await new Promise((resolve) => {
      child_process.exec(`docker rm -f ${CONTAINER}`, { timeout: 5e3 }, () => resolve());
    });
    progress.report({ message: "Starting Cantica Studio API container\u2026" });
    this.outputChannel.appendLine(`[studio] Starting container \u2014 home=${home} port=${port}`);
    const cfg = vscode5.workspace.getConfiguration("canticaScores");
    const apiKeys = [
      ["ANTHROPIC_API_KEY", (cfg.get("anthropicApiKey") ?? "").trim() || (process.env["ANTHROPIC_API_KEY"] ?? "")],
      ["OPENAI_API_KEY", (cfg.get("openaiApiKey") ?? "").trim() || (process.env["OPENAI_API_KEY"] ?? "")],
      ["GEMINI_API_KEY", (cfg.get("geminiApiKey") ?? "").trim() || (process.env["GEMINI_API_KEY"] ?? "")],
      ["GITHUB_TOKEN", (cfg.get("githubToken") ?? "").trim() || (process.env["GITHUB_TOKEN"] ?? "")]
    ];
    const args = [
      "run",
      "-d",
      "--name",
      CONTAINER,
      "--restart",
      "unless-stopped",
      "-p",
      `${port}:${INTERNAL_PORT}`,
      "-v",
      `${home}:/cantica-home`,
      "-e",
      `CANTICA_HOME=/cantica-home`,
      "-e",
      `CANTICA_PORT=${INTERNAL_PORT}`
    ];
    for (const [key, value] of apiKeys) {
      if (value) args.push("-e", `${key}=${value}`);
    }
    args.push(IMAGE);
    await new Promise((resolve, reject) => {
      child_process.execFile("docker", args, { timeout: 15e3 }, (err, stdout, stderr) => {
        if (err) {
          this.outputChannel.appendLine(`[studio] start error: ${stderr}`);
          reject(new Error(`Failed to start container: ${stderr || err.message}`));
        } else {
          this.outputChannel.appendLine(`[studio] Container started: ${stdout.trim()}`);
          resolve();
        }
      });
    });
  }
  /** Stop (and remove) the container. */
  async stop() {
    return new Promise((resolve) => {
      this.outputChannel.appendLine("[studio] Stopping container");
      child_process.exec(`docker rm -f ${CONTAINER}`, { timeout: 1e4 }, () => resolve());
    });
  }
  /**
   * Poll the health endpoint until it responds ok or timeout expires.
   * Returns true when healthy, false on timeout.
   */
  async waitUntilHealthy(timeoutMs = 3e4, intervalMs = 1e3) {
    const url = `${_StudioManager.studioUrl()}/health`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2e3) });
        if (res.ok) return true;
      } catch {
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }
  /**
   * Ensure the local studio API is running.
   * Shows progress UI and handles image pulling if needed.
   * Returns the local URL if successful, or undefined on failure.
   */
  async ensureRunning() {
    if (!await this.isDockerAvailable()) {
      void vscode5.window.showErrorMessage(
        "Docker is required for the local Cantica Studio. Install Docker Desktop and try again.",
        "Get Docker"
      ).then((choice) => {
        if (choice === "Get Docker") {
          void vscode5.env.openExternal(vscode5.Uri.parse("https://www.docker.com/products/docker-desktop/"));
        }
      });
      return void 0;
    }
    if (await this.isRunning()) {
      return _StudioManager.studioUrl();
    }
    return vscode5.window.withProgress(
      {
        location: vscode5.ProgressLocation.Notification,
        title: "Cantica Studio",
        cancellable: false
      },
      async (progress) => {
        try {
          if (!await this.imageExists()) {
            await this.pullImage(progress);
          }
          await this.start(progress);
          progress.report({ message: "Waiting for API to become ready\u2026" });
          const healthy = await this.waitUntilHealthy();
          if (!healthy) {
            this.outputChannel.show(true);
            void vscode5.window.showErrorMessage(
              "Cantica Studio API did not become healthy in time. See Output panel."
            );
            return void 0;
          }
          return _StudioManager.studioUrl();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.outputChannel.appendLine(`[studio] Error: ${message}`);
          this.outputChannel.show(true);
          void vscode5.window.showErrorMessage(`Cantica Studio: ${message}`);
          return void 0;
        }
      }
    );
  }
};

// src/extension.ts
function readSettings() {
  const cfg = vscode6.workspace.getConfiguration("canticaScores");
  const serverUrl = cfg.get("serverUrl") ?? "http://localhost:8042";
  const authToken = cfg.get("authToken") ?? "";
  const rawServers = cfg.get("servers") ?? [];
  const servers = [
    { url: serverUrl, authToken },
    ...rawServers.filter((s) => s.url && s.url !== serverUrl).map((s) => ({ url: s.url, authToken: s.authToken ?? "" }))
  ];
  const studioMode = cfg.get("studioMode") ?? "local";
  const studioPort = cfg.get("studioPort") ?? 8043;
  const remoteUrl = (cfg.get("studioUrl") ?? "").trim();
  const studioBaseUrl = studioMode === "remote" && remoteUrl ? remoteUrl : `http://localhost:${studioPort}`;
  return {
    servers,
    serverUrl,
    authToken,
    explorerSide: cfg.get("explorerSide") ?? "left",
    canticaHome: cfg.get("canticaHome") ?? "",
    studioMode,
    studioBaseUrl,
    studioPort,
    autoStartStudio: cfg.get("autoStartStudio") ?? true,
    providerModels: cfg.get("providerModels") ?? {}
  };
}
function songbooksDir(canticaHome) {
  return vscode6.Uri.file(songbooksRoot(canticaHome));
}
var SONGBOOK_EXTS = /* @__PURE__ */ new Set([".json", ".jsonld", ".yaml", ".yml"]);
function isSongbookFile(name) {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && SONGBOOK_EXTS.has(name.slice(dot));
}
async function findSongbooks(canticaHome) {
  const dir = songbooksDir(canticaHome);
  try {
    const entries = await vscode6.workspace.fs.readDirectory(dir);
    const results = [];
    for (const [name, type] of entries) {
      if (type === vscode6.FileType.File && isSongbookFile(name)) {
        results.push({ kind: "file", label: name, uri: vscode6.Uri.joinPath(dir, name) });
      } else if (type === vscode6.FileType.Directory) {
        try {
          const subEntries = await vscode6.workspace.fs.readDirectory(vscode6.Uri.joinPath(dir, name));
          const children = subEntries.filter(([n, t]) => t === vscode6.FileType.File && isSongbookFile(n)).map(([n]) => ({ kind: "file", label: n, uri: vscode6.Uri.joinPath(dir, name, n) }));
          results.push({ kind: "folder", label: name, uri: vscode6.Uri.joinPath(dir, name), children });
        } catch {
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}
function songbooksRoot(canticaHome) {
  return `${canticaHome.trim() || `${process.env["HOME"] ?? "~"}/.cantica`}/songbooks`;
}
function ensureSongbooksWorkspaceFolder(root) {
  const uri = vscode6.Uri.parse(`${SONGBOOKS_SCHEME}:///`);
  const folders = vscode6.workspace.workspaceFolders ?? [];
  if (!folders.some((f) => f.uri.scheme === SONGBOOKS_SCHEME)) {
    vscode6.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name: "Songbooks" });
  }
}
function activate(context) {
  let settings = readSettings();
  let client = new StudioClient(settings.studioBaseUrl);
  const studio = new StudioManager();
  context.subscriptions.push(studio);
  const statusBar = vscode6.window.createStatusBarItem(vscode6.StatusBarAlignment.Left, 90);
  statusBar.command = "canticaScores.startLocalStudio";
  statusBar.text = "$(circle-outline) Studio";
  statusBar.tooltip = "Cantica Studio API \u2014 click to start";
  statusBar.show();
  context.subscriptions.push(statusBar);
  let _healthPollTimer;
  function startHealthPoll() {
    if (_healthPollTimer !== void 0) return;
    _healthPollTimer = setInterval(() => {
      void client.ping().then((ok) => {
        if (ok) {
          statusBar.text = "$(circle-filled) Studio";
          statusBar.color = "#22c55e";
          statusBar.tooltip = "Cantica Studio API \u2014 healthy";
        } else {
          statusBar.text = "$(error) Studio";
          statusBar.color = "#ef4444";
          statusBar.tooltip = "Cantica Studio API \u2014 not reachable \xB7 click to start";
        }
      });
    }, 5e3);
  }
  startHealthPoll();
  function setStatusStarting() {
    statusBar.text = "$(loading~spin) Studio";
    statusBar.color = "#f59e0b";
    statusBar.tooltip = "Cantica Studio API \u2014 starting\u2026";
  }
  const fsProvider = new SongbooksFileSystemProvider(songbooksRoot(settings.canticaHome));
  context.subscriptions.push(
    vscode6.workspace.registerFileSystemProvider(SONGBOOKS_SCHEME, fsProvider, {
      isCaseSensitive: true
    })
  );
  ensureSongbooksWorkspaceFolder(songbooksRoot(settings.canticaHome));
  const songbooksProvider = new SongbooksProvider();
  const serversProvider = new ServersProvider();
  const studioProvider = new StudioProvider();
  const songbooksView = vscode6.window.createTreeView("canticaScores.songbooksView", {
    treeDataProvider: songbooksProvider,
    dragAndDropController: songbooksProvider,
    showCollapseAll: true,
    canSelectMany: true
  });
  const serversView = vscode6.window.createTreeView("canticaScores.serversView", {
    treeDataProvider: serversProvider,
    showCollapseAll: false
  });
  context.subscriptions.push(
    songbooksView,
    serversView,
    vscode6.window.createTreeView("canticaScores.studioView", { treeDataProvider: studioProvider })
  );
  context.subscriptions.push(
    songbooksView.onDidChangeVisibility((e) => {
      if (e.visible) {
        const panel = ActorsPanel.show(context, client, settings);
        void panel.pushGraph();
      }
    })
  );
  function refreshProviders() {
    serversProvider.update(settings.servers);
    void findSongbooks(settings.canticaHome).then((entries) => songbooksProvider.update(entries));
  }
  refreshProviders();
  songbooksProvider.setDropHandler(async (sourceUris, target) => {
    const destDir = target ? target.uri : songbooksDir(settings.canticaHome);
    for (const srcUri of sourceUris) {
      const realSrc = srcUri.scheme === SONGBOOKS_SCHEME ? vscode6.Uri.file(songbooksRoot(settings.canticaHome) + srcUri.path) : srcUri;
      const filename = realSrc.path.split("/").pop();
      if (!filename) continue;
      const dest = vscode6.Uri.joinPath(destDir, filename);
      if (realSrc.fsPath !== dest.fsPath) {
        try {
          await vscode6.workspace.fs.rename(realSrc, dest, { overwrite: false });
        } catch (err) {
          void vscode6.window.showErrorMessage(`Could not move "${filename}": ${String(err)}`);
        }
      }
    }
  });
  context.subscriptions.push(
    vscode6.commands.registerCommand("canticaScores.openPanel", () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph();
    }),
    vscode6.commands.registerCommand("canticaScores.newActor", () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph().then(() => {
        void panel["panel"]?.webview.postMessage({ type: "addActor" });
      });
    }),
    vscode6.commands.registerCommand("canticaScores.saveGraph", async () => {
      void vscode6.commands.executeCommand("canticaScores.openPanel");
      void vscode6.window.showInformationMessage("Use the Save button in the Workspace toolbar.");
    }),
    vscode6.commands.registerCommand("canticaScores.loadGraph", async () => {
      const panel = ActorsPanel.show(context, client, settings);
      await panel.pushGraph();
    }),
    vscode6.commands.registerCommand("canticaScores.configureServer", async () => {
      await vscode6.commands.executeCommand("workbench.action.openSettings", "canticaScores");
    }),
    vscode6.commands.registerCommand("canticaScores.startLocalStudio", async () => {
      setStatusStarting();
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new StudioClient(settings.studioBaseUrl);
        void vscode6.window.showInformationMessage(`Studio API running at ${url}`);
        void ActorsPanel.refreshProviderModels(client);
      }
    }),
    vscode6.commands.registerCommand("canticaScores.stopLocalStudio", async () => {
      await studio.stop();
      void vscode6.window.showInformationMessage("Studio API stopped.");
    }),
    vscode6.commands.registerCommand("canticaScores.deleteActor", () => {
      void ActorsPanel.current?.["panel"]?.webview.postMessage({ type: "deleteSelected" });
    }),
    vscode6.commands.registerCommand("canticaScores.resetGraph", async () => {
      const answer = await vscode6.window.showWarningMessage(
        "Reset the workspace? All actors and edges will be removed.",
        { modal: true },
        "Reset"
      );
      if (answer === "Reset") {
        void ActorsPanel.current?.["panel"]?.webview.postMessage({ type: "resetGraph" });
      }
    }),
    vscode6.commands.registerCommand("canticaScores.editGraphFile", (uri) => {
      if (uri) {
        void vscode6.commands.executeCommand("vscode.open", uri);
      }
    }),
    vscode6.commands.registerCommand("canticaScores.newSongbook", async () => {
      const name = await vscode6.window.showInputBox({
        prompt: "Songbook name",
        placeHolder: "my-workflow",
        validateInput: (v) => v.trim() ? void 0 : "Name is required"
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, "-").toLowerCase();
      const dir = songbooksDir(settings.canticaHome);
      await vscode6.workspace.fs.createDirectory(dir);
      const uri = vscode6.Uri.joinPath(dir, `${slug}.jsonld`);
      const content = JSON.stringify(
        {
          "@context": { "@vocab": "https://cantica.dev/studio/", "schema": "http://schema.org/", "name": "schema:name" },
          "@type": "ActorGraph",
          "@id": `urn:cantica:studio:graph:${slug}`,
          "name": name.trim(),
          "actors": [],
          "edges": []
        },
        null,
        2
      );
      await vscode6.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      await vscode6.commands.executeCommand("vscode.open", uri);
    }),
    vscode6.commands.registerCommand("canticaScores.saveAllSongbooks", () => {
      void ActorsPanel.current?.["panel"]?.webview.postMessage({ type: "triggerSave" });
    }),
    vscode6.commands.registerCommand("canticaScores.closeAllSongbooks", () => {
      ActorsPanel.current?.dispose();
    }),
    vscode6.commands.registerCommand("canticaScores.songbookViewTree", () => {
      void vscode6.commands.executeCommand("setContext", "canticaScores.songbookViewMode", "tree");
      songbooksProvider.setMode("tree");
    }),
    vscode6.commands.registerCommand("canticaScores.songbookViewList", () => {
      void vscode6.commands.executeCommand("setContext", "canticaScores.songbookViewMode", "list");
      songbooksProvider.setMode("list");
    }),
    vscode6.commands.registerCommand("canticaScores.viewSongbook", async (item) => {
      if (!item) return;
      const fsPath = item.uri.fsPath;
      if (fsPath.endsWith(".yaml") || fsPath.endsWith(".yml")) {
        await vscode6.window.showTextDocument(item.uri, { viewColumn: vscode6.ViewColumn.One, preview: false });
        return;
      }
      try {
        const bytes = await vscode6.workspace.fs.readFile(item.uri);
        const raw = JSON.parse(Buffer.from(bytes).toString("utf-8"));
        const graph = parseGraph(raw);
        await client.saveGraph(graph);
        const panel = ActorsPanel.show(context, client, settings);
        panel.setActiveSongbook(item.uri);
        await panel.pushGraph();
      } catch (err) {
        void vscode6.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
      }
    }),
    vscode6.commands.registerCommand("canticaScores.editSongbook", async (item) => {
      if (!item) return;
      try {
        const bytes = await vscode6.workspace.fs.readFile(item.uri);
        const raw = JSON.parse(Buffer.from(bytes).toString("utf-8"));
        const graph = parseGraph(raw);
        await client.saveGraph(graph);
        await vscode6.window.showTextDocument(item.uri, { viewColumn: vscode6.ViewColumn.One, preview: false });
        const panel = ActorsPanel.show(context, client, settings);
        panel.setActiveSongbook(item.uri);
        await panel.pushGraph();
      } catch (err) {
        void vscode6.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
      }
    }),
    vscode6.commands.registerCommand("canticaScores.deleteSongbook", async (item) => {
      const target = item ?? songbooksView.selection.find((n) => n.kind === "file");
      if (!target) return;
      const answer = await vscode6.window.showWarningMessage(
        `Delete songbook "${target.label}"? This cannot be undone.`,
        { modal: true },
        "Delete"
      );
      if (answer !== "Delete") return;
      await vscode6.workspace.fs.delete(target.uri);
    }),
    vscode6.commands.registerCommand("canticaScores.exportSongbook", async (item) => {
      if (!item) return;
      const serverPicks = settings.servers.map((s) => ({ label: s.url, server: s }));
      if (!serverPicks.length) {
        void vscode6.window.showErrorMessage("No Cantica servers configured. Add a server first.");
        return;
      }
      const chosen = serverPicks.length === 1 ? serverPicks[0] : await vscode6.window.showQuickPick(serverPicks, { placeHolder: "Select target Cantica server" });
      if (!chosen) return;
      await vscode6.window.withProgress(
        { location: vscode6.ProgressLocation.Notification, title: `Exporting "${item.label}"\u2026`, cancellable: false },
        async () => {
          try {
            const bytes = await vscode6.workspace.fs.readFile(item.uri);
            const body = Buffer.from(bytes).toString("utf-8");
            const r = await fetch(`${chosen.server.url.replace(/\/$/, "")}/v1/graphs/import`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...chosen.server.authToken ? { Authorization: `Bearer ${chosen.server.authToken}` } : {}
              },
              body
            });
            if (!r.ok) throw new Error(`Server responded ${r.status}`);
            void vscode6.window.showInformationMessage(`Songbook "${item.label}" exported to ${chosen.label}.`);
          } catch (err) {
            void vscode6.window.showErrorMessage(`Export failed: ${String(err)}`);
          }
        }
      );
    }),
    vscode6.commands.registerCommand("canticaScores.newSongbookFolder", async () => {
      const name = await vscode6.window.showInputBox({
        prompt: "Folder name",
        placeHolder: "my-project",
        validateInput: (v) => v.trim() ? void 0 : "Name is required"
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, "-").toLowerCase();
      const dir = songbooksDir(settings.canticaHome);
      await vscode6.workspace.fs.createDirectory(vscode6.Uri.joinPath(dir, slug));
    }),
    vscode6.commands.registerCommand("canticaScores.newSongbookInFolder", async (item) => {
      if (!item) return;
      const name = await vscode6.window.showInputBox({
        prompt: "Songbook name",
        placeHolder: "my-workflow",
        validateInput: (v) => v.trim() ? void 0 : "Name is required"
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, "-").toLowerCase();
      const uri = vscode6.Uri.joinPath(item.uri, `${slug}.jsonld`);
      const content = JSON.stringify(
        {
          "@context": { "@vocab": "https://cantica.dev/studio/", "schema": "http://schema.org/", "name": "schema:name" },
          "@type": "ActorGraph",
          "@id": `urn:cantica:studio:graph:${slug}`,
          "name": name.trim(),
          "actors": [],
          "edges": []
        },
        null,
        2
      );
      await vscode6.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      await vscode6.commands.executeCommand("vscode.open", uri);
    }),
    vscode6.commands.registerCommand("canticaScores.renameSongbook", async (item) => {
      const target = item ?? songbooksView.selection.find((n) => n.kind === "file");
      if (!target) return;
      const ext = target.uri.path.includes(".") ? target.uri.path.slice(target.uri.path.lastIndexOf(".")) : "";
      const baseName = target.label.endsWith(ext) ? target.label.slice(0, -ext.length) : target.label;
      const newName = await vscode6.window.showInputBox({
        prompt: "New name (without extension)",
        value: baseName,
        validateInput: (v) => v.trim() ? void 0 : "Name is required"
      });
      if (!newName || newName.trim() === baseName) return;
      const slug = newName.trim().replace(/\s+/g, "-").toLowerCase();
      const dir = vscode6.Uri.joinPath(target.uri, "..");
      const newUri = vscode6.Uri.joinPath(dir, `${slug}${ext}`);
      await vscode6.workspace.fs.rename(target.uri, newUri, { overwrite: false });
      const panel = ActorsPanel.current;
      if (panel?.activeSongbookUri?.fsPath === target.uri.fsPath) {
        panel.setActiveSongbook(newUri);
      }
    }),
    vscode6.commands.registerCommand("canticaScores.renameSongbookFolder", async (item) => {
      const target = item ?? songbooksView.selection.find((n) => n.kind === "folder");
      if (!target) return;
      const newName = await vscode6.window.showInputBox({
        prompt: "New folder name",
        value: target.label,
        validateInput: (v) => v.trim() ? void 0 : "Name is required"
      });
      if (!newName || newName.trim() === target.label) return;
      const slug = newName.trim().replace(/\s+/g, "-").toLowerCase();
      const parent = vscode6.Uri.joinPath(target.uri, "..");
      const newUri = vscode6.Uri.joinPath(parent, slug);
      await vscode6.workspace.fs.rename(target.uri, newUri, { overwrite: false });
    }),
    vscode6.commands.registerCommand("canticaScores.deleteSongbookFolder", async (item) => {
      const target = item ?? songbooksView.selection.find((n) => n.kind === "folder");
      if (!target) return;
      const answer = await vscode6.window.showWarningMessage(
        `Delete folder "${target.label}" and all its contents?`,
        { modal: true },
        "Delete"
      );
      if (answer !== "Delete") return;
      await vscode6.workspace.fs.delete(target.uri, { recursive: true, useTrash: true });
    }),
    vscode6.commands.registerCommand("canticaScores.revealSongbook", async (item) => {
      if (!item) return;
      await vscode6.commands.executeCommand("revealFileInOS", item.uri);
    }),
    vscode6.commands.registerCommand("canticaScores.newServer", async () => {
      const url = await vscode6.window.showInputBox({
        prompt: "Cantica server URL",
        placeHolder: "https://my-server.example.com",
        validateInput: (v) => {
          try {
            new URL(v);
            return void 0;
          } catch {
            return "Enter a valid URL";
          }
        }
      });
      if (!url) return;
      const token = await vscode6.window.showInputBox({
        prompt: "Auth token (optional \u2014 press Enter to skip)",
        password: true
      });
      if (token === void 0) return;
      const cfg = vscode6.workspace.getConfiguration("canticaScores");
      const existing = cfg.get("servers") ?? [];
      await cfg.update(
        "servers",
        [...existing, { url, authToken: token }],
        vscode6.ConfigurationTarget.Global
      );
    }),
    vscode6.commands.registerCommand("canticaScores.deleteServer", async (item) => {
      const cfg = vscode6.workspace.getConfiguration("canticaScores");
      const existing = cfg.get("servers") ?? [];
      let urlToDelete;
      if (item) {
        urlToDelete = item.server.url;
      } else {
        const picks = settings.servers.map((s) => ({ label: s.url }));
        if (!picks.length) {
          void vscode6.window.showInformationMessage("No servers configured.");
          return;
        }
        const chosen = await vscode6.window.showQuickPick(picks, {
          placeHolder: "Select server to delete"
        });
        urlToDelete = chosen?.label;
      }
      if (!urlToDelete) return;
      const updated = existing.filter((s) => s.url !== urlToDelete);
      if (updated.length < existing.length) {
        await cfg.update("servers", updated, vscode6.ConfigurationTarget.Global);
      } else {
        void vscode6.window.showWarningMessage(
          "The primary server URL can only be changed in Cantica Studio settings."
        );
      }
    })
  );
  context.subscriptions.push(
    vscode6.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("canticaScores")) {
        settings = readSettings();
        client = new StudioClient(settings.studioBaseUrl);
        ActorsPanel.current?.updateSettings(settings, client);
        fsProvider.updateRoot(songbooksRoot(settings.canticaHome));
        refreshProviders();
      }
    })
  );
  void vscode6.commands.executeCommand("setContext", "canticaScores.songbookViewMode", "tree");
  for (const ext of ["jsonld", "json", "yaml", "yml"]) {
    const watcher = vscode6.workspace.createFileSystemWatcher(
      new vscode6.RelativePattern(songbooksDir(settings.canticaHome), `**/*.${ext}`)
    );
    watcher.onDidCreate(() => refreshProviders());
    watcher.onDidDelete(() => refreshProviders());
    context.subscriptions.push(watcher);
  }
  const dirWatcher = vscode6.workspace.createFileSystemWatcher(
    new vscode6.RelativePattern(songbooksDir(settings.canticaHome), "*")
  );
  dirWatcher.onDidCreate(() => refreshProviders());
  dirWatcher.onDidDelete(() => refreshProviders());
  dirWatcher.onDidChange(() => refreshProviders());
  context.subscriptions.push(dirWatcher);
  let reloadTimer;
  context.subscriptions.push(
    vscode6.workspace.onDidSaveTextDocument(async (doc) => {
      const panel = ActorsPanel.current;
      if (!panel) return;
      const activeSongbook = panel.activeSongbookUri;
      if (!activeSongbook) return;
      if (doc.uri.fsPath !== activeSongbook.fsPath) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        try {
          const raw = JSON.parse(doc.getText());
          const graph = parseGraph(raw);
          await client.saveGraph(graph);
          await panel.pushGraph();
        } catch {
        }
      }, 400);
    })
  );
  void (async () => {
    await vscode6.workspace.fs.createDirectory(songbooksDir(settings.canticaHome));
    refreshProviders();
    if (settings.studioMode === "local" && settings.autoStartStudio) {
      setStatusStarting();
      await studio.ensureRunning();
      settings = readSettings();
      client = new StudioClient(settings.studioBaseUrl);
      void ActorsPanel.refreshProviderModels(client);
    }
  })();
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
