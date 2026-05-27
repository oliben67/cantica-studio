import * as vscode from 'vscode';
import type { AgentsProvider } from './agents-provider.js';
import type { CanticaClient } from './cantica-client.js';
import type { ExtensionSettings, WebviewMessage } from './types/index.js';

export class AgentsPanel {
  static readonly viewType = 'canticaScores.panel';
  private static current: AgentsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private settings: ExtensionSettings;

  static show(
    context: vscode.ExtensionContext,
    provider: AgentsProvider,
    client: CanticaClient,
    settings: ExtensionSettings,
  ): AgentsPanel {
    if (AgentsPanel.current !== undefined) {
      AgentsPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return AgentsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      AgentsPanel.viewType,
      'Cantica Scores',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        ],
        retainContextWhenHidden: true,
      },
    );
    AgentsPanel.current = new AgentsPanel(panel, context, provider, client, settings);
    return AgentsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly provider: AgentsProvider,
    private readonly client: CanticaClient,
    settings: ExtensionSettings,
  ) {
    this.panel = panel;
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
        await this.pushAll();
        break;
      case 'refresh':
        await this.fetchAndPush();
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
      case 'openPrompt': {
        const ns = raw['namespace'];
        const name = raw['name'];
        if (typeof ns === 'string' && typeof name === 'string') {
          const url = `${this.settings.serverUrl.replace(/\/$/, '')}/v1/prompts/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }
      case 'saveWorkflow':
        await vscode.window.showInformationMessage(
          'Workflow saved (in-memory). Persistence coming soon.',
        );
        break;
    }
  }

  async fetchAndPush(): Promise<void> {
    try {
      const [namespaces, prompts] = await Promise.all([
        this.client.fetchNamespaces(),
        this.client.fetchPrompts(),
      ]);
      this.provider.update(namespaces, prompts);
      const msg: WebviewMessage = { type: 'updateAgents', namespaces, prompts };
      await this.panel.webview.postMessage(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.provider.setError(message);
      const msg: WebviewMessage = { type: 'error', message };
      await this.panel.webview.postMessage(msg);
    }
  }

  private async pushAll(): Promise<void> {
    const settingsMsg: WebviewMessage = { type: 'updateSettings', settings: this.settings };
    await this.panel.webview.postMessage(settingsMsg);
    await this.fetchAndPush();
  }

  updateSettings(settings: ExtensionSettings): void {
    this.settings = settings;
    // Push updated settings to the open webview
    const msg: WebviewMessage = { type: 'updateSettings', settings };
    void this.panel.webview.postMessage(msg);
  }

  private buildHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'index.css'),
    );
    const nonce = generateNonce();

    return /* html */ `<!DOCTYPE html>
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
</html>`;
  }

  dispose(): void {
    AgentsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => {
    const idx = Math.floor(Math.random() * chars.length);
    return chars[idx] ?? 'A';
  }).join('');
}
