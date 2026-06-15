import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { StudioManager } from '../shared/studioManager.js';
import type { StudioMode } from '../shared/studioManager.js';
import { StudioClient } from '../shared/studio-client.js';
import { generateKeyPair, makeCachedAssertion, publicKeyFromPrivate } from '../shared/auth-core.js';
import type { ToWebview, SongbookEntry, ActorGraph } from '../shared/types/index.js';
import { ElectronPlatform } from './platform.js';
import { loadCredentials, saveCredentials } from './auth-store.js';

// ── Window management ─────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;

function getWin(): BrowserWindow | null {
  return win;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Cantica Studio',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.webContents.openDevTools();

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) platform.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  win.on('closed', () => {
    win = null;
  });
}

// ── Core services ─────────────────────────────────────────────────────────────

const platform = new ElectronPlatform(getWin);
const studio = new StudioManager(platform);

let getAuth: (() => string | null) | undefined;
let studioBaseUrl = StudioManager.studioUrl(platform);
let client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);

// ── Messaging helpers ─────────────────────────────────────────────────────────

function send(msg: ToWebview): void {
  win?.webContents.send('to-renderer', msg);
}

// ── Studio mode settings ──────────────────────────────────────────────────────

function _settingsPath(): string {
  return join(app.getPath('userData'), 'studio-settings.json');
}

function loadStudioMode(): StudioMode {
  try {
    const raw = JSON.parse(readFileSync(_settingsPath(), 'utf-8')) as { studioMode?: string };
    return raw.studioMode === 'native' ? 'native' : 'container';
  } catch { return 'container'; }
}

function saveStudioMode(mode: StudioMode): void {
  const p = _settingsPath();
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>; } catch { /* fresh */ }
  writeFileSync(p, JSON.stringify({ ...existing, studioMode: mode }, null, 2), 'utf-8');
}

let _studioMode: StudioMode = loadStudioMode();

// ── Songbook scanning ─────────────────────────────────────────────────────────

const SONGBOOK_EXTS = new Set(['.json', '.jsonld', '.yaml', '.yml']);

let _activeSongbookPath: string | null = null;

function scanDir(dir: string, depth = 0): SongbookEntry[] {
  const MAX_DEPTH = 3;
  const entries: SongbookEntry[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }

  const folders: string[] = [];
  const files: string[] = [];
  for (const name of names) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory() && depth < MAX_DEPTH) { folders.push(name); }
      else if (st.isFile() && SONGBOOK_EXTS.has(extname(name).toLowerCase())) { files.push(name); }
    } catch { /* skip inaccessible */ }
  }

  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));

  for (const name of folders) {
    const children = scanDir(join(dir, name), depth + 1);
    if (children.length > 0) {
      entries.push({ type: 'folder', name, path: join(dir, name), children });
    }
  }
  for (const name of files) {
    entries.push({ type: 'file', name: name.replace(/\.[^.]+$/, ''), path: join(dir, name) });
  }
  return entries;
}

function sendSongbooks(): void {
  const songbooksDir = join(StudioManager.canticaHome(platform), 'songbooks');
  const entries = scanDir(songbooksDir);
  send({ type: 'updateSongbooks', entries, activeFile: _activeSongbookPath });
}

// ── Credential sync ───────────────────────────────────────────────────────────

let _registeredWithCurrent = false;
let _lastServerId: string | undefined;

async function _syncCredentials(): Promise<void> {
  if (_registeredWithCurrent) return;
  let creds = loadCredentials(app);
  if (!creds) {
    // First run — auto-generate a key pair silently.
    const pair = generateKeyPair();
    creds = { clientId: randomUUID(), privateKeyPem: pair.privateKeyPem };
    saveCredentials(app, creds);
  }
  try {
    await client.registerClientKey(creds.clientId, publicKeyFromPrivate(creds.privateKeyPem));
    getAuth = makeCachedAssertion(creds, studioBaseUrl);
    _registeredWithCurrent = true;
  } catch {
    // API not ready yet; will retry on next healthy tick.
  }
}

// ── Health poll ───────────────────────────────────────────────────────────────

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
        void _syncCredentials();
        send({
          type: 'studioStatus', health: 'healthy', url: studioBaseUrl,
          ...(version !== undefined ? { version } : {}),
          ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
          ...(workspace !== undefined ? { workspace } : {}),
          ...(containerized !== undefined ? { containerized } : {}),
        });
      } else {
        _registeredWithCurrent = false;
        send({ type: 'studioStatus', health: 'down', url: studioBaseUrl });
      }
    });
  }, 5000);
}

function stopHealthPoll(): void {
  if (_healthPollTimer !== undefined) {
    clearInterval(_healthPollTimer);
    _healthPollTimer = undefined;
  }
}

// ── Notification poll ─────────────────────────────────────────────────────────

let _notifPollTimer: ReturnType<typeof setInterval> | undefined;

function startNotifPoll(): void {
  if (_notifPollTimer !== undefined) return;
  _notifPollTimer = setInterval(() => {
    if (win) void pushNotifications();
  }, 3000);
}

function stopNotifPoll(): void {
  if (_notifPollTimer !== undefined) {
    clearInterval(_notifPollTimer);
    _notifPollTimer = undefined;
  }
}

async function pushNotifications(): Promise<void> {
  const notes = await client.drainNotifications();
  for (const fwd of notes) {
    const promptLine = fwd.prompt.replace(/[\r\n]+/g, ' ').trim();
    send({ type: 'actorOutput', name: fwd.name, output: `> ${promptLine}` });
    send({ type: 'actorOutput', name: fwd.name, output: fwd.output });
  }
  const mcpEntries = await client.drainMcpLog();
  for (const entry of mcpEntries) {
    send({ type: 'mcpLog', entry });
  }
}

function pollResolvedModel(name: string): void {
  const maxAttempts = 30;
  let attempt = 0;
  const tick = async (): Promise<void> => {
    if (attempt++ >= maxAttempts) return;
    const model = await client.fetchResolvedModel(name);
    if (model) {
      send({ type: 'actorModelResolved', name, model });
    } else {
      setTimeout(() => void tick(), 2000);
    }
  };
  setTimeout(() => void tick(), 2000);
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(msg: unknown): Promise<void> {
  if (typeof msg !== 'object' || msg === null) return;
  const raw = msg as Record<string, unknown>;

  switch (raw['type']) {
    case 'ready': {
      // Push initial status and settings to sidebar
      send({ type: 'studioStatus', health: 'starting', url: studioBaseUrl });
      send({ type: 'studioMode', mode: _studioMode });
      sendSongbooks();
      // Push initial settings, graph, and prompts to the renderer
      const graph = await client.loadGraph();
      if (graph) send({ type: 'loadGraph', graph });
      const prompts = await client.fetchPrompts([]);
      send({ type: 'updatePrompts', prompts });
      // Kick off provider models fetch (may take a moment)
      void (async () => {
        let models = await client.fetchProviderModels(true);
        if (Object.keys(models).length === 0) {
          await new Promise((r) => setTimeout(r, 3000));
          models = await client.fetchProviderModels(true);
        }
        if (Object.keys(models).length > 0) {
          send({ type: 'providerModels', models });
        }
      })();
      break;
    }

    case 'saveGraph': {
      const graph = raw['graph'] as ActorGraph;
      try {
        if (_activeSongbookPath) {
          writeFileSync(_activeSongbookPath, JSON.stringify(graph, null, 2), 'utf-8');
        } else {
          await client.saveGraph(graph);
        }
      } catch (err) {
        send({ type: 'error', message: `Save failed: ${String(err)}` });
      }
      break;
    }

    case 'openSongbook': {
      const filePath = raw['path'] as string;
      try {
        const graph = JSON.parse(readFileSync(filePath, 'utf-8')) as ActorGraph;
        _activeSongbookPath = filePath;
        send({ type: 'loadGraph', graph });
        sendSongbooks();
      } catch (err) {
        send({ type: 'error', message: `Failed to open songbook: ${String(err)}` });
      }
      break;
    }

    case 'refreshSongbooks': {
      sendSongbooks();
      break;
    }

    case 'runActor': {
      const name = raw['name'] as string;
      const instruction = raw['instruction'] as string;
      const isStartOnly = instruction === '__start__';

      let alreadyRunning: boolean;
      try {
        const runningNames = await client.listRunning();
        alreadyRunning = runningNames.includes(name);
      } catch (err) {
        send({ type: 'actorOutput', name, output: `Warning: Studio API not reachable — ${String(err)}` });
        break;
      }

      if (!alreadyRunning) {
        const graph = await client.loadGraph();
        const def = graph?.actors.find((a) => a.name === name);
        if (!def) {
          send({ type: 'actorOutput', name, output: `Warning: Actor "${name}" not found in the graph — open the songbook first.` });
          break;
        }
        const tag = def.actorType === 'ai' ? `${def.provider} / ${def.model}` : def.actorType;
        send({ type: 'actorOutput', name, output: `Initialising ${tag}…` });
        try {
          const { initialOutput, resolvedModel } = await client.startActor(def);
          if (initialOutput) send({ type: 'actorOutput', name, output: initialOutput });
          send({ type: 'actorOutput', name, output: `Ready · ${tag}` });
          send({ type: 'actorStatus', name, running: true });
          if (resolvedModel) {
            send({ type: 'actorModelResolved', name, model: resolvedModel });
          } else if (def.actorType === 'ai' && def.model === 'auto') {
            pollResolvedModel(name);
          }
        } catch (err) {
          send({ type: 'actorOutput', name, output: `Warning: Start failed: ${String(err)}` });
          break;
        }
      } else if (isStartOnly) {
        send({ type: 'actorOutput', name, output: `· ${name} is already running` });
        send({ type: 'actorStatus', name, running: true });
        // For copilot/auto actors, poll for the resolved model (may have been lost on reconnect)
        const graph2 = await client.loadGraph();
        const def2 = graph2?.actors.find((a) => a.name === name);
        if (def2?.actorType === 'ai' && def2?.model === 'auto') {
          pollResolvedModel(name);
        }
      }

      if (isStartOnly) break;

      try {
        const { output, resolvedModel } = await client.instructActor(name, instruction);
        send({ type: 'actorOutput', name, output });
        if (resolvedModel) send({ type: 'actorModelResolved', name, model: resolvedModel });
        await pushNotifications();
      } catch (err) {
        send({ type: 'actorOutput', name, output: `Warning: Prompt failed: ${String(err)}` });
      }
      break;
    }

    case 'fireEvent': {
      const name = raw['name'] as string;
      const eventName = raw['eventName'] as string;
      const context = (raw['context'] as string | undefined) ?? '';
      try {
        const result = await client.fireEvent(name, eventName, context);
        send({ type: 'actorOutput', name, output: result.output });
        for (const fwd of result.forwarded) {
          const promptLine = fwd.prompt.replace(/[\r\n]+/g, ' ').trim();
          send({ type: 'actorOutput', name: fwd.name, output: `> ${promptLine}` });
          send({ type: 'actorOutput', name: fwd.name, output: fwd.output });
        }
        await pushNotifications();
      } catch (err) {
        send({ type: 'error', message: String(err) });
      }
      break;
    }

    case 'stopActor': {
      const name = raw['name'] as string;
      try {
        await client.stopActor(name);
        send({ type: 'actorStatus', name, running: false });
        send({ type: 'actorPaused', name, paused: false });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      }
      break;
    }

    case 'pauseActor': {
      const name = raw['name'] as string;
      try {
        await client.pauseActor(name);
        send({ type: 'actorPaused', name, paused: true });
        send({ type: 'actorOutput', name, output: 'Paused — prompts will be queued' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      }
      break;
    }

    case 'resumeActor': {
      const name = raw['name'] as string;
      try {
        await client.resumeActor(name);
        send({ type: 'actorPaused', name, paused: false });
        send({ type: 'actorOutput', name, output: 'Resumed' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      }
      break;
    }

    case 'refreshPrompts': {
      const prompts = await client.fetchPrompts([]);
      send({ type: 'updatePrompts', prompts });
      break;
    }

    case 'configureServer': {
      // In Electron there's no VSCode settings UI; log a hint to use env vars.
      platform.log('[studio] configureServer: set CANTICA_* environment variables and restart the app.');
      break;
    }

    case 'startLocalStudio': {
      const url = await studio.ensureRunning(_studioMode);
      if (url) {
        studioBaseUrl = url;
        client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
        _registeredWithCurrent = false;
        // Refresh provider models after studio comes up.
        void client.fetchProviderModels(true).then((models) => {
          if (Object.keys(models).length > 0) send({ type: 'providerModels', models });
        });
      }
      break;
    }

    case 'stopLocalStudio': {
      await studio.stop(_studioMode);
      _registeredWithCurrent = false;
      break;
    }

    case 'setStudioMode': {
      const mode = raw['mode'] as 'native' | 'container';
      if (mode === 'native' || mode === 'container') {
        _studioMode = mode;
        saveStudioMode(mode);
        send({ type: 'studioMode', mode });
      }
      break;
    }

    case 'playSongbook': {
      const graph = await client.loadGraph();
      if (!graph) break;
      let runningNames: string[] = [];
      try { runningNames = await client.listRunning(); } catch { /* ignore */ }
      for (const actor of graph.actors) {
        if (runningNames.includes(actor.name)) {
          send({ type: 'actorOutput', name: actor.name, output: `· ${actor.name} already running` });
          send({ type: 'actorStatus', name: actor.name, running: true });
          continue;
        }
        const tag = actor.actorType === 'ai'
          ? `${actor.provider} / ${actor.model}`
          : actor.actorType;
        send({ type: 'actorOutput', name: actor.name, output: `Initialising ${tag}…` });
        try {
          const { initialOutput, resolvedModel } = await client.startActor(actor);
          if (initialOutput) send({ type: 'actorOutput', name: actor.name, output: initialOutput });
          send({ type: 'actorOutput', name: actor.name, output: `Ready · ${tag}` });
          send({ type: 'actorStatus', name: actor.name, running: true });
          if (resolvedModel) {
            send({ type: 'actorModelResolved', name: actor.name, model: resolvedModel });
          } else if (actor.actorType === 'ai' && actor.model === 'auto') {
            pollResolvedModel(actor.name);
          }
        } catch (err) {
          send({ type: 'actorOutput', name: actor.name, output: `Warning: Start failed: ${String(err)}` });
        }
      }
      break;
    }

    case 'stopSongbook': {
      try {
        const { stopped } = await client.stopAllActors();
        for (const name of stopped) {
          send({ type: 'actorStatus', name, running: false });
        }
      } catch {
        // ignore
      }
      break;
    }

    case 'loadGraph': {
      const graph = await client.loadGraph();
      if (graph) send({ type: 'loadGraph', graph });
      break;
    }

    default:
      platform.log(`[studio] Unhandled message type: ${String(raw['type'])}`);
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  ipcMain.on('from-renderer', (_event, msg: unknown) => {
    void handleMessage(msg);
  });

  createWindow();
  startHealthPoll();
  startNotifPoll();

  // Auto-start local studio if not already running
  void studio.isRunning().then((running) => {
    if (!running) {
      void studio.ensureRunning().then((url) => {
        if (url) {
          studioBaseUrl = url;
          client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
          _registeredWithCurrent = false;
        }
      });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopHealthPoll();
  stopNotifPoll();
  studio.dispose();
  if (process.platform !== 'darwin') app.quit();
});
