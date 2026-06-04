import * as vscode from 'vscode';
import { ActorsPanel } from './actors-panel.js';
import { SongbooksProvider, SongbookItem } from './songbooks-provider.js';
import { ServersProvider, ServerItem } from './servers-provider.js';
import { StudioProvider } from './studio-provider.js';
import { StudioClient, parseGraph } from './studio-client.js';
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
  };
}

function isLocalStudio(url: string): boolean {
  return url.startsWith('http://localhost:8043') || url.startsWith('http://127.0.0.1:8043');
}

function songbooksDir(canticaHome: string): vscode.Uri {
  const home = canticaHome.trim() || `${process.env['HOME'] ?? '~'}/.cantica`;
  return vscode.Uri.file(`${home}/songbooks`);
}

async function findSongbooks(canticaHome: string): Promise<{ label: string; uri: vscode.Uri }[]> {
  const dir = songbooksDir(canticaHome);
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    const results: { label: string; uri: vscode.Uri }[] = [];

    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && name.endsWith('.jsonld')) {
        results.push({ label: name, uri: vscode.Uri.joinPath(dir, name) });
      } else if (type === vscode.FileType.Directory) {
        // One level deep: include any .jsonld files inside named sub-directories
        try {
          const subEntries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(dir, name));
          for (const [subName, subType] of subEntries) {
            if (subType === vscode.FileType.File && subName.endsWith('.jsonld')) {
              results.push({
                label: `${name}/${subName}`,
                uri: vscode.Uri.joinPath(dir, name, subName),
              });
            }
          }
        } catch { /* skip unreadable sub-dirs */ }
      }
    }

    return results;
  } catch {
    return [];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  let client = new StudioClient(settings.studioPort);
  const studio = new StudioManager();
  context.subscriptions.push(studio);

  const songbooksProvider = new SongbooksProvider();
  const serversProvider = new ServersProvider();
  const studioProvider = new StudioProvider();

  const songbooksView = vscode.window.createTreeView('canticaScores.songbooksView', {
    treeDataProvider: songbooksProvider,
    showCollapseAll: false,
  });
  const serversView = vscode.window.createTreeView('canticaScores.serversView', {
    treeDataProvider: serversProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(
    songbooksView,
    serversView,
    vscode.window.createTreeView('canticaScores.studioView', { treeDataProvider: studioProvider }),
  );

  context.subscriptions.push(
    songbooksView.onDidChangeVisibility((e) => {
      if (e.visible) {
        const panel = ActorsPanel.show(context, client, settings);
        void panel.pushGraph();
      }
    }),
  );

  function refreshProviders(): void {
    serversProvider.update(settings.servers);
    void findSongbooks(settings.canticaHome).then((items) => songbooksProvider.update(items));
  }

  refreshProviders();

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('canticaScores.openPanel', () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph();
    }),

    vscode.commands.registerCommand('canticaScores.newActor', () => {
      const panel = ActorsPanel.show(context, client, settings);
      void panel.pushGraph().then(() => {
        void panel['panel']?.webview.postMessage({ type: 'addActor' });
      });
    }),

    vscode.commands.registerCommand('canticaScores.saveGraph', async () => {
      void vscode.commands.executeCommand('canticaScores.openPanel');
      void vscode.window.showInformationMessage('Use the Save button in the Workspace toolbar.');
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

    vscode.commands.registerCommand('canticaScores.deleteActor', () => {
      void ActorsPanel.current?.['panel']?.webview.postMessage({ type: 'deleteSelected' });
    }),

    vscode.commands.registerCommand('canticaScores.resetGraph', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Reset the workspace? All actors and edges will be removed.',
        { modal: true },
        'Reset',
      );
      if (answer === 'Reset') {
        void ActorsPanel.current?.['panel']?.webview.postMessage({ type: 'resetGraph' });
      }
    }),

    vscode.commands.registerCommand('canticaScores.editGraphFile', (uri?: vscode.Uri) => {
      if (uri) {
        void vscode.commands.executeCommand('vscode.open', uri);
      }
    }),

    vscode.commands.registerCommand('canticaScores.newSongbook', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Songbook name',
        placeHolder: 'my-workflow',
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
      const dir = songbooksDir(settings.canticaHome);
      await vscode.workspace.fs.createDirectory(dir);
      const uri = vscode.Uri.joinPath(dir, `${slug}.jsonld`);
      const content = JSON.stringify(
        {
          '@context': { '@vocab': 'https://cantica.dev/studio/', 'schema': 'http://schema.org/', 'name': 'schema:name' },
          '@type': 'ActorGraph',
          '@id': `urn:cantica:studio:graph:${slug}`,
          'name': name.trim(),
          'actors': [],
          'edges': [],
        },
        null,
        2,
      );
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      await vscode.commands.executeCommand('vscode.open', uri);
    }),

    vscode.commands.registerCommand('canticaScores.saveAllSongbooks', () => {
      void ActorsPanel.current?.['panel']?.webview.postMessage({ type: 'triggerSave' });
    }),

    vscode.commands.registerCommand('canticaScores.closeAllSongbooks', () => {
      ActorsPanel.current?.dispose();
    }),

    vscode.commands.registerCommand('canticaScores.viewSongbook', async (item?: SongbookItem) => {
      if (!item) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(item.uri);
        const raw = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>;
        const graph = parseGraph(raw);
        await client.saveGraph(graph);
        const panel = ActorsPanel.show(context, client, settings);
        panel.setActiveSongbook(item.uri);
        await panel.pushGraph();
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('canticaScores.editSongbook', async (item?: SongbookItem) => {
      if (!item) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(item.uri);
        const raw = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>;
        const graph = parseGraph(raw);
        await client.saveGraph(graph);
        await vscode.window.showTextDocument(item.uri, { viewColumn: vscode.ViewColumn.One, preview: false });
        const panel = ActorsPanel.show(context, client, settings);
        panel.setActiveSongbook(item.uri);
        await panel.pushGraph();
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('canticaScores.deleteSongbook', async (item?: SongbookItem) => {
      if (!item) return;
      const answer = await vscode.window.showWarningMessage(
        `Delete songbook "${item.label}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (answer !== 'Delete') return;
      await vscode.workspace.fs.delete(item.uri);
    }),

    vscode.commands.registerCommand('canticaScores.exportSongbook', async (item?: SongbookItem) => {
      if (!item) return;
      const serverPicks = settings.servers.map((s) => ({ label: s.url, server: s }));
      if (!serverPicks.length) {
        void vscode.window.showErrorMessage('No Cantica servers configured. Add a server first.');
        return;
      }
      const chosen = serverPicks.length === 1
        ? serverPicks[0]
        : await vscode.window.showQuickPick(serverPicks, { placeHolder: 'Select target Cantica server' });
      if (!chosen) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Exporting "${item.label}"…`, cancellable: false },
        async () => {
          try {
            const bytes = await vscode.workspace.fs.readFile(item.uri);
            const body = Buffer.from(bytes).toString('utf-8');
            const r = await fetch(`${chosen.server.url.replace(/\/$/, '')}/v1/graphs/import`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(chosen.server.authToken ? { Authorization: `Bearer ${chosen.server.authToken}` } : {}),
              },
              body,
            });
            if (!r.ok) throw new Error(`Server responded ${r.status}`);
            void vscode.window.showInformationMessage(`Songbook "${item.label}" exported to ${chosen.label}.`);
          } catch (err) {
            void vscode.window.showErrorMessage(`Export failed: ${String(err)}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand('canticaScores.newServer', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Cantica server URL',
        placeHolder: 'https://my-server.example.com',
        validateInput: (v) => {
          try { new URL(v); return undefined; } catch { return 'Enter a valid URL'; }
        },
      });
      if (!url) return;
      const token = await vscode.window.showInputBox({
        prompt: 'Auth token (optional — press Enter to skip)',
        password: true,
      });
      if (token === undefined) return;
      const cfg = vscode.workspace.getConfiguration('canticaScores');
      const existing = cfg.get<{ url: string; authToken?: string }[]>('servers') ?? [];
      await cfg.update(
        'servers',
        [...existing, { url, authToken: token }],
        vscode.ConfigurationTarget.Global,
      );
    }),

    vscode.commands.registerCommand('canticaScores.deleteServer', async (item?: ServerItem) => {
      const cfg = vscode.workspace.getConfiguration('canticaScores');
      const existing = cfg.get<{ url: string; authToken?: string }[]>('servers') ?? [];

      let urlToDelete: string | undefined;
      if (item) {
        urlToDelete = item.server.url;
      } else {
        const picks = settings.servers.map((s) => ({ label: s.url }));
        if (!picks.length) {
          void vscode.window.showInformationMessage('No servers configured.');
          return;
        }
        const chosen = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select server to delete',
        });
        urlToDelete = chosen?.label;
      }
      if (!urlToDelete) return;

      const updated = existing.filter((s) => s.url !== urlToDelete);
      if (updated.length < existing.length) {
        await cfg.update('servers', updated, vscode.ConfigurationTarget.Global);
      } else {
        void vscode.window.showWarningMessage(
          'The primary server URL can only be changed in Cantica Studio settings.',
        );
      }
    }),
  );

  // ── Configuration changes ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('canticaScores')) {
        settings = readSettings();
        client = new StudioClient(settings.studioPort);
        ActorsPanel.current?.updateSettings(settings, client);
        refreshProviders();
      }
    }),
  );

  // Watch the songbooks directory for new/deleted files (refreshes the sidebar)
  const songbooksPattern = new vscode.RelativePattern(
    songbooksDir(settings.canticaHome),
    '**/*.jsonld',
  );
  const songbooksWatcher = vscode.workspace.createFileSystemWatcher(songbooksPattern);
  songbooksWatcher.onDidCreate(() => refreshProviders());
  songbooksWatcher.onDidDelete(() => refreshProviders());
  context.subscriptions.push(songbooksWatcher);

  // Reload the workspace canvas when the user manually saves the active .jsonld
  // file from the text editor.  We use onDidSaveTextDocument (not the FS watcher)
  // because the workspace's own vscode.workspace.fs.writeFile does NOT fire this
  // event, so there is no risk of an infinite reload loop.
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const panel = ActorsPanel.current;
      if (!panel) return;
      const activeSongbook = panel.activeSongbookUri;
      if (!activeSongbook) return;
      if (doc.uri.fsPath !== activeSongbook.fsPath) return;

      // Debounce: wait 400 ms in case the user is still typing / auto-saving rapidly
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        try {
          const raw = JSON.parse(doc.getText()) as Record<string, unknown>;
          const graph = parseGraph(raw);
          await client.saveGraph(graph);
          await panel.pushGraph();
        } catch {
          // Ignore parse errors — the file may be mid-edit
        }
      }, 400);
    }),
  );

  // ── Initial load ───────────────────────────────────────────────────────────

  void (async () => {
    // Ensure $CANTICA_HOME/songbooks/ exists
    await vscode.workspace.fs.createDirectory(songbooksDir(settings.canticaHome));
    refreshProviders();

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
