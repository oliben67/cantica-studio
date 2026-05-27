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

// src/agents-panel.ts
var vscode = __toESM(require("vscode"));
var AgentsPanel = class _AgentsPanel {
  constructor(panel, context, provider, client, settings) {
    this.provider = provider;
    this.client = client;
    this.panel = panel;
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
  static viewType = "canticaScores.panel";
  static current;
  panel;
  disposables = [];
  settings;
  static show(context, provider, client, settings) {
    if (_AgentsPanel.current !== void 0) {
      _AgentsPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return _AgentsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      _AgentsPanel.viewType,
      "Cantica Scores",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview")
        ],
        retainContextWhenHidden: true
      }
    );
    _AgentsPanel.current = new _AgentsPanel(panel, context, provider, client, settings);
    return _AgentsPanel.current;
  }
  async handleMessage(msg) {
    if (typeof msg !== "object" || msg === null) return;
    const raw = msg;
    switch (raw["type"]) {
      case "ready":
        await this.pushAll();
        break;
      case "refresh":
        await this.fetchAndPush();
        break;
      case "explorerSideChanged": {
        const side = raw["side"];
        if (side === "left" || side === "right") {
          await vscode.workspace.getConfiguration().update("canticaScores.explorerSide", side, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "openPrompt": {
        const ns = raw["namespace"];
        const name = raw["name"];
        if (typeof ns === "string" && typeof name === "string") {
          const url = `${this.settings.serverUrl.replace(/\/$/, "")}/v1/prompts/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }
      case "saveWorkflow":
        await vscode.window.showInformationMessage(
          "Workflow saved (in-memory). Persistence coming soon."
        );
        break;
    }
  }
  async fetchAndPush() {
    try {
      const [namespaces, prompts] = await Promise.all([
        this.client.fetchNamespaces(),
        this.client.fetchPrompts()
      ]);
      this.provider.update(namespaces, prompts);
      const msg = { type: "updateAgents", namespaces, prompts };
      await this.panel.webview.postMessage(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.provider.setError(message);
      const msg = { type: "error", message };
      await this.panel.webview.postMessage(msg);
    }
  }
  async pushAll() {
    const settingsMsg = { type: "updateSettings", settings: this.settings };
    await this.panel.webview.postMessage(settingsMsg);
    await this.fetchAndPush();
  }
  updateSettings(settings) {
    this.settings = settings;
    const msg = { type: "updateSettings", settings };
    void this.panel.webview.postMessage(msg);
  }
  buildHtml(context) {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "index.css")
    );
    const nonce = generateNonce();
    return (
      /* html */
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 img-src ${webview.cspSource} data:;" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Cantica Scores</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    );
  }
  dispose() {
    _AgentsPanel.current = void 0;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
};
function generateNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => {
    const idx = Math.floor(Math.random() * chars.length);
    return chars[idx] ?? "A";
  }).join("");
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

// src/cantica-client.ts
var CanticaClient = class {
  baseUrl;
  authToken;
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken;
  }
  buildHeaders() {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }
  async fetchNamespaces() {
    const url = `${this.baseUrl}/v1/namespaces`;
    const response = await fetch(url, { headers: this.buildHeaders() });
    if (!response.ok) {
      throw new Error(
        `Cantica server error fetching namespaces: ${response.status} ${response.statusText}`
      );
    }
    return response.json();
  }
  async fetchPrompts() {
    const url = `${this.baseUrl}/v1/prompts`;
    const response = await fetch(url, { headers: this.buildHeaders() });
    if (!response.ok) {
      throw new Error(
        `Cantica server error fetching prompts: ${response.status} ${response.statusText}`
      );
    }
    return response.json();
  }
  /** Health-check: resolves to true if the server is reachable. */
  async ping() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5e3)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
};

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
  return {
    serverUrl: cfg.get("serverUrl") ?? LOCAL_STUDIO_URL,
    authToken: cfg.get("authToken") ?? "",
    explorerSide: cfg.get("explorerSide") ?? "left"
  };
}
function isLocalStudio(url) {
  return url.startsWith("http://localhost:8043") || url.startsWith("http://127.0.0.1:8043");
}
function activate(context) {
  let settings = readSettings();
  let client = new CanticaClient(settings.serverUrl, settings.authToken);
  const provider = new AgentsProvider();
  const studio = new StudioManager();
  context.subscriptions.push(studio);
  const treeView = vscode4.window.createTreeView("canticaScores.agentsView", {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);
  async function ensureLocalStudio() {
    const url = await studio.ensureRunning();
    if (url) {
      const cfg = vscode4.workspace.getConfiguration("canticaScores");
      await cfg.update("serverUrl", url, vscode4.ConfigurationTarget.Global);
    }
    return url;
  }
  context.subscriptions.push(
    vscode4.commands.registerCommand("canticaScores.openPanel", () => {
      const panel = AgentsPanel.show(context, provider, client, settings);
      void panel.fetchAndPush();
    }),
    vscode4.commands.registerCommand("canticaScores.refreshAgents", async () => {
      try {
        const [namespaces, prompts] = await Promise.all([
          client.fetchNamespaces(),
          client.fetchPrompts()
        ]);
        provider.update(namespaces, prompts);
        void vscode4.window.showInformationMessage(
          `Loaded ${prompts.length} AI actors from ${settings.serverUrl}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        provider.setError(message);
        void vscode4.window.showErrorMessage(`Cantica: ${message}`);
      }
    }),
    vscode4.commands.registerCommand("canticaScores.configureServer", async () => {
      await vscode4.commands.executeCommand("workbench.action.openSettings", "canticaScores");
    }),
    vscode4.commands.registerCommand("canticaScores.startLocalStudio", async () => {
      const url = await ensureLocalStudio();
      if (url) {
        client = new CanticaClient(url, "");
        void vscode4.commands.executeCommand("canticaScores.refreshAgents");
      }
    }),
    vscode4.commands.registerCommand("canticaScores.stopLocalStudio", async () => {
      await studio.stop();
      void vscode4.window.showInformationMessage("Cantica Studio API stopped.");
    })
  );
  context.subscriptions.push(
    vscode4.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("canticaScores")) {
        settings = readSettings();
        client = new CanticaClient(settings.serverUrl, settings.authToken);
        void vscode4.commands.executeCommand("canticaScores.refreshAgents");
      }
    })
  );
  async function initialLoad() {
    const autoStart = vscode4.workspace.getConfiguration("canticaScores").get("autoStartStudio") ?? true;
    if (autoStart && isLocalStudio(settings.serverUrl)) {
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new CanticaClient(settings.serverUrl, settings.authToken);
      }
    }
    void vscode4.commands.executeCommand("canticaScores.refreshAgents");
  }
  void initialLoad();
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
