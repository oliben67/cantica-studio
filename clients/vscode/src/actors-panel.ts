import * as vscode from 'vscode';
import type { ActorGraph, ExtensionSettings, ProviderKeyId, ProviderKeyStatus, SetupState, ToWebview } from './types/index.js';
import { serializeGraph, parseGraph, type StudioClient } from './studio-client.js';
import { loadProviderKeys, saveProviderKeys } from './provider-keys.js';
import { SETUP_DONE_KEY, isSetupDone, publishSetupContext } from './setup-wizard.js';

const PROVIDER_ENV_KEYS: Record<ProviderKeyId, string> = {
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  geminiApiKey: 'GEMINI_API_KEY',
  githubToken: 'GITHUB_TOKEN',
};

export class ActorsPanel {
  static readonly viewType = 'canticaScores.panel';
  private static readonly _panels: Map<string, ActorsPanel> = new Map();

  static get current(): ActorsPanel | undefined {
    return [...ActorsPanel._panels.values()].find(p => p.panel.active)
      ?? [...ActorsPanel._panels.values()].at(-1);
  }

  /** Call after studio API becomes ready so the webview gets a fresh model list. */
  static async refreshProviderModels(client: StudioClient): Promise<void> {
    for (const p of ActorsPanel._panels.values()) {
      p.client = client;
      p._attachLogCallback();
      await p.pushProviderModels(true);
    }
  }

  /** Broadcast a studio status update to every open panel. */
  static broadcastStudioStatus(msg: ToWebview & { type: 'studioStatus' }): void {
    for (const p of ActorsPanel._panels.values()) {
      p.setStudioStatus(msg);
    }
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private settings: ExtensionSettings;
  private client: StudioClient;
  /** Modal to open once the webview reports ready (queued by commands). */
  private _pendingOpenModal: 'openSetup' | 'openProviderKeys' | null = null;
  private fileSaveWatcher: vscode.Disposable | undefined;
  private _notifPollTimer: ReturnType<typeof setInterval> | undefined;
  private _activeSongbookUri: vscode.Uri | undefined;
  /** True after stopSongbook until the next playSongbook. Prevents runActor from auto-restarting stopped actors. */
  private _workspaceStopped = false;
  get activeSongbookUri(): vscode.Uri | undefined { return this._activeSongbookUri; }

  /** Last studioStatus to send — queued before ready, posted immediately after. */
  private _pendingStudioStatus: (ToWebview & { type: 'studioStatus' }) | null = null;
  private _webviewReady = false;

  /** Push server health to the webview. Safe to call before ready fires. */
  setStudioStatus(msg: ToWebview & { type: 'studioStatus' }): void {
    this._pendingStudioStatus = msg;
    if (this._webviewReady) void this.post(msg);
  }

  /** Open or reveal the panel for a given URI. Each URI gets its own VS Code tab in the same editor group. */
  static show(
    context: vscode.ExtensionContext,
    client: StudioClient,
    settings: ExtensionSettings,
    uri?: vscode.Uri,
  ): ActorsPanel {
    if (uri) {
      const existing = ActorsPanel._panels.get(uri.fsPath);
      if (existing) {
        existing.panel.reveal(vscode.ViewColumn.Two, false);
        existing.client = client;
        existing.settings = settings;
        return existing;
      }
    } else {
      const last = [...ActorsPanel._panels.values()].at(-1);
      if (last) {
        last.panel.reveal(vscode.ViewColumn.Two, true);
        last.client = client;
        last.settings = settings;
        return last;
      }
    }

    const title = uri ? _displayName(uri) : 'Songbook';
    const panel = vscode.window.createWebviewPanel(
      ActorsPanel.viewType,
      title,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: uri !== undefined ? false : true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
        retainContextWhenHidden: true,
      },
    );
    return new ActorsPanel(panel, context, client, settings, uri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    client: StudioClient,
    settings: ExtensionSettings,
    uri?: vscode.Uri,
  ) {
    this.panel = panel;
    this.context = context;
    this.client = client;
    this.settings = settings;
    this._activeSongbookUri = uri;
    if (uri) ActorsPanel._panels.set(uri.fsPath, this);
    this._attachLogCallback();
    this.panel.webview.html = this.buildHtml(context);
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons', 'activitybar.svg');

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Poll for background activity (cron jobs, events) while the panel is open.
    this._notifPollTimer = setInterval(() => {
      if (this.panel.visible) {
        void this.pushNotifications();
      }
    }, 3000);

    this.panel.webview.onDidReceiveMessage(
      (msg: unknown) => void this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (typeof msg !== 'object' || msg === null) return;
    const raw = msg as Record<string, unknown>;

    switch (raw['type']) {
      case 'ready':
        this._webviewReady = true;
        await this.pushSettings();
        await this.pushGraph();
        await this.pushPrompts();
        void this.pushProviderModels(true);
        if (this._pendingStudioStatus) void this.post(this._pendingStudioStatus);
        await this.post({ type: 'activeSongbookChanged', path: this._activeSongbookUri?.fsPath ?? null });
        // The backend outlives the webview — restore running state and resolved
        // models for actors that were started before this webview loaded.
        void this.pushRunningState();
        void this.pushSetupState();
        if (this._pendingOpenModal) {
          void this.post({ type: this._pendingOpenModal });
          this._pendingOpenModal = null;
        }
        break;

      case 'saveGraph': {
        const graph = raw['graph'] as ActorGraph;
        const errs: string[] = [];
        try {
          await this.client.saveGraph(graph);
          await this.registerFileSaveWatcher(graph);
        } catch (err) {
          errs.push(`Studio API: ${String(err)}`);
        }
        const songbookUri = this._activeSongbookUri ?? await this.detectSongbookUri(graph);
        if (songbookUri) {
          try {
            const content = Buffer.from(JSON.stringify(serializeGraph(graph), null, 2), 'utf-8');
            await vscode.workspace.fs.writeFile(songbookUri, content);
            if (!this._activeSongbookUri) this.setActiveSongbook(songbookUri);
          } catch (err) {
            errs.push(`File: ${String(err)}`);
          }
        }
        if (errs.length > 0) {
          void vscode.window.showErrorMessage(`Save failed: ${errs.join('; ')}`);
        }
        break;
      }

      case 'addActor':
        // The webview handles node creation internally; extension just acknowledges
        break;

      case 'openSongbook': {
        const uri = raw['uri'] as string | undefined;
        const content = raw['content'] as Record<string, unknown> | undefined;
        try {
          let graph: ActorGraph;
          let songbookUri: vscode.Uri | undefined;
          if (uri) {
            songbookUri = vscode.Uri.parse(uri);
            const bytes = await vscode.workspace.fs.readFile(songbookUri);
            graph = parseGraph(JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>, songbookUri.fsPath);
            // Write back immediately so compound IDs are persisted in the file.
            const migrated = Buffer.from(JSON.stringify(serializeGraph(graph), null, 2), 'utf-8');
            await vscode.workspace.fs.writeFile(songbookUri, migrated);
          } else if (content) {
            graph = parseGraph(content);
          } else {
            break;
          }
          try { await this.client.saveGraph(graph); } catch { /* API may not be running */ }
          if (songbookUri) this.setActiveSongbook(songbookUri);
          await this.post({ type: 'loadGraph', graph });
          await this.post({ type: 'activeSongbookChanged', path: songbookUri?.fsPath ?? null });
        } catch (err) {
          void vscode.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
        }
        break;
      }

      case 'runActor': {
        const name = raw['name'] as string;
        const instruction = raw['instruction'] as string;
        const isStartOnly = instruction === '__start__';

        // ── 1. Check whether the actor is already running on the backend ──────
        let alreadyRunning: boolean;
        try {
          const runningNames = await this.client.listRunning();
          alreadyRunning = runningNames.includes(name);
        } catch (err) {
          await this.post({
            type: 'actorOutput', name,
            output: `⚠ Studio API not reachable — ${String(err)}`,
          });
          break;
        }

        // ── 2. Start the actor if not yet running ─────────────────────────────
        if (!alreadyRunning && this._workspaceStopped && !isStartOnly) {
          await this.post({
            type: 'actorOutput', name,
            output: '⏸ Workspace stopped — click Play (▶) to start all actors before sending prompts.',
          });
          break;
        }
        if (!alreadyRunning) {
          const graph = await this.client.loadGraph(this._activeSongbookUri?.fsPath);
          const def = graph?.actors.find(a => a.name === name);
          if (!graph || !def) {
            await this.post({
              type: 'actorOutput', name,
              output: `⚠ Actor "${name}" not found in the graph — open the songbook first.`,
            });
            break;
          }
          const tag = def.actorType === 'ai'
            ? `${def.provider} / ${def.model}`
            : def.actorType;
          await this.post({ type: 'actorOutput', name, output: `⏳ Initialising ${tag}…` });
          try {
            const { initialOutput } = await this.client.startActor(def, this._activeSongbookUri?.fsPath);
            if (initialOutput) {
              await this.post({ type: 'actorOutput', name, output: initialOutput });
            }
            // Copilot 'auto' actors are not ready until the model probe finishes —
            // the Ready line is posted when the actorModelResolved notification arrives.
            const resolving = def.actorType === 'ai' && def.provider === 'copilot' && def.model === 'auto';
            await this.post({ type: 'actorOutput', name, output: resolving ? '⏳ Resolving model…' : `✓ Ready · ${tag}` });
            // Push the graph with compound IDs so actor nodes reflect the updated IDs.
            await this.post({ type: 'loadGraph', graph });
            await this._writeCompoundIds(graph);
            await this.post({ type: 'actorStatus', name, running: true });
          } catch (err) {
            await this.post({ type: 'actorOutput', name, output: `⚠ Start failed: ${String(err)}` });
            break;
          }
        } else if (isStartOnly) {
          await this.post({ type: 'actorOutput', name, output: `· ${name} is already running` });
          await this.post({ type: 'actorStatus', name, running: true });
          await this.pushResolvedModels([name]);
        }

        if (isStartOnly) break;

        // ── 3. Send the instruction ───────────────────────────────────────────
        try {
          const { output } = await this.client.instructActor(name, instruction);
          await this.post({ type: 'actorOutput', name, output });
          // Push any actor-to-actor forwarded prompts that occurred during this
          // call (e.g. the LLM using the fire_event tool to route output to B).
          await this.pushNotifications();
        } catch (err) {
          await this.post({ type: 'actorOutput', name, output: `⚠ Prompt failed: ${String(err)}` });
        }
        break;
      }

      case 'fireEvent': {
        const name = raw['name'] as string;
        const eventName = raw['eventName'] as string;
        const context = (raw['context'] as string | undefined) ?? '';
        try {
          const result = await this.client.fireEvent(name, eventName, context);
          await this.post({ type: 'actorOutput', name, output: result.output });
          await this.pushForwarded(result.forwarded);
          await this.pushNotifications();
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'refreshActor': {
        const name = raw['name'] as string;
        const answer = await vscode.window.showWarningMessage(
          `Refresh actor "${name}"? It will be stopped and restarted. Conversation history is preserved.`,
          { modal: true },
          'Refresh',
        );
        if (answer !== 'Refresh') break;

        try {
          await this.client.stopActor(name);
          await this.post({ type: 'actorStatus', name, running: false });
          await this.post({ type: 'actorPaused', name, paused: false });
        } catch (err) {
          await this.post({ type: 'error', message: `Stop failed: ${String(err)}` });
          break;
        }

        const graph = await this.client.loadGraph(this._activeSongbookUri?.fsPath);
        const def = graph?.actors.find(a => a.name === name);
        if (!graph || !def) {
          await this.post({ type: 'actorOutput', name, output: '⚠ Actor not found in graph — could not restart' });
          break;
        }

        await this.post({ type: 'actorOutput', name, output: `♻ Refreshing ${name}…` });
        try {
          const { initialOutput } = await this.client.startActor(def, this._activeSongbookUri?.fsPath);
          if (initialOutput) {
            await this.post({ type: 'actorOutput', name, output: initialOutput });
          }
          const resolving = def.actorType === 'ai' && def.provider === 'copilot' && def.model === 'auto';
          await this.post({ type: 'actorOutput', name, output: resolving ? '⏳ Resolving model…' : '✓ Ready' });
          await this.post({ type: 'loadGraph', graph });
          await this._writeCompoundIds(graph);
          await this.post({ type: 'actorStatus', name, running: true });
        } catch (err) {
          await this.post({ type: 'error', message: `Restart failed: ${String(err)}` });
        }
        break;
      }

      case 'stopActor': {
        const name = raw['name'] as string;
        try {
          await this.client.stopActor(name);
          await this.post({ type: 'actorStatus', name, running: false });
          await this.post({ type: 'actorPaused', name, paused: false });
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'pauseActor': {
        const name = raw['name'] as string;
        try {
          await this.client.pauseActor(name);
          await this.post({ type: 'actorPaused', name, paused: true });
          await this.post({ type: 'actorOutput', name, output: '⏸ Paused — prompts will be queued' });
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'resumeActor': {
        const name = raw['name'] as string;
        try {
          await this.client.resumeActor(name);
          await this.post({ type: 'actorPaused', name, paused: false });
          await this.post({ type: 'actorOutput', name, output: '▶ Resumed' });
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'refreshPrompts':
        await this.pushPrompts();
        break;

      case 'explorerSideChanged': {
        const side = raw['side'];
        if (side === 'left' || side === 'right') {
          await vscode.workspace
            .getConfiguration()
            .update('canticaScores.explorerSide', side, vscode.ConfigurationTarget.Global);
        }
        break;
      }

      case 'configureServer':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'canticaScores');
        break;

      case 'startLocalStudio':
        await vscode.commands.executeCommand('canticaScores.startLocalStudio');
        break;

      case 'stopLocalStudio':
        await vscode.commands.executeCommand('canticaScores.stopLocalStudio');
        break;

      case 'playSongbook': {
        this._workspaceStopped = false;
        const graph = await this.client.loadGraph(this._activeSongbookUri?.fsPath);
        if (!graph) break;
        // Push compound IDs to the webview before starting any actors.
        await this.post({ type: 'loadGraph', graph });
        await this._writeCompoundIds(graph);
        let runningNames: string[] = [];
        try { runningNames = await this.client.listRunning(); } catch { /* ignore */ }
        const alreadyRunning: string[] = [];
        for (const actor of graph.actors) {
          if (runningNames.includes(actor.name)) {
            await this.post({ type: 'actorOutput', name: actor.name, output: `· ${actor.name} already running` });
            await this.post({ type: 'actorStatus', name: actor.name, running: true });
            alreadyRunning.push(actor.name);
            continue;
          }
          const tag = actor.actorType === 'ai'
            ? `${actor.provider} / ${actor.model}`
            : actor.actorType;
          await this.post({ type: 'actorOutput', name: actor.name, output: `⏳ Initialising ${tag}…` });
          try {
            const { initialOutput } = await this.client.startActor(actor, this._activeSongbookUri?.fsPath);
            if (initialOutput) {
              await this.post({ type: 'actorOutput', name: actor.name, output: initialOutput });
            }
            const resolving = actor.actorType === 'ai' && actor.provider === 'copilot' && actor.model === 'auto';
            await this.post({ type: 'actorOutput', name: actor.name, output: resolving ? '⏳ Resolving model…' : `✓ Ready · ${tag}` });
            await this.post({ type: 'actorStatus', name: actor.name, running: true });
          } catch (err) {
            await this.post({ type: 'actorOutput', name: actor.name, output: `⚠ Start failed: ${String(err)}` });
          }
        }
        if (alreadyRunning.length) await this.pushResolvedModels(alreadyRunning);
        break;
      }

      case 'stopSongbook': {
        this._workspaceStopped = true;
        try {
          const { stopped } = await this.client.stopAllActors();
          for (const name of stopped) {
            await this.post({ type: 'actorStatus', name, running: false });
          }
        } catch {
          // ignore
        }
        break;
      }

      case 'requestSetupState':
        await this.pushSetupState();
        break;

      case 'saveSetup': {
        const mode = raw['mode'] as 'local' | 'remote';
        const runMode = raw['runMode'] as 'native' | 'container';
        const remoteUrl = ((raw['remoteUrl'] as string | undefined) ?? '').trim();
        if (mode !== 'local' && mode !== 'remote') break;
        if (runMode !== 'native' && runMode !== 'container') break;

        const cfg = vscode.workspace.getConfiguration('canticaScores');
        const prevMode = cfg.get<string>('studioMode') ?? 'local';
        const prevRunMode = cfg.get<string>('studioRunMode') ?? 'container';
        const wasDone = isSetupDone(this.context);

        await cfg.update('studioMode', mode, vscode.ConfigurationTarget.Global);
        await cfg.update('studioRunMode', runMode, vscode.ConfigurationTarget.Global);
        if (mode === 'remote' && remoteUrl) {
          await cfg.update('studioUrl', remoteUrl, vscode.ConfigurationTarget.Global);
        }
        await this.context.globalState.update(SETUP_DONE_KEY, true);
        publishSetupContext(this.context);
        await this.pushSetupState();

        // (Re)start the local server on first-time setup or when the mode changed.
        if (mode === 'local' && (!wasDone || prevMode !== 'local' || prevRunMode !== runMode)) {
          void vscode.commands.executeCommand('canticaScores.restartLocalStudio');
        }
        break;
      }

      case 'saveProviderKey': {
        const provider = raw['provider'] as ProviderKeyId;
        const key = ((raw['key'] as string | undefined) ?? '').trim();
        if (!(provider in PROVIDER_ENV_KEYS) || !key) break;
        const keys = await loadProviderKeys(this.context.secrets);
        keys[provider] = key;
        await saveProviderKeys(this.context.secrets, keys);
        void this.client.syncProviderKeys(keys);
        await this.pushSetupState();
        break;
      }

      case 'clearProviderKey': {
        const provider = raw['provider'] as ProviderKeyId;
        if (!(provider in PROVIDER_ENV_KEYS)) break;
        const keys = await loadProviderKeys(this.context.secrets);
        keys[provider] = '';
        await saveProviderKeys(this.context.secrets, keys);
        void this.client.syncProviderKeys(keys);
        await this.pushSetupState();
        break;
      }

      case 'requestAdminData':
        await this.pushAdminData();
        break;

      case 'activateUser':
        await this.adminAction(() => this.client.activateUser(raw['userId'] as string));
        break;

      case 'addUserFlag':
        await this.adminAction(() => this.client.addUserFlag(
          raw['userId'] as string, raw['flag'] as string, (raw['comment'] as string | undefined) ?? '',
        ));
        break;

      case 'removeUserFlag':
        await this.adminAction(() => this.client.removeUserFlag(
          raw['userId'] as string, raw['flagId'] as string,
        ));
        break;

      case 'addDirectoryMapping':
        await this.adminAction(() => this.client.addDirectoryMapping(
          raw['externalGroup'] as string, raw['roleName'] as string,
        ));
        break;

      case 'removeDirectoryMapping':
        await this.adminAction(() => this.client.removeDirectoryMapping(raw['mappingId'] as string));
        break;

      case 'secure:request': {
        // Relay for @cantica/secure-ui's bridge transport (Phase E). The token
        // stays here in the extension host and never enters the webview.
        const id = raw['id'] as number;
        const req = raw['request'] as { method: string; path: string; body?: unknown };
        try {
          const response = await this.client.secureRequest(req);
          await this.post({ type: 'secure:response', id, response });
        } catch (err) {
          await this.post({
            type: 'secure:response', id,
            response: { ok: false, status: 0, data: { detail: String(err) } },
          });
        }
        break;
      }
    }
  }

  /** Run an admin mutation, surface failures, refresh the admin snapshot. */
  private async adminAction(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      await this.post({ type: 'error', message: String(err) });
      void vscode.window.showErrorMessage(`Admin action failed: ${String(err)}`);
    }
    await this.pushAdminData();
  }

  /** Push the users/roles/mappings snapshot backing the admin screens. */
  private async pushAdminData(): Promise<void> {
    const [users, roles, mappings] = await Promise.all([
      this.client.listUsers(),
      this.client.listRoleNames(),
      this.client.listDirectoryMappings(),
    ]);
    await this.post({ type: 'adminData', data: { users, roles, mappings } });
  }

  /** Queue a modal to open — posts immediately when the webview is ready. */
  requestOpenModal(kind: 'openSetup' | 'openProviderKeys'): void {
    if (this._webviewReady) {
      void this.post({ type: kind });
    } else {
      this._pendingOpenModal = kind;
    }
  }

  /** Push current setup/provider-key state (presence only, never key material). */
  async pushSetupState(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('canticaScores');
    const keys = await loadProviderKeys(this.context.secrets);
    const status = (id: ProviderKeyId): ProviderKeyStatus =>
      process.env[PROVIDER_ENV_KEYS[id]]?.trim() ? 'env' : keys[id]?.trim() ? 'stored' : 'none';
    const state: SetupState = {
      mode: (cfg.get<string>('studioMode') ?? 'local') as 'local' | 'remote',
      runMode: (cfg.get<string>('studioRunMode') ?? 'container') as 'native' | 'container',
      remoteUrl: (cfg.get<string>('studioUrl') ?? '').trim(),
      setupDone: isSetupDone(this.context),
      keys: {
        anthropicApiKey: status('anthropicApiKey'),
        openaiApiKey: status('openaiApiKey'),
        geminiApiKey: status('geminiApiKey'),
        githubToken: status('githubToken'),
      },
    };
    await this.post({ type: 'setupState', state });
  }

  async pushGraph(): Promise<void> {
    const graph = await this.client.loadGraph(this._activeSongbookUri?.fsPath);
    if (graph) {
      await this.post({ type: 'loadGraph', graph });
      await this.registerFileSaveWatcher(graph);
    }
  }

  async pushPrompts(): Promise<void> {
    const prompts = await this.client.fetchPrompts(this.settings.servers);
    await this.post({ type: 'updatePrompts', prompts });
  }

  /** Push resolved models for running Copilot actors (the backend outlives the webview). */
  private async pushResolvedModels(names?: string[]): Promise<void> {
    const summaries = await this.client.fetchActorsSummary();
    for (const s of summaries) {
      if (names && !names.includes(s.name)) continue;
      if (s.provider === 'copilot' && s.model && s.model !== 'auto') {
        await this.post({ type: 'actorModelResolved', name: s.name, model: s.model });
      }
    }
  }

  /** Restore running/resolved state after a webview (re)load. */
  private async pushRunningState(): Promise<void> {
    let runningNames: string[] = [];
    try { runningNames = await this.client.listRunning(); } catch { return; }
    for (const name of runningNames) {
      await this.post({ type: 'actorStatus', name, running: true });
    }
    if (runningNames.length) await this.pushResolvedModels(runningNames);
  }

  async pushSettings(): Promise<void> {
    await this.post({ type: 'updateSettings', settings: this.settings });
  }

  async pushProviderModels(refresh = false): Promise<void> {
    let models = await this.client.fetchProviderModels(refresh);
    if (Object.keys(models).length === 0) {
      // API not yet ready — retry once after 3 s, still with refresh flag
      await new Promise(resolve => setTimeout(resolve, 3000));
      models = await this.client.fetchProviderModels(refresh);
    }
    if (Object.keys(models).length > 0) {
      await this.post({ type: 'providerModels', models });
    }
  }

  setActiveSongbook(uri: vscode.Uri | undefined): void {
    this._activeSongbookUri = uri;
    const name = uri?.path.split('/').pop()?.replace(/\.[^.]+$/, '');
    this.panel.title = name ?? 'Songbook';
  }

  private async detectSongbookUri(graph: ActorGraph): Promise<vscode.Uri | undefined> {
    const home = (this.settings.canticaHome ?? '').trim() || `${process.env['HOME'] ?? '~'}/.cantica`;
    const dir = vscode.Uri.file(`${home}/songbooks`);
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const candidates: vscode.Uri[] = [];
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.jsonld')) {
          candidates.push(vscode.Uri.joinPath(dir, name));
        } else if (type === vscode.FileType.Directory) {
          try {
            const subEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(dir, name));
            for (const [subName, subType] of subEntries) {
              if (subType === vscode.FileType.File && subName.endsWith('.jsonld')) {
                candidates.push(vscode.Uri.joinPath(dir, name, subName));
              }
            }
          } catch { /* skip unreadable sub-dirs */ }
        }
      }
      if (candidates.length === 1 && candidates[0]) {
        return candidates[0];
      }
      for (const uri of candidates) {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const raw = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>;
          if (raw['@id'] === graph.id || raw['name'] === graph.name) return uri;
        } catch { /* skip */ }
      }
    } catch { /* directory not found */ }
    return undefined;
  }

  private async _writeCompoundIds(graph: ActorGraph): Promise<void> {
    if (!this._activeSongbookUri) return;
    try {
      const content = Buffer.from(JSON.stringify(serializeGraph(graph), null, 2), 'utf-8');
      await vscode.workspace.fs.writeFile(this._activeSongbookUri, content);
    } catch {
      // Non-fatal: IDs are updated in-memory; the file will be synced on next save.
    }
  }

  private _attachLogCallback(): void {
    this.client.onLog = (entry) => { void this.post({ type: 'apiLog', entry }); };
    this.client.onWarning = (text) => { void this.post({ type: 'serverWarning', text }); };
  }

  updateSettings(settings: ExtensionSettings, client: StudioClient): void {
    this.settings = settings;
    this.client = client;
    this._attachLogCallback();
    void this.pushSettings();
    void this.pushPrompts();
  }

  private async registerFileSaveWatcher(graph: ActorGraph): Promise<void> {
    this.fileSaveWatcher?.dispose();

    const patterns = graph.actors
      .flatMap((a) => a.promptEvents)
      .filter((e) => !!e.filePattern)
      .map((e) => e.filePattern as string);

    if (patterns.length === 0) return;

    const watcher = vscode.workspace.createFileSystemWatcher(
      `{${patterns.join(',')}}`,
    );

    watcher.onDidChange((uri) => {
      for (const actor of graph.actors) {
        for (const evt of actor.promptEvents) {
          if (
            evt.filePattern &&
            vscode.languages.match({ pattern: evt.filePattern }, { uri, languageId: '' } as unknown as vscode.TextDocument) !== 0
          ) {
            void this.client.fireEvent(actor.name, evt.name, uri.fsPath).then(async (result) => {
              await this.post({ type: 'actorOutput', name: actor.name, output: result.output });
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

  async post(msg: ToWebview): Promise<void> {
    await this.panel.webview.postMessage(msg);
  }

  /** Push forwarded prompt+response pairs to the receiver's chat panel. */
  private async pushForwarded(forwarded: Array<{ name: string; prompt: string; output: string }>): Promise<void> {
    for (const fwd of forwarded) {
      const promptLine = fwd.prompt.replace(/[\r\n]+/g, ' ').trim();
      await this.post({ type: 'actorOutput', name: fwd.name, output: `> ${promptLine}` });
      await this.post({ type: 'actorOutput', name: fwd.name, output: fwd.output });
    }
  }

  /** Drain the runtime's notification log and push to every open panel.

      Drains are destructive on the backend and each panel polls on its own
      timer — whichever panel drains first must re-broadcast to all panels,
      otherwise notifications for actors shown in another songbook are lost. */
  private async pushNotifications(): Promise<void> {
    const notes = await this.client.drainNotifications();
    const targets = new Set<ActorsPanel>(ActorsPanel._panels.values());
    targets.add(this);
    const forwarded: Array<{ name: string; prompt: string; output: string }> = [];
    for (const note of notes) {
      if (note.type === 'actorModelResolved') {
        for (const p of targets) {
          void p.post({ type: 'actorModelResolved', name: note.name, model: note.model });
          // Fresh resolution — the start path deferred its Ready line for this.
          void p.post({ type: 'actorOutput', name: note.name, output: `✓ Ready · copilot / ${note.model} (auto)` });
        }
      } else {
        forwarded.push(note);
      }
    }
    for (const p of targets) {
      await p.pushForwarded(forwarded);
    }
    // Also drain MCP tool call log and forward as mcpLog messages.
    const mcpEntries = await this.client.drainMcpLog();
    for (const entry of mcpEntries) {
      for (const p of targets) {
        void p.post({ type: 'mcpLog', entry });
      }
    }
  }

  private buildHtml(context: vscode.ExtensionContext): string {
    const wv = this.panel.webview;
    const scriptUri = wv.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'index.js'),
    );
    const styleUri = wv.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'index.css'),
    );
    const nonce = _nonce();
    return /* html */ `<!DOCTYPE html>
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
</html>`;
  }

  dispose(): void {
    if (this._activeSongbookUri) ActorsPanel._panels.delete(this._activeSongbookUri.fsPath);
    if (this._notifPollTimer !== undefined) {
      clearInterval(this._notifPollTimer);
      this._notifPollTimer = undefined;
    }
    this.fileSaveWatcher?.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

function _displayName(uri: vscode.Uri): string {
  const base = uri.path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function _nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)] ?? 'A').join('');
}
