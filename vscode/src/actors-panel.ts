import * as vscode from 'vscode';
import type { ActorGraph, ExtensionSettings, ToWebview } from './types/index.js';
import { serializeGraph, parseGraph, type StudioClient } from './studio-client.js';

export class ActorsPanel {
  static readonly viewType = 'canticaScores.panel';
  private static _current: ActorsPanel | undefined;
  static get current(): ActorsPanel | undefined { return ActorsPanel._current; }

  /** Call after studio API becomes ready so the webview gets a fresh model list. */
  static async refreshProviderModels(client: StudioClient): Promise<void> {
    if (ActorsPanel._current) {
      ActorsPanel._current.client = client;
      ActorsPanel._current._attachLogCallback();
      await ActorsPanel._current.pushProviderModels(true);
    }
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private settings: ExtensionSettings;
  private client: StudioClient;
  private fileSaveWatcher: vscode.Disposable | undefined;
  private _activeSongbookUri: vscode.Uri | undefined;
  get activeSongbookUri(): vscode.Uri | undefined { return this._activeSongbookUri; }

  static show(
    context: vscode.ExtensionContext,
    client: StudioClient,
    settings: ExtensionSettings,
  ): ActorsPanel {
    if (ActorsPanel._current !== undefined) {
      ActorsPanel._current.panel.reveal(vscode.ViewColumn.Beside, true);
      ActorsPanel._current.client = client;
      ActorsPanel._current.settings = settings;
      return ActorsPanel._current;
    }
    const panel = vscode.window.createWebviewPanel(
      ActorsPanel.viewType,
      'Songbook',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
        retainContextWhenHidden: true,
      },
    );
    ActorsPanel._current = new ActorsPanel(panel, context, client, settings);
    return ActorsPanel._current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    client: StudioClient,
    settings: ExtensionSettings,
  ) {
    this.panel = panel;
    this.client = client;
    this.settings = settings;
    this._attachLogCallback();
    this.panel.webview.html = this.buildHtml(context);
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons', 'activitybar.svg');

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
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
        await this.pushSettings();
        await this.pushGraph();
        await this.pushPrompts();
        void this.pushProviderModels(true);
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
            graph = parseGraph(JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>);
          } else if (content) {
            graph = parseGraph(content);
          } else {
            break;
          }
          try { await this.client.saveGraph(graph); } catch { /* API may not be running */ }
          if (songbookUri) this.setActiveSongbook(songbookUri);
          await this.post({ type: 'loadGraph', graph });
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
        if (!alreadyRunning) {
          const graph = await this.client.loadGraph();
          const def = graph?.actors.find(a => a.name === name);
          if (!def) {
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
            const initialOutput = await this.client.startActor(def);
            if (initialOutput) {
              await this.post({ type: 'actorOutput', name, output: initialOutput });
            }
            await this.post({ type: 'actorOutput', name, output: `✓ Ready · ${tag}` });
            await this.post({ type: 'actorStatus', name, running: true });
          } catch (err) {
            await this.post({ type: 'actorOutput', name, output: `⚠ Start failed: ${String(err)}` });
            break;
          }
        } else if (isStartOnly) {
          await this.post({ type: 'actorOutput', name, output: `· ${name} is already running` });
          await this.post({ type: 'actorStatus', name, running: true });
        }

        if (isStartOnly) break;

        // ── 3. Send the instruction ───────────────────────────────────────────
        try {
          const output = await this.client.instructActor(name, instruction);
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

        const graph = await this.client.loadGraph();
        const def = graph?.actors.find(a => a.name === name);
        if (!def) {
          await this.post({ type: 'actorOutput', name, output: '⚠ Actor not found in graph — could not restart' });
          break;
        }

        await this.post({ type: 'actorOutput', name, output: `♻ Refreshing ${name}…` });
        try {
          const initialOutput = await this.client.startActor(def);
          if (initialOutput) {
            await this.post({ type: 'actorOutput', name, output: initialOutput });
          }
          await this.post({ type: 'actorOutput', name, output: '✓ Ready' });
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
        const graph = await this.client.loadGraph();
        if (!graph) break;
        let runningNames: string[] = [];
        try { runningNames = await this.client.listRunning(); } catch { /* ignore */ }
        for (const actor of graph.actors) {
          if (runningNames.includes(actor.name)) {
            await this.post({ type: 'actorOutput', name: actor.name, output: `· ${actor.name} already running` });
            await this.post({ type: 'actorStatus', name: actor.name, running: true });
            continue;
          }
          const tag = actor.actorType === 'ai'
            ? `${actor.provider} / ${actor.model}`
            : actor.actorType;
          await this.post({ type: 'actorOutput', name: actor.name, output: `⏳ Initialising ${tag}…` });
          try {
            const initialOutput = await this.client.startActor(actor);
            if (initialOutput) {
              await this.post({ type: 'actorOutput', name: actor.name, output: initialOutput });
            }
            await this.post({ type: 'actorOutput', name: actor.name, output: `✓ Ready · ${tag}` });
            await this.post({ type: 'actorStatus', name: actor.name, running: true });
          } catch (err) {
            await this.post({ type: 'actorOutput', name: actor.name, output: `⚠ Start failed: ${String(err)}` });
          }
        }
        break;
      }

      case 'stopSongbook': {
        const running = await this.client.listRunning();
        for (const name of running) {
          try {
            await this.client.stopActor(name);
            await this.post({ type: 'actorStatus', name, running: false });
          } catch {
            // ignore
          }
        }
        break;
      }
    }
  }

  async pushGraph(): Promise<void> {
    const graph = await this.client.loadGraph();
    if (graph) {
      await this.post({ type: 'loadGraph', graph });
      await this.registerFileSaveWatcher(graph);
    }
  }

  async pushPrompts(): Promise<void> {
    const prompts = await this.client.fetchPrompts(this.settings.servers);
    await this.post({ type: 'updatePrompts', prompts });
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
    const name = uri?.path.split('/').pop()?.replace(/\.jsonld$/i, '');
    this.panel.title = name ? `${name} - Songbook` : 'Songbook';
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

  private _attachLogCallback(): void {
    this.client.onLog = (entry) => { void this.post({ type: 'apiLog', entry }); };
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

  private async post(msg: ToWebview): Promise<void> {
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

  /** Drain the runtime's actor-to-actor notification log and push to the webview. */
  private async pushNotifications(): Promise<void> {
    const notes = await this.client.drainNotifications();
    await this.pushForwarded(notes);
    // Also drain MCP tool call log and forward as mcpLog messages.
    const mcpEntries = await this.client.drainMcpLog();
    for (const entry of mcpEntries) {
      void this.post({ type: 'mcpLog', entry });
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
    ActorsPanel._current = undefined;
    this.fileSaveWatcher?.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

function _nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)] ?? 'A').join('');
}
