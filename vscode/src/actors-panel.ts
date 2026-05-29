import * as vscode from 'vscode';
import type { ActorGraph, ExtensionSettings, ToWebview } from './types/index.js';
import type { StudioClient } from './studio-client.js';

export class ActorsPanel {
  static readonly viewType = 'canticaScores.panel';
  private static current: ActorsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private settings: ExtensionSettings;
  private client: StudioClient;
  private fileSaveWatcher: vscode.Disposable | undefined;

  static show(
    context: vscode.ExtensionContext,
    client: StudioClient,
    settings: ExtensionSettings,
  ): ActorsPanel {
    if (ActorsPanel.current !== undefined) {
      ActorsPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      ActorsPanel.current.client = client;
      ActorsPanel.current.settings = settings;
      return ActorsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      ActorsPanel.viewType,
      'Cantica Studio',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
        retainContextWhenHidden: true,
      },
    );
    ActorsPanel.current = new ActorsPanel(panel, context, client, settings);
    return ActorsPanel.current;
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
        break;

      case 'saveGraph': {
        const graph = raw['graph'] as ActorGraph;
        try {
          await this.client.saveGraph(graph);
          await this.registerFileSaveWatcher(graph);
        } catch (err) {
          void vscode.window.showErrorMessage(`Save failed: ${String(err)}`);
        }
        break;
      }

      case 'addActor':
        // The webview handles node creation internally; extension just acknowledges
        break;

      case 'runActor': {
        const name = raw['name'] as string;
        const instruction = raw['instruction'] as string;
        try {
          const output = await this.client.instructActor(name, instruction);
          await this.post({ type: 'actorOutput', name, output });
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'fireEvent': {
        const name = raw['name'] as string;
        const eventName = raw['eventName'] as string;
        const context = (raw['context'] as string | undefined) ?? '';
        try {
          const output = await this.client.fireEvent(name, eventName, context);
          await this.post({ type: 'actorOutput', name, output });
        } catch (err) {
          await this.post({ type: 'error', message: String(err) });
        }
        break;
      }

      case 'stopActor': {
        const name = raw['name'] as string;
        try {
          await this.client.stopActor(name);
          await this.post({ type: 'actorStatus', name, running: false });
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

  updateSettings(settings: ExtensionSettings, client: StudioClient): void {
    this.settings = settings;
    this.client = client;
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
            void this.client.fireEvent(actor.name, evt.name, uri.fsPath).then((output) => {
              void this.post({ type: 'actorOutput', name: actor.name, output });
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
    ActorsPanel.current = undefined;
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
