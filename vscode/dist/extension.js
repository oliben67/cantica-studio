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
var vscode4 = __toESM(require("vscode"));

// src/actors-panel.ts
var vscode = __toESM(require("vscode"));
var ActorsPanel = class _ActorsPanel {
  static viewType = "canticaScores.panel";
  static current;
  panel;
  disposables = [];
  settings;
  client;
  fileSaveWatcher;
  static show(context, client, settings) {
    if (_ActorsPanel.current !== void 0) {
      _ActorsPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      _ActorsPanel.current.client = client;
      _ActorsPanel.current.settings = settings;
      return _ActorsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      _ActorsPanel.viewType,
      "Cantica Studio",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
        retainContextWhenHidden: true
      }
    );
    _ActorsPanel.current = new _ActorsPanel(panel, context, client, settings);
    return _ActorsPanel.current;
  }
  constructor(panel, context, client, settings) {
    this.panel = panel;
    this.client = client;
    this.settings = settings;
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
        break;
      case "saveGraph": {
        const graph = raw["graph"];
        try {
          await this.client.saveGraph(graph);
          await this.registerFileSaveWatcher(graph);
        } catch (err) {
          void vscode.window.showErrorMessage(`Save failed: ${String(err)}`);
        }
        break;
      }
      case "addActor":
        break;
      case "runActor": {
        const name = raw["name"];
        const instruction = raw["instruction"];
        try {
          const output = await this.client.instructActor(name, instruction);
          await this.post({ type: "actorOutput", name, output });
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "fireEvent": {
        const name = raw["name"];
        const eventName = raw["eventName"];
        const context = raw["context"] ?? "";
        try {
          const output = await this.client.fireEvent(name, eventName, context);
          await this.post({ type: "actorOutput", name, output });
        } catch (err) {
          await this.post({ type: "error", message: String(err) });
        }
        break;
      }
      case "stopActor": {
        const name = raw["name"];
        try {
          await this.client.stopActor(name);
          await this.post({ type: "actorStatus", name, running: false });
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
  updateSettings(settings, client) {
    this.settings = settings;
    this.client = client;
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
            void this.client.fireEvent(actor.name, evt.name, uri.fsPath).then((output) => {
              void this.post({ type: "actorOutput", name: actor.name, output });
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
    _ActorsPanel.current = void 0;
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

// src/agents-provider.ts
var vscode2 = __toESM(require("vscode"));
var AgentItem = class extends vscode2.TreeItem {
  constructor(label, collapsibleState, namespace, promptName) {
    super(label, collapsibleState);
    this.label = label;
    this.collapsibleState = collapsibleState;
    this.namespace = namespace;
    this.promptName = promptName;
    if (namespace !== void 0 && promptName !== void 0) {
      this.description = namespace;
      this.iconPath = new vscode2.ThemeIcon("robot");
      this.contextValue = "agent";
      this.tooltip = new vscode2.MarkdownString(
        `**${promptName}** \`${namespace}\`

Drag onto the workflow canvas or click to open in browser.`,
        true
      );
      this.command = {
        command: "canticaScores.openPanel",
        title: "Open Workflow Canvas",
        arguments: []
      };
    } else {
      this.iconPath = new vscode2.ThemeIcon("symbol-namespace");
      this.contextValue = "namespace";
    }
  }
};
var AgentsProvider = class {
  _onDidChangeTreeData = new vscode2.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  namespaces = [];
  promptsByNamespace = /* @__PURE__ */ new Map();
  errorMessage;
  update(namespaces, prompts) {
    this.namespaces = namespaces;
    this.errorMessage = void 0;
    this.promptsByNamespace.clear();
    for (const prompt of prompts) {
      const list = this.promptsByNamespace.get(prompt.namespace) ?? [];
      list.push(prompt);
      this.promptsByNamespace.set(prompt.namespace, list);
    }
    this._onDidChangeTreeData.fire();
  }
  setError(message) {
    this.errorMessage = message;
    this._onDidChangeTreeData.fire();
  }
  refresh() {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element) {
    return element;
  }
  getChildren(element) {
    if (this.errorMessage) {
      const item = new AgentItem(
        `Error: ${this.errorMessage}`,
        vscode2.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode2.ThemeIcon("warning");
      return [item];
    }
    if (!element) {
      if (this.namespaces.length === 0) {
        const item = new AgentItem("No actors loaded", vscode2.TreeItemCollapsibleState.None);
        item.iconPath = new vscode2.ThemeIcon("info");
        return [item];
      }
      return this.namespaces.map(
        (ns) => new AgentItem(
          ns.name,
          vscode2.TreeItemCollapsibleState.Collapsed,
          ns.name,
          void 0
        )
      );
    }
    const prompts = this.promptsByNamespace.get(element.label) ?? [];
    return prompts.map(
      (p) => new AgentItem(
        p.name,
        vscode2.TreeItemCollapsibleState.None,
        element.label,
        p.name
      )
    );
  }
};

// src/studio-client.ts
function studioUrl(path2, port) {
  return `http://localhost:${port}${path2}`;
}
function headers(token) {
  const h = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}
var StudioClient = class {
  port;
  constructor(port = 8043) {
    this.port = port;
  }
  url(path2) {
    return studioUrl(path2, this.port);
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
      const r = await fetch(this.url("/v1/graph"));
      if (!r.ok) return null;
      const raw = await r.json();
      return _parseGraph(raw);
    } catch {
      return null;
    }
  }
  async saveGraph(graph) {
    const r = await fetch(this.url("/v1/graph"), {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ data: _serializeGraph(graph) })
    });
    if (!r.ok) throw new Error(`Save failed: ${r.status}`);
  }
  // ── Prompts ──────────────────────────────────────────────────────────────────
  async fetchPrompts(servers) {
    try {
      const r = await fetch(this.url("/v1/prompts"), { signal: AbortSignal.timeout(8e3) });
      if (!r.ok) return [];
      return r.json();
    } catch {
      return [];
    }
  }
  // ── Runtime ──────────────────────────────────────────────────────────────────
  async listRunning() {
    const r = await fetch(this.url("/v1/runtime/actors"));
    if (!r.ok) return [];
    return r.json();
  }
  async startActor(def) {
    const body = {
      name: def.name,
      define_prompt: def.definePrompt.uri ?? def.definePrompt.content ?? "",
      provider: def.provider,
      model: def.model,
      max_tokens: def.maxTokens,
      max_history: def.maxHistory,
      prompt_events: def.promptEvents.map((e) => ({
        name: e.name,
        prompt: e.prompt.uri ?? e.prompt.content ?? "",
        filePattern: e.filePattern
      })),
      cron_jobs: def.cronJobs.map((c) => ({
        schedule: c.schedule,
        prompt: c.prompt.uri ?? c.prompt.content ?? ""
      })),
      outbox: {}
    };
    const r = await fetch(this.url("/v1/runtime/actors"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Failed to start actor: ${r.status}`);
  }
  async stopActor(name) {
    await fetch(this.url(`/v1/runtime/actors/${encodeURIComponent(name)}`), { method: "DELETE" });
  }
  async instructActor(name, instruction) {
    const r = await fetch(this.url(`/v1/runtime/actors/${encodeURIComponent(name)}/instruct`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction })
    });
    if (!r.ok) throw new Error(`Instruct failed: ${r.status}`);
    const data = await r.json();
    return data.output;
  }
  async fireEvent(name, eventName, context = "") {
    const r = await fetch(
      this.url(`/v1/runtime/actors/${encodeURIComponent(name)}/event/${encodeURIComponent(eventName)}`),
      { method: "POST", headers: headers(), body: JSON.stringify({ context }) }
    );
    if (!r.ok) throw new Error(`Fire event failed: ${r.status}`);
    const data = await r.json();
    return data.output;
  }
};
function _parseGraph(raw) {
  const actors = (raw["actors"] ?? []).map(_parseActor);
  const edges = (raw["edges"] ?? []).map(_parseEdge);
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
    return {
      name: e["name"] ?? "",
      prompt: _parseRef(e["prompt"]),
      ...fp ? { filePattern: fp } : {}
    };
  });
  const crons = (r["cronJobs"] ?? []).map((c) => ({
    schedule: c["schedule"] ?? "",
    prompt: _parseRef(c["prompt"])
  }));
  return {
    id: r["@id"] ?? "",
    name: r["name"] ?? "",
    definePrompt: _parseRef(r["definePrompt"]),
    provider: r["provider"] ?? "claude",
    model: r["model"] ?? "claude-sonnet-4-6",
    maxTokens: r["maxTokens"] ?? 4096,
    maxHistory: r["maxHistory"] ?? 10,
    position: { x: pos.x ?? 0, y: pos.y ?? 0 },
    promptEvents: events,
    cronJobs: crons
  };
}
function _parseEdge(r) {
  const te = r["targetEvent"];
  return {
    id: r["@id"] ?? "",
    from: r["from"] ?? "",
    to: r["to"] ?? "",
    ...te ? { targetEvent: te } : {},
    prompt: _parseRef(r["prompt"]),
    label: r["label"] ?? ""
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
function _serializeGraph(g) {
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
    "@type": "AIActor",
    "@id": a.id,
    "name": a.name,
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
      ...e.filePattern ? { "filePattern": e.filePattern } : {}
    })),
    "cronJobs": a.cronJobs.map((c) => ({
      "@type": "CronJob",
      "schedule": c.schedule,
      "prompt": _serializeRef(c.prompt)
    }))
  };
}
function _serializeEdge(e) {
  return {
    "@type": "ActorMessage",
    "@id": e.id,
    "from": e.from,
    "to": e.to,
    ...e.targetEvent ? { "targetEvent": e.targetEvent } : { "targetEvent": null },
    "prompt": _serializeRef(e.prompt),
    "label": e.label
  };
}
function _serializeRef(r) {
  if (r.uri) return r.uri;
  if (r.content) return r.content;
  return {};
}

// src/studioManager.ts
var child_process = __toESM(require("node:child_process"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));
var vscode3 = __toESM(require("vscode"));
var IMAGE = "cantica-studio-api:latest";
var CONTAINER = "cantica-studio-api";
var INTERNAL_PORT = 8043;
var StudioManager = class _StudioManager {
  outputChannel;
  constructor() {
    this.outputChannel = vscode3.window.createOutputChannel("Cantica Studio");
  }
  dispose() {
    this.outputChannel.dispose();
  }
  /** Resolved canticaHome from settings or OS default. */
  static canticaHome() {
    const cfg = vscode3.workspace.getConfiguration("canticaScores");
    const configured = cfg.get("canticaHome") ?? "";
    return configured || path.join(os.homedir(), ".cantica");
  }
  /** Port for the local studio API (from settings or default). */
  static studioPort() {
    const cfg = vscode3.workspace.getConfiguration("canticaScores");
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
      `CANTICA_PORT=${INTERNAL_PORT}`,
      IMAGE
    ];
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
      void vscode3.window.showErrorMessage(
        "Docker is required for the local Cantica Studio. Install Docker Desktop and try again.",
        "Get Docker"
      ).then((choice) => {
        if (choice === "Get Docker") {
          void vscode3.env.openExternal(vscode3.Uri.parse("https://www.docker.com/products/docker-desktop/"));
        }
      });
      return void 0;
    }
    if (await this.isRunning()) {
      return _StudioManager.studioUrl();
    }
    return vscode3.window.withProgress(
      {
        location: vscode3.ProgressLocation.Notification,
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
            void vscode3.window.showErrorMessage(
              "Cantica Studio API did not become healthy in time. See Output panel."
            );
            return void 0;
          }
          return _StudioManager.studioUrl();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.outputChannel.appendLine(`[studio] Error: ${message}`);
          this.outputChannel.show(true);
          void vscode3.window.showErrorMessage(`Cantica Studio: ${message}`);
          return void 0;
        }
      }
    );
  }
};

// src/extension.ts
var LOCAL_STUDIO_URL = "http://localhost:8043";
function readSettings() {
  const cfg = vscode4.workspace.getConfiguration("canticaScores");
  const serverUrl = cfg.get("serverUrl") ?? LOCAL_STUDIO_URL;
  const authToken = cfg.get("authToken") ?? "";
  const rawServers = cfg.get("servers") ?? [];
  const servers = [
    { url: serverUrl, authToken },
    ...rawServers.filter((s) => s.url && s.url !== serverUrl).map((s) => ({ url: s.url, authToken: s.authToken ?? "" }))
  ];
  return {
    servers,
    serverUrl,
    authToken,
    explorerSide: cfg.get("explorerSide") ?? "left",
    canticaHome: cfg.get("canticaHome") ?? "",
    studioPort: cfg.get("studioPort") ?? 8043,
    autoStartStudio: cfg.get("autoStartStudio") ?? true,
    graphFile: cfg.get("graphFile") ?? ".vscode/actors.jsonld"
  };
}
function isLocalStudio(url) {
  return url.startsWith("http://localhost:8043") || url.startsWith("http://127.0.0.1:8043");
}
function activate(context) {
  let settings = readSettings();
  let client = new StudioClient(settings.studioPort);
  const provider = new AgentsProvider();
  const studio = new StudioManager();
  context.subscriptions.push(studio);
  const treeView = vscode4.window.createTreeView("canticaScores.agentsView", {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    vscode4.commands.registerCommand("canticaScores.openPanel", () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph();
    }),
    vscode4.commands.registerCommand("canticaScores.newActor", () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph().then(() => {
        void panel["panel"]?.webview.postMessage({ type: "addActor" });
      });
    }),
    vscode4.commands.registerCommand("canticaScores.saveGraph", async () => {
      void vscode4.commands.executeCommand("canticaScores.openPanel");
      void vscode4.window.showInformationMessage("Use the Save button in the Actor Studio canvas.");
    }),
    vscode4.commands.registerCommand("canticaScores.loadGraph", async () => {
      const panel = ActorsPanel.show(context, client, settings);
      await panel.pushGraph();
    }),
    vscode4.commands.registerCommand("canticaScores.configureServer", async () => {
      await vscode4.commands.executeCommand("workbench.action.openSettings", "canticaScores");
    }),
    vscode4.commands.registerCommand("canticaScores.startLocalStudio", async () => {
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new StudioClient(settings.studioPort);
        void vscode4.window.showInformationMessage(`Studio API running at ${url}`);
      }
    }),
    vscode4.commands.registerCommand("canticaScores.stopLocalStudio", async () => {
      await studio.stop();
      void vscode4.window.showInformationMessage("Studio API stopped.");
    })
  );
  context.subscriptions.push(
    vscode4.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("canticaScores")) {
        settings = readSettings();
        client = new StudioClient(settings.studioPort);
        ActorsPanel["current"]?.updateSettings(settings, client);
      }
    })
  );
  void (async () => {
    if (settings.autoStartStudio && isLocalStudio(settings.serverUrl)) {
      await studio.ensureRunning();
      settings = readSettings();
      client = new StudioClient(settings.studioPort);
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
