import * as vscode from 'vscode';
import { AgentsPanel } from './agents-panel.js';
import { AgentsProvider } from './agents-provider.js';
import { CanticaClient } from './cantica-client.js';
import type { ExtensionSettings } from './types/index.js';

function readSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('canticaScores');
  return {
    serverUrl: cfg.get<string>('serverUrl') ?? 'http://localhost:8042',
    authToken: cfg.get<string>('authToken') ?? '',
    explorerSide: (cfg.get<string>('explorerSide') ?? 'left') as 'left' | 'right',
  };
}

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  let client = new CanticaClient(settings.serverUrl, settings.authToken);
  const provider = new AgentsProvider();

  // Activity-bar tree view
  const treeView = vscode.window.createTreeView('canticaScores.agentsView', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Commands
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
  );

  // React to settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('canticaScores')) {
        settings = readSettings();
        client = new CanticaClient(settings.serverUrl, settings.authToken);
        void vscode.commands.executeCommand('canticaScores.refreshAgents');
      }
    }),
  );

  // Initial load (silent — don't block activation)
  void vscode.commands.executeCommand('canticaScores.refreshAgents');
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically
}
