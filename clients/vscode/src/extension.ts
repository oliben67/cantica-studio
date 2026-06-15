import * as vscode from 'vscode';
import { ActorsPanel } from './actors-panel.js';
import { clearCredentials, generateKeyPair, loadCredentials, makeCachedAssertion, publicKeyFromPrivate, saveCredentials } from './auth.js';
import type { SongbookFolderItem, SongbookItem, SongbookNode } from './songbooks-provider.js';
import { SongbooksProvider } from './songbooks-provider.js';
import { SONGBOOKS_SCHEME, SongbooksFileSystemProvider } from './songbooks-fs-provider.js';
import type { ServerItem } from './servers-provider.js';
import { ServersProvider } from './servers-provider.js';
import type { StudioHealth, StudioInfo } from './studio-provider.js';
import { StudioProvider } from './studio-provider.js';
import { StudioClient, parseGraph } from './studio-client.js';
import { StudioManager } from './studioManager.js';
import type { CanticaServer, ExtensionSettings } from './types/index.js';
import { randomUUID } from 'node:crypto';

function readSettings(): ExtensionSettings {
  const cfg = vscode.workspace.getConfiguration('canticaScores');
  const serverUrl = cfg.get<string>('serverUrl') ?? 'http://localhost:8042';
  const authToken = cfg.get<string>('authToken') ?? '';

  const rawServers = cfg.get<{ url: string; authToken?: string }[]>('servers') ?? [];
  const servers: CanticaServer[] = [
    { url: serverUrl, authToken },
    ...rawServers
      .filter((s) => s.url && s.url !== serverUrl)
      .map((s) => ({ url: s.url, authToken: s.authToken ?? '' })),
  ];

  const studioMode = (cfg.get<string>('studioMode') ?? 'local') as 'local' | 'remote';
  const studioPort = cfg.get<number>('studioPort') ?? 8043;
  const remoteUrl = (cfg.get<string>('studioUrl') ?? '').trim();
  const studioBaseUrl = studioMode === 'remote' && remoteUrl
    ? remoteUrl
    : `http://localhost:${studioPort}`;

  return {
    servers,
    serverUrl,
    authToken,
    explorerSide: (cfg.get<string>('explorerSide') ?? 'left') as 'left' | 'right',
    canticaHome: cfg.get<string>('canticaHome') ?? '',
    studioMode,
    studioBaseUrl,
    studioPort,
    autoStartStudio: cfg.get<boolean>('autoStartStudio') ?? true,
    providerModels: cfg.get<Record<string, string[] | null>>('providerModels') ?? {},
  };
}

function canticaHomeRoot(canticaHome: string): string {
  return canticaHome.trim() || `${process.env['HOME'] ?? '~'}/.cantica`;
}


function songbooksRoot(canticaHome: string): string {
  return `${canticaHomeRoot(canticaHome)}/songbooks`;
}

function songbooksDir(canticaHome: string): vscode.Uri {
  return vscode.Uri.file(songbooksRoot(canticaHome));
}

function ensureSongbooksWorkspaceFolder(): void {
  const uri = vscode.Uri.parse(`${SONGBOOKS_SCHEME}:///`);
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.some((f) => f.uri.scheme === SONGBOOKS_SCHEME)) {
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name: 'Songbooks' });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  let getAuth: (() => string | null) | undefined;
  let client = new StudioClient(settings.studioBaseUrl, () => getAuth?.() ?? null);
  const studio = new StudioManager();
  let _songbookClipboard: SongbookItem | undefined;
  context.subscriptions.push(studio);

  // Seed isRegistered immediately from globalState (sync) so the UI shows the right
  // button from the first frame, then verify with SecretStorage (async) and correct if needed.
  const _REGISTERED_KEY = 'cantica.isRegistered';
  const wasRegistered = context.globalState.get<boolean>(_REGISTERED_KEY, false);
  void vscode.commands.executeCommand('setContext', 'canticaScores.isRegistered', wasRegistered);

  // Pre-load credentials so getAuth is ready before the first health-poll tick.
  void loadCredentials(context.secrets).then((creds) => {
    if (creds) {
      getAuth = makeCachedAssertion(creds, settings.studioBaseUrl);
      void vscode.commands.executeCommand('setContext', 'canticaScores.isRegistered', true);
      if (!wasRegistered) void context.globalState.update(_REGISTERED_KEY, true);
    }
  });

  // Tracks whether we have synced (registered) credentials with the current API instance.
  // Reset to false whenever the API goes down OR the server_id changes (restart detected).
  let _registeredWithCurrent = false;
  let _lastServerId: string | undefined;

  async function _syncCredentials(): Promise<void> {
    if (_registeredWithCurrent) return;
    let creds = await loadCredentials(context.secrets);
    if (!creds) {
      // First run — auto-generate a key pair silently.
      const pair = generateKeyPair();
      creds = { clientId: randomUUID(), privateKeyPem: pair.privateKeyPem };
      await saveCredentials(context.secrets, creds);
      await context.globalState.update(_REGISTERED_KEY, true);
      void vscode.commands.executeCommand('setContext', 'canticaScores.isRegistered', true);
    }
    try {
      await client.registerClientKey(creds.clientId, publicKeyFromPrivate(creds.privateKeyPem));
      getAuth = makeCachedAssertion(creds, settings.studioBaseUrl);
      _registeredWithCurrent = true;
    } catch {
      // API not ready yet; will retry on next healthy tick.
    }
  }

  function _applyHealth(status: StudioHealth, info?: StudioInfo): void {
    studioProvider.setStatus(status, info);
  }

  let _healthPollTimer: ReturnType<typeof setInterval> | undefined;
  function startHealthPoll(): void {
    if (_healthPollTimer !== undefined) return;
    _healthPollTimer = setInterval(() => {
      void client.ping().then(({ ok, serverId, version, uptimeSeconds, workspace, containerized }) => {
        if (ok) {
          if (serverId !== undefined && serverId !== _lastServerId) {
            _registeredWithCurrent = false;
            _lastServerId = serverId;
          }
          _applyHealth('healthy', {
            mode: settings.studioMode,
            url: settings.studioBaseUrl,
            ...(version !== undefined ? { version } : {}),
            ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
            ...(workspace !== undefined ? { workspace } : {}),
            ...(containerized !== undefined ? { containerized } : {}),
          });
          void _syncCredentials();
        } else {
          _applyHealth('down');
          _registeredWithCurrent = false;
        }
      });
    }, 5000);
  }
  startHealthPoll();

  function setStatusStarting(): void {
    _applyHealth('starting');
  }

  // ── Songbooks virtual filesystem ───────────────────────────────────────────
  const fsProvider = new SongbooksFileSystemProvider(songbooksRoot(settings.canticaHome));
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SONGBOOKS_SCHEME, fsProvider, {
      isCaseSensitive: true,
    }),
  );
  ensureSongbooksWorkspaceFolder();

  const songbooksProvider = new SongbooksProvider();
  songbooksProvider.setFileIcon(vscode.Uri.joinPath(context.extensionUri, 'icons', 'music-sheet.png'));
  const serversProvider = new ServersProvider();
  const studioProvider = new StudioProvider();

  const songbooksView = vscode.window.createTreeView('canticaScores.songbooksView', {
    treeDataProvider: songbooksProvider,
    dragAndDropController: songbooksProvider,
    showCollapseAll: true,
    canSelectMany: true,
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
    songbooksProvider.setRoot(songbooksDir(settings.canticaHome));
  }

  refreshProviders();

  songbooksProvider.setDropHandler(async (sourceUris, target) => {
    const destDir = target ? target.uri : songbooksDir(settings.canticaHome);
    for (const srcUri of sourceUris) {
      // cantica-songbooks:// URIs from the Explorer workspace folder → real file:// path
      const realSrc = srcUri.scheme === SONGBOOKS_SCHEME
        ? vscode.Uri.file(songbooksRoot(settings.canticaHome) + srcUri.path)
        : srcUri;
      const filename = realSrc.path.split('/').pop();
      if (!filename) continue;
      const dest = vscode.Uri.joinPath(destDir, filename);
      if (realSrc.fsPath !== dest.fsPath) {
        try {
          await vscode.workspace.fs.rename(realSrc, dest, { overwrite: false });
        } catch (err) {
          void vscode.window.showErrorMessage(`Could not move "${filename}": ${String(err)}`);
        }
      }
    }
  });

  // Keep folder icons in sync with the tree's visual expand/collapse state.
  context.subscriptions.push(
    songbooksView.onDidExpandElement((e) => {
      if (e.element.kind === 'folder') {
        songbooksProvider.setFolderExpanded(e.element.uri.fsPath, true);
      }
    }),
    songbooksView.onDidCollapseElement((e) => {
      if (e.element.kind === 'folder') {
        songbooksProvider.setFolderExpanded(e.element.uri.fsPath, false);
      }
    }),
  );

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
      setStatusStarting();
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new StudioClient(settings.studioBaseUrl, () => getAuth?.() ?? null);
        _registeredWithCurrent = false;
        void vscode.window.showInformationMessage(`Studio API running at ${url}`);
        void ActorsPanel.refreshProviderModels(client);
      }
    }),

    vscode.commands.registerCommand('canticaScores.stopLocalStudio', async () => {
      await studio.stop();
      void vscode.window.showInformationMessage('Studio API stopped.');
    }),

    vscode.commands.registerCommand('canticaScores.restartLocalStudio', async () => {
      await studio.stop();
      setStatusStarting();
      const url = await studio.ensureRunning();
      if (url) {
        settings = readSettings();
        client = new StudioClient(settings.studioBaseUrl, () => getAuth?.() ?? null);
        _registeredWithCurrent = false;
        void vscode.window.showInformationMessage(`Studio API restarted at ${url}`);
        void ActorsPanel.refreshProviderModels(client);
      }
    }),

    vscode.commands.registerCommand('canticaScores.register', async () => {
      // Step 1: local or remote
      const mode = await vscode.window.showQuickPick(
        [
          { label: '$(server-environment) Local Studio API', value: 'local' as const },
          { label: '$(globe) Remote Studio API', value: 'remote' as const },
        ],
        { title: 'Register Client Key — Step 1 of 3', placeHolder: 'Where is Studio API running?' },
      );
      if (!mode) return;

      let studioUrl = settings.studioBaseUrl;

      if (mode.value === 'local') {
        // If already responding (e.g. started from source), use it directly
        const alreadyUp = (await new StudioClient(settings.studioBaseUrl).ping()).ok;
        if (alreadyUp) {
          studioUrl = settings.studioBaseUrl;
        } else {
          setStatusStarting();
          const url = await studio.ensureRunning();
          if (!url) {
            void vscode.window.showErrorMessage('Could not start local Studio API.');
            return;
          }
          studioUrl = url;
          settings = readSettings();
        }
      } else {
        const input = await vscode.window.showInputBox({
          title: 'Register Client Key — Step 1 of 3',
          prompt: 'Remote Studio API base URL',
          value: settings.studioBaseUrl,
          validateInput: (v) => (v.trim() ? undefined : 'URL is required'),
        });
        if (!input) return;
        studioUrl = input.trim().replace(/\/$/, '');
        const alive = (await new StudioClient(studioUrl).ping()).ok;
        if (!alive) {
          void vscode.window.showErrorMessage(`Cannot reach Studio API at ${studioUrl}`);
          return;
        }
      }

      // Step 2: generate or select a key
      const keyChoice = await vscode.window.showQuickPick(
        [
          { label: '$(sparkle) Generate new RSA-2048 key pair', value: 'generate' as const },
          { label: '$(folder-opened) Select existing private key file', value: 'select' as const },
        ],
        { title: 'Register Client Key — Step 2 of 3', placeHolder: 'How would you like to provide the private key?' },
      );
      if (!keyChoice) return;

      let privateKeyPem: string;
      let publicKeyPem: string;

      if (keyChoice.value === 'generate') {
        const pair = generateKeyPair();
        privateKeyPem = pair.privateKeyPem;
        publicKeyPem = pair.publicKeyPem;
      } else {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'PEM key files': ['pem', 'key'], 'All files': ['*'] },
          title: 'Select private key file (PKCS#8 PEM)',
        });
        if (!uris || !uris[0]) return;
        try {
          const { readFileSync } = await import('node:fs');
          privateKeyPem = readFileSync(uris[0].fsPath, 'utf8');
          publicKeyPem = publicKeyFromPrivate(privateKeyPem);
        } catch (e) {
          void vscode.window.showErrorMessage(`Failed to read key file: ${String(e)}`);
          return;
        }
      }

      // Step 3: register with Studio API
      const clientId = randomUUID();
      try {
        const registrationClient = new StudioClient(studioUrl);
        await registrationClient.registerClientKey(clientId, publicKeyPem);
      } catch (e) {
        void vscode.window.showErrorMessage(`Registration failed: ${String(e)}`);
        return;
      }

      const creds = { clientId, privateKeyPem };
      await saveCredentials(context.secrets, creds);
      await context.globalState.update(_REGISTERED_KEY, true);
      getAuth = makeCachedAssertion(creds, studioUrl);
      client = new StudioClient(studioUrl, () => getAuth?.() ?? null);
      _registeredWithCurrent = true;
      void vscode.commands.executeCommand('setContext', 'canticaScores.isRegistered', true);
      void vscode.window.showInformationMessage(`Client registered successfully (id: ${clientId})`);
    }),

    vscode.commands.registerCommand('canticaScores.unregister', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Remove the stored client key? You will need to re-register to use authenticated endpoints.',
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') return;
      await clearCredentials(context.secrets);
      await context.globalState.update(_REGISTERED_KEY, false);
      getAuth = undefined;
      void vscode.commands.executeCommand('setContext', 'canticaScores.isRegistered', false);
      void vscode.window.showInformationMessage('Client key removed.');
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

    vscode.commands.registerCommand('canticaScores.songbookViewTree', () => {
      void vscode.commands.executeCommand('setContext', 'canticaScores.songbookViewMode', 'tree');
      songbooksProvider.setMode('tree');
    }),

    vscode.commands.registerCommand('canticaScores.songbookViewList', () => {
      void vscode.commands.executeCommand('setContext', 'canticaScores.songbookViewMode', 'list');
      songbooksProvider.setMode('list');
    }),

    vscode.commands.registerCommand('canticaScores.viewSongbook', async (item?: SongbookItem) => {
      if (!item) return;
      const fsPath = item.uri.fsPath;
      if (fsPath.endsWith('.yaml') || fsPath.endsWith('.yml')) {
        await vscode.window.showTextDocument(item.uri, { viewColumn: vscode.ViewColumn.One, preview: false });
        songbooksProvider.setActive(item.uri);
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(item.uri);
        const raw = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>;
        const graph = parseGraph(raw);
        await client.saveGraph(graph);
        const panel = ActorsPanel.show(context, client, settings);
        panel.setActiveSongbook(item.uri);
        songbooksProvider.setActive(item.uri);
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
        songbooksProvider.setActive(item.uri);
        await panel.pushGraph();
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not open songbook: ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('canticaScores.deleteSongbook', async (item?: SongbookItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookItem => n.kind === 'file');
      if (!target) return;
      const answer = await vscode.window.showWarningMessage(
        `Delete "${target.label}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (answer !== 'Delete') return;
      if (target.uri.fsPath === songbooksProvider.activeUri) {
        songbooksProvider.setActive(undefined);
      }
      await vscode.workspace.fs.delete(target.uri, { useTrash: true });
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

    vscode.commands.registerCommand('canticaScores.newSongbookFolder', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Folder name',
        placeHolder: 'my-project',
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
      const dir = songbooksDir(settings.canticaHome);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, slug));
    }),

    vscode.commands.registerCommand('canticaScores.newSongbookInFolder', async (item?: SongbookFolderItem) => {
      if (!item) return;
      const name = await vscode.window.showInputBox({
        prompt: 'Songbook name',
        placeHolder: 'my-workflow',
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
      const uri = vscode.Uri.joinPath(item.uri, `${slug}.jsonld`);
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

    vscode.commands.registerCommand('canticaScores.renameSongbook', async (item?: SongbookItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookItem => n.kind === 'file');
      if (!target) return;
      const ext = target.uri.path.includes('.') ? target.uri.path.slice(target.uri.path.lastIndexOf('.')) : '';
      const baseName = target.label.endsWith(ext) ? target.label.slice(0, -ext.length) : target.label;
      const newName = await vscode.window.showInputBox({
        prompt: 'New name (without extension)',
        value: baseName,
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!newName || newName.trim() === baseName) return;
      const slug = newName.trim().replace(/\s+/g, '-').toLowerCase();
      const dir = vscode.Uri.joinPath(target.uri, '..');
      const newUri = vscode.Uri.joinPath(dir, `${slug}${ext}`);
      await vscode.workspace.fs.rename(target.uri, newUri, { overwrite: false });
      const panel = ActorsPanel.current;
      if (panel?.activeSongbookUri?.fsPath === target.uri.fsPath) {
        panel.setActiveSongbook(newUri);
      }
    }),

    vscode.commands.registerCommand('canticaScores.renameSongbookFolder', async (item?: SongbookFolderItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookFolderItem => n.kind === 'folder');
      if (!target) return;
      const newName = await vscode.window.showInputBox({
        prompt: 'New folder name',
        value: target.label,
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!newName || newName.trim() === target.label) return;
      const slug = newName.trim().replace(/\s+/g, '-').toLowerCase();
      const parent = vscode.Uri.joinPath(target.uri, '..');
      const newUri = vscode.Uri.joinPath(parent, slug);
      await vscode.workspace.fs.rename(target.uri, newUri, { overwrite: false });
    }),

    vscode.commands.registerCommand('canticaScores.deleteSongbookFolder', async (item?: SongbookFolderItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookFolderItem => n.kind === 'folder');
      if (!target) return;
      const answer = await vscode.window.showWarningMessage(
        `Delete folder "${target.label}" and all its contents?`,
        { modal: true },
        'Delete',
      );
      if (answer !== 'Delete') return;
      await vscode.workspace.fs.delete(target.uri, { recursive: true, useTrash: true });
    }),

    vscode.commands.registerCommand('canticaScores.revealSongbook', async (item?: SongbookNode) => {
      if (!item) return;
      await vscode.commands.executeCommand('revealInExplorer', item.uri);
    }),

    vscode.commands.registerCommand('canticaScores.openCanticaFile', async (item?: SongbookItem) => {
      if (!item) return;
      await vscode.commands.executeCommand('vscode.open', item.uri);
    }),

    vscode.commands.registerCommand('canticaScores.newFolderInFolder', async (item?: SongbookFolderItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookFolderItem => n.kind === 'folder');
      if (!target) return;
      const name = await vscode.window.showInputBox({
        prompt: 'Folder name',
        placeHolder: 'my-subfolder',
        validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
      });
      if (!name) return;
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target.uri, slug));
    }),

    vscode.commands.registerCommand('canticaScores.copySongbook', (item?: SongbookItem) => {
      const target = item ?? songbooksView.selection.find((n): n is SongbookItem => n.kind === 'file');
      if (!target) return;
      _songbookClipboard = target;
      void vscode.window.setStatusBarMessage(`Copied "${target.label}"`, 3000);
    }),

    vscode.commands.registerCommand('canticaScores.pasteSongbook', async (item?: SongbookNode) => {
      if (!_songbookClipboard) {
        void vscode.window.showInformationMessage('Nothing to paste — copy a songbook first.');
        return;
      }
      const src = _songbookClipboard;

      // Determine the target directory from the right-clicked item or current selection.
      const target = item ?? songbooksView.selection[0];
      const targetDir = target?.kind === 'folder'
        ? target.uri
        : target?.kind === 'file'
          ? vscode.Uri.joinPath(target.uri, '..')
          : songbooksDir(settings.canticaHome);

      // Derive the stem and extension from the source filename.
      const fileName = src.uri.path.slice(src.uri.path.lastIndexOf('/') + 1);
      const dotIdx = fileName.lastIndexOf('.');
      const stem = dotIdx >= 0 ? fileName.slice(0, dotIdx) : fileName;
      const ext = dotIdx >= 0 ? fileName.slice(dotIdx) : '';

      // Find a unique destination name: stem-copy.ext, stem-copy-2.ext, …
      let destUri = vscode.Uri.joinPath(targetDir, `${stem}-copy${ext}`);
      let counter = 2;
      while (true) {
        try {
          await vscode.workspace.fs.stat(destUri);
          destUri = vscode.Uri.joinPath(targetDir, `${stem}-copy-${counter}${ext}`);
          counter++;
        } catch {
          break;
        }
      }

      await vscode.workspace.fs.copy(src.uri, destUri, { overwrite: false });
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
        client = new StudioClient(settings.studioBaseUrl);
        ActorsPanel.current?.updateSettings(settings, client);
        fsProvider.updateRoot(songbooksRoot(settings.canticaHome));
        refreshProviders();
      }
    }),
  );

  // Set initial view-mode context so the toggle button renders correctly from the start
  void vscode.commands.executeCommand('setContext', 'canticaScores.songbookViewMode', 'tree');

  // Watch the songbooks directory for any file or folder change.
  const songbooksWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(songbooksDir(settings.canticaHome), '**/*'),
  );
  songbooksWatcher.onDidCreate(() => songbooksProvider.refresh());
  songbooksWatcher.onDidDelete(() => songbooksProvider.refresh());
  songbooksWatcher.onDidChange(() => songbooksProvider.refresh());
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

    if (settings.studioMode === 'local' && settings.autoStartStudio) {
      setStatusStarting();
      await studio.ensureRunning();
      settings = readSettings();
      client = new StudioClient(settings.studioBaseUrl);
      void ActorsPanel.refreshProviderModels(client);
    }
  })();
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically
}
