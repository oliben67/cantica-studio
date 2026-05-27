import * as vscode from 'vscode';
import { AgentsPanel } from './agents-panel.js';
import { AgentsProvider } from './agents-provider.js';
import { CanticaClient } from './cantica-client.js';
import { StudioManager } from './studioManager.js';
import type { ExtensionSettings } from './types/index.js';

const LOCAL_STUDIO_URL = 'http://localhost:8043';

function readSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('canticaScores');
  return {
    serverUrl: cfg.get<string>('serverUrl') ?? LOCAL_STUDIO_URL,
    authToken: cfg.get<string>('authToken') ?? '',
    explorerSide: (cfg.get<string>('explorerSide') ?? 'left') as 'left' | 'right',
  };
}

/** Returns true if the server URL is the default local studio address. */
function isLocalStudio(url: string): boolean {
  return url.startsWith('http://localhost:8043') || url.startsWith('http://127.0.0.1:8043');
}

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  let client = new CanticaClient(settings.serverUrl, settings.authToken);
  const provider = new AgentsProvider();
  const studio = new StudioManager();
  context.subscriptions.push(studio);

  // Activity-bar tree view
  const treeView = vscode.window.createTreeView('canticaScores.agentsView', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── local-studio helpers ───────────────────────────────────────────────────

  async function ensureLocalStudio(): Promise<string | undefined> {
    const url = await studio.ensureRunning();
    if (url) {
      // Persist the URL in settings so the client uses it.
      const cfg = vscode.workspace.getConfiguration('canticaScores');
      await cfg.update('serverUrl', url, vscode.ConfigurationTarget.Global);
    }
    return url;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('canticaScores.openPanel', () => {
      const panel = AgentsPanel.show(context, provider, client, settings);
      void panel.fetchAndPush();
    }),

    vscode.commands.registerCommand('canticaScores.refreshAgents', async () => {
      try {
        const [namespaces, prompts] = await Promise.all([
          client.fetchNamespaces(),
          client.fetchPrompts(),
        ]);
        provider.update(namespaces, prompts);
        void vscode.window.showInformationMessage(
          `Loaded ${prompts.length} AI actors from ${settings.serverUrl}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        provider.setError(message);
        void vscode.window.showErrorMessage(`Cantica: ${message}`);
      }
    }),

    vscode.commands.registerCommand('canticaScores.configureServer', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'canticaScores');
    }),

    vscode.commands.registerCommand('canticaScores.startLocalStudio', async () => {
      const url = await ensureLocalStudio();
      if (url) {
        client = new CanticaClient(url, '');
        void vscode.commands.executeCommand('canticaScores.refreshAgents');
      }
    }),

    vscode.commands.registerCommand('canticaScores.stopLocalStudio', async () => {
      await studio.stop();
      void vscode.window.showInformationMessage('Cantica Studio API stopped.');
    }),
  );

  // ── Configuration changes ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('canticaScores')) {
        settings = readSettings();
        client = new CanticaClient(settings.serverUrl, settings.authToken);
        void vscode.commands.executeCommand('canticaScores.refreshAgents');
      }
    }),
  );

  // ── First-use / initial load ───────────────────────────────────────────────

  async function initialLoad(): Promise<void> {
    const autoStart = vscode.workspace
      .getConfiguration('canticaScores')
      .get<boolean>('autoStartStudio') ?? true;

    // If the server URL points to local studio (or is still default) and
    // autoStart is on, make sure the container is running before loading.
    if (autoStart && isLocalStudio(settings.serverUrl)) {
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings(); // re-read after potential URL update
        client = new CanticaClient(settings.serverUrl, settings.authToken);
      }
    }

    void vscode.commands.executeCommand('canticaScores.refreshAgents');
  }

  void initialLoad();
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically
}
