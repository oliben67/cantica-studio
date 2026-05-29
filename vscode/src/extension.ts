import * as vscode from 'vscode';
import { ActorsPanel } from './actors-panel.js';
import { AgentsProvider } from './agents-provider.js';
import { StudioClient } from './studio-client.js';
import { StudioManager } from './studioManager.js';
import type { CanticaServer, ExtensionSettings } from './types/index.js';

const LOCAL_STUDIO_URL = 'http://localhost:8043';

function readSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('canticaScores');
  const serverUrl = cfg.get<string>('serverUrl') ?? LOCAL_STUDIO_URL;
  const authToken = cfg.get<string>('authToken') ?? '';

  const rawServers = cfg.get<{ url: string; authToken?: string }[]>('servers') ?? [];
  const servers: CanticaServer[] = [
    { url: serverUrl, authToken },
    ...rawServers
      .filter((s) => s.url && s.url !== serverUrl)
      .map((s) => ({ url: s.url, authToken: s.authToken ?? '' })),
  ];

  return {
    servers,
    serverUrl,
    authToken,
    explorerSide: (cfg.get<string>('explorerSide') ?? 'left') as 'left' | 'right',
    canticaHome: cfg.get<string>('canticaHome') ?? '',
    studioPort: cfg.get<number>('studioPort') ?? 8043,
    autoStartStudio: cfg.get<boolean>('autoStartStudio') ?? true,
    graphFile: cfg.get<string>('graphFile') ?? '.vscode/actors.jsonld',
  };
}

function isLocalStudio(url: string): boolean {
  return url.startsWith('http://localhost:8043') || url.startsWith('http://127.0.0.1:8043');
}

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  let client = new StudioClient(settings.studioPort);
  const provider = new AgentsProvider();
  const studio = new StudioManager();
  context.subscriptions.push(studio);

  const treeView = vscode.window.createTreeView('canticaScores.agentsView', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('canticaScores.openPanel', () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph();
    }),

    vscode.commands.registerCommand('canticaScores.newActor', () => {
      // Open panel and signal webview to add a new node
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph().then(() => {
        void panel['panel']?.webview.postMessage({ type: 'addActor' });
      });
    }),

    vscode.commands.registerCommand('canticaScores.saveGraph', async () => {
      void vscode.commands.executeCommand('canticaScores.openPanel');
      void vscode.window.showInformationMessage('Use the Save button in the Actor Studio canvas.');
    }),

    vscode.commands.registerCommand('canticaScores.loadGraph', async () => {
      const panel = ActorsPanel.show(context, client, settings);
      await panel.pushGraph();
    }),

    vscode.commands.registerCommand('canticaScores.configureServer', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'canticaScores');
    }),

    vscode.commands.registerCommand('canticaScores.startLocalStudio', async () => {
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new StudioClient(settings.studioPort);
        void vscode.window.showInformationMessage(`Studio API running at ${url}`);
      }
    }),

    vscode.commands.registerCommand('canticaScores.stopLocalStudio', async () => {
      await studio.stop();
      void vscode.window.showInformationMessage('Studio API stopped.');
    }),
  );

  // ── Configuration changes ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('canticaScores')) {
        settings = readSettings();
        client = new StudioClient(settings.studioPort);
        ActorsPanel['current']?.updateSettings(settings, client);
      }
    }),
  );

  // ── Initial load ───────────────────────────────────────────────────────────

  void (async () => {
    if (settings.autoStartStudio && isLocalStudio(settings.serverUrl)) {
      await studio.ensureRunning();
      settings = readSettings();
      client = new StudioClient(settings.studioPort);
    }
  })();
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically
}
