import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { StudioManager } from '../shared/studioManager.js';
import type { StudioMode } from '../shared/studioManager.js';
import { StudioClient, parseGraph, serializeGraph } from '../shared/studio-client.js';
import { generateKeyPair, makeCachedAssertion, publicKeyFromPrivate } from '../shared/auth-core.js';
import type { ToWebview, SongbookEntry, ActorGraph, ProviderKeyId, ProviderKeyStatus, SetupState } from '../shared/types/index.js';
import { ElectronPlatform } from './platform.js';
import { loadCredentials, saveCredentials } from './auth-store.js';
import { loadProviderKeys, saveProviderKeys } from './key-store.js';

const PROVIDER_ENV_KEYS: Record<ProviderKeyId, string> = {
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  geminiApiKey: 'GEMINI_API_KEY',
  githubToken: 'GITHUB_TOKEN',
};

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
client.onWarning = (text) => send({ type: 'serverWarning', text });

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

// ── Setup state (mode/remote-url/setup-done share studio-settings.json) ───────

interface AppSettings {
  studioMode?: string;
  mode?: 'local' | 'remote';
  remoteUrl?: string;
  setupDone?: boolean;
}

function loadAppSettings(): AppSettings {
  try { return JSON.parse(readFileSync(_settingsPath(), 'utf-8')) as AppSettings; } catch { return {}; }
}

function saveAppSettings(patch: Partial<AppSettings>): void {
  writeFileSync(_settingsPath(), JSON.stringify({ ...loadAppSettings(), ...patch }, null, 2), 'utf-8');
}

/** Push setup/provider-key state (presence only — key material never leaves the main process). */
function pushSetupState(): void {
  const s = loadAppSettings();
  const keys = loadProviderKeys(app);
  const status = (id: ProviderKeyId): ProviderKeyStatus =>
    process.env[PROVIDER_ENV_KEYS[id]]?.trim() ? 'env' : keys[id]?.trim() ? 'stored' : 'none';
  const state: SetupState = {
    mode: s.mode === 'remote' ? 'remote' : 'local',
    runMode: _studioMode,
    remoteUrl: s.remoteUrl ?? '',
    setupDone: !!s.setupDone,
    keys: {
      anthropicApiKey: status('anthropicApiKey'),
      openaiApiKey: status('openaiApiKey'),
      geminiApiKey: status('geminiApiKey'),
      githubToken: status('githubToken'),
    },
  };
  send({ type: 'setupState', state });
}

// ── Songbook scanning ─────────────────────────────────────────────────────────

const SONGBOOK_EXTS = new Set(['.json', '.jsonld', '.yaml', '.yml']);

const _openSongbooks: Map<string, ActorGraph> = new Map();
let _activeSongbookPath: string | null = null;

const APP_LABEL = 'Cantica Studio';

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
  send({ type: 'updateSongbooks', entries, activeFile: _activeSongbookPath, openFiles: [..._openSongbooks.keys()] });
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
    // Local mode: seed the server DB with stored provider keys so actors can
    // authenticate even when the host env lacks the vars.
    if (loadAppSettings().mode !== 'remote') {
      void client.syncProviderKeys(loadProviderKeys(app));
    }
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
  for (const note of notes) {
    if (note.type === 'actorModelResolved') {
      send({ type: 'actorModelResolved', name: note.name, model: note.model });
      // Fresh resolution — the start path deferred its Ready line for this.
      send({ type: 'actorOutput', name: note.name, output: `Ready · copilot / ${note.model} (auto)` });
      continue;
    }
    const promptLine = note.prompt.replace(/[\r\n]+/g, ' ').trim();
    send({ type: 'actorOutput', name: note.name, output: `> ${promptLine}` });
    send({ type: 'actorOutput', name: note.name, output: note.output });
  }
  const mcpEntries = await client.drainMcpLog();
  for (const entry of mcpEntries) {
    send({ type: 'mcpLog', entry });
  }
}

/** Push resolved models for running Copilot actors (the backend outlives the renderer). */
async function pushResolvedModels(names?: string[]): Promise<void> {
  const summaries = await client.fetchActorsSummary();
  for (const s of summaries) {
    if (names && !names.includes(s.name)) continue;
    if (s.provider === 'copilot' && s.model && s.model !== 'auto') {
      send({ type: 'actorModelResolved', name: s.name, model: s.model });
    }
  }
}

/** Push the users/roles/mappings snapshot backing the admin screens. */
async function pushAdminData(): Promise<void> {
  const [users, roles, mappings] = await Promise.all([
    client.listUsers(),
    client.listRoleNames(),
    client.listDirectoryMappings(),
  ]);
  send({ type: 'adminData', data: { users, roles, mappings } });
}

/** Run an admin mutation, surface failures, refresh the admin snapshot. */
async function adminAction(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    send({ type: 'error', message: String(err) });
  }
  await pushAdminData();
}

/** Restore running/resolved state after a renderer (re)load. */
async function pushRunningState(): Promise<void> {
  let runningNames: string[] = [];
  try { runningNames = await client.listRunning(); } catch { return; }
  for (const name of runningNames) {
    send({ type: 'actorStatus', name, running: true });
  }
  if (runningNames.length) await pushResolvedModels(runningNames);
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
      // The backend outlives the renderer — restore running state and resolved
      // models for actors that were started before this renderer loaded.
      void pushRunningState();
      pushSetupState();
      // First run: open the setup form instead of assuming defaults.
      if (!loadAppSettings().setupDone) send({ type: 'openSetup' });
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
      const savePath = (raw['path'] as string | undefined) ?? _activeSongbookPath;
      try {
        if (savePath) {
          writeFileSync(savePath, JSON.stringify(serializeGraph(graph), null, 2), 'utf-8');
          _openSongbooks.set(savePath, graph);
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
      if (_openSongbooks.has(filePath)) {
        // Already open — just switch to it.
        _activeSongbookPath = filePath;
        send({ type: 'loadGraph', graph: _openSongbooks.get(filePath)! });
        send({ type: 'activeSongbookChanged', path: filePath });
        sendSongbooks();
        break;
      }
      // Claim the file lock on the server before opening.
      try {
        const creds = loadCredentials(app);
        const clientId = creds?.clientId ?? 'electron-unknown';
        await client.claimFileLock(filePath, clientId, APP_LABEL);
      } catch (err: unknown) {
        const lockErr = err as { lock?: { client_label?: string; client_host?: string } };
        const who = lockErr?.lock?.client_label || 'another client';
        const from = lockErr?.lock?.client_host ? ` (${lockErr.lock.client_host})` : '';
        send({ type: 'error', message: `File is already open by ${who}${from}` });
        break;
      }
      try {
        const rawJson = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        const graph = parseGraph(rawJson, filePath);
        _openSongbooks.set(filePath, graph);
        _activeSongbookPath = filePath;
        send({ type: 'loadGraph', graph });
        send({ type: 'activeSongbookChanged', path: filePath });
        sendSongbooks();
      } catch (err) {
        // Failed to parse — release the lock we just claimed.
        const creds = loadCredentials(app);
        const clientId = creds?.clientId ?? 'electron-unknown';
        void client.releaseFileLock(filePath, clientId);
        send({ type: 'error', message: `Failed to open songbook: ${String(err)}` });
      }
      break;
    }

    case 'switchSongbook': {
      const filePath = raw['path'] as string;
      if (!_openSongbooks.has(filePath)) break;
      _activeSongbookPath = filePath;
      send({ type: 'loadGraph', graph: _openSongbooks.get(filePath)! });
      send({ type: 'activeSongbookChanged', path: filePath });
      sendSongbooks();
      break;
    }

    case 'closeSongbook': {
      const filePath = raw['path'] as string;
      if (!_openSongbooks.has(filePath)) break;
      _openSongbooks.delete(filePath);
      const creds = loadCredentials(app);
      const clientId = creds?.clientId ?? 'electron-unknown';
      void client.releaseFileLock(filePath, clientId);
      if (_activeSongbookPath === filePath) {
        const nextPath = _openSongbooks.size > 0 ? [..._openSongbooks.keys()][0] : null;
        _activeSongbookPath = nextPath;
        if (nextPath) {
          send({ type: 'loadGraph', graph: _openSongbooks.get(nextPath)! });
        }
        send({ type: 'activeSongbookChanged', path: nextPath });
      }
      sendSongbooks();
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
        const graph = (_activeSongbookPath ? _openSongbooks.get(_activeSongbookPath) : null) ?? await client.loadGraph();
        const def = graph?.actors.find((a) => a.name === name);
        if (!def) {
          send({ type: 'actorOutput', name, output: `Warning: Actor "${name}" not found in the graph — open the songbook first.` });
          break;
        }
        const tag = def.actorType === 'ai' ? `${def.provider} / ${def.model}` : def.actorType;
        send({ type: 'actorOutput', name, output: `Initialising ${tag}…` });
        try {
          const { initialOutput } = await client.startActor(def);
          if (initialOutput) send({ type: 'actorOutput', name, output: initialOutput });
          // Copilot 'auto' actors are not ready until the model probe finishes —
          // the Ready line is sent when the actorModelResolved notification arrives.
          const resolving = def.actorType === 'ai' && def.provider === 'copilot' && def.model === 'auto';
          send({ type: 'actorOutput', name, output: resolving ? 'Resolving model…' : `Ready · ${tag}` });
          send({ type: 'actorStatus', name, running: true });
        } catch (err) {
          send({ type: 'actorOutput', name, output: `Warning: Start failed: ${String(err)}` });
          break;
        }
      } else if (isStartOnly) {
        send({ type: 'actorOutput', name, output: `· ${name} is already running` });
        send({ type: 'actorStatus', name, running: true });
        // The resolved-model notification was consumed long ago — re-fetch it.
        await pushResolvedModels([name]);
      }

      if (isStartOnly) break;

      try {
        const { output } = await client.instructActor(name, instruction);
        send({ type: 'actorOutput', name, output });
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
      client.onWarning = (text) => send({ type: 'serverWarning', text });
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
      const graph = (_activeSongbookPath ? _openSongbooks.get(_activeSongbookPath) : null) ?? await client.loadGraph();
      if (!graph) break;
      let runningNames: string[] = [];
      try { runningNames = await client.listRunning(); } catch { /* ignore */ }
      const alreadyRunning: string[] = [];
      for (const actor of graph.actors) {
        if (runningNames.includes(actor.name)) {
          send({ type: 'actorOutput', name: actor.name, output: `· ${actor.name} already running` });
          send({ type: 'actorStatus', name: actor.name, running: true });
          alreadyRunning.push(actor.name);
          continue;
        }
        const tag = actor.actorType === 'ai'
          ? `${actor.provider} / ${actor.model}`
          : actor.actorType;
        send({ type: 'actorOutput', name: actor.name, output: `Initialising ${tag}…` });
        try {
          const { initialOutput } = await client.startActor(actor);
          if (initialOutput) send({ type: 'actorOutput', name: actor.name, output: initialOutput });
          const resolving = actor.actorType === 'ai' && actor.provider === 'copilot' && actor.model === 'auto';
          send({ type: 'actorOutput', name: actor.name, output: resolving ? 'Resolving model…' : `Ready · ${tag}` });
          send({ type: 'actorStatus', name: actor.name, running: true });
        } catch (err) {
          send({ type: 'actorOutput', name: actor.name, output: `Warning: Start failed: ${String(err)}` });
        }
      }
      if (alreadyRunning.length) await pushResolvedModels(alreadyRunning);
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

    case 'requestSetupState':
      pushSetupState();
      break;

    case 'saveSetup': {
      const mode = raw['mode'] === 'remote' ? 'remote' : 'local';
      const runMode = raw['runMode'] === 'native' ? 'native' : 'container';
      const remoteUrl = ((raw['remoteUrl'] as string | undefined) ?? '').trim();
      const prev = loadAppSettings();
      const prevMode = prev.mode === 'remote' ? 'remote' : 'local';
      const prevRunMode = _studioMode;

      saveAppSettings({ mode, remoteUrl, setupDone: true });
      _studioMode = runMode;
      saveStudioMode(runMode);
      send({ type: 'studioMode', mode: runMode });
      pushSetupState();

      if (mode === 'remote' && remoteUrl) {
        studioBaseUrl = remoteUrl;
        client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
      client.onWarning = (text) => send({ type: 'serverWarning', text });
        _registeredWithCurrent = false;
      } else if (mode === 'local' && (prevMode !== 'local' || prevRunMode !== runMode || !prev.setupDone)) {
        void (async () => {
          if (prevMode === 'local') await studio.stop(prevRunMode);
          const url = await studio.ensureRunning(runMode, loadProviderKeys(app));
          if (url) {
            studioBaseUrl = url;
            client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
      client.onWarning = (text) => send({ type: 'serverWarning', text });
            _registeredWithCurrent = false;
          }
        })();
      }
      break;
    }

    case 'saveProviderKey': {
      const provider = raw['provider'] as ProviderKeyId;
      const key = ((raw['key'] as string | undefined) ?? '').trim();
      if (!(provider in PROVIDER_ENV_KEYS) || !key) break;
      const keys = loadProviderKeys(app);
      keys[provider] = key;
      saveProviderKeys(app, keys);
      void client.syncProviderKeys(keys);
      pushSetupState();
      break;
    }

    case 'clearProviderKey': {
      const provider = raw['provider'] as ProviderKeyId;
      if (!(provider in PROVIDER_ENV_KEYS)) break;
      const keys = loadProviderKeys(app);
      keys[provider] = '';
      saveProviderKeys(app, keys);
      void client.syncProviderKeys(keys);
      pushSetupState();
      break;
    }

    case 'requestAdminData':
      await pushAdminData();
      break;

    case 'activateUser':
      await adminAction(() => client.activateUser(raw['userId'] as string));
      break;

    case 'addUserFlag':
      await adminAction(() => client.addUserFlag(
        raw['userId'] as string, raw['flag'] as string, (raw['comment'] as string | undefined) ?? '',
      ));
      break;

    case 'removeUserFlag':
      await adminAction(() => client.removeUserFlag(raw['userId'] as string, raw['flagId'] as string));
      break;

    case 'addDirectoryMapping':
      await adminAction(() => client.addDirectoryMapping(
        raw['externalGroup'] as string, raw['roleName'] as string,
      ));
      break;

    case 'removeDirectoryMapping':
      await adminAction(() => client.removeDirectoryMapping(raw['mappingId'] as string));
      break;

    case 'secure:request': {
      // Relay for @cantica/secure-ui's bridge transport (Phase E). The token
      // stays in the main process and never enters the renderer.
      const id = raw['id'] as number;
      const req = raw['request'] as { method: string; path: string; body?: unknown };
      try {
        const response = await client.secureRequest(req);
        send({ type: 'secure:response', id, response });
      } catch (err) {
        send({ type: 'secure:response', id, response: { ok: false, status: 0, data: { detail: String(err) } } });
      }
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

  const appSettings = loadAppSettings();
  if (appSettings.mode === 'remote' && appSettings.remoteUrl) {
    // Remote mode: point the client at the configured server, manage nothing.
    studioBaseUrl = appSettings.remoteUrl;
    client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
      client.onWarning = (text) => send({ type: 'serverWarning', text });
  } else {
    // Auto-start local studio if not already running
    void studio.isRunning().then((running) => {
      if (!running) {
        void studio.ensureRunning(_studioMode, loadProviderKeys(app)).then((url) => {
          if (url) {
            studioBaseUrl = url;
            client = new StudioClient(studioBaseUrl, () => getAuth?.() ?? null);
      client.onWarning = (text) => send({ type: 'serverWarning', text });
            _registeredWithCurrent = false;
          }
        });
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopHealthPoll();
  stopNotifPoll();
  studio.dispose();
  // Best-effort lock release for all open songbooks — don't block shutdown.
  if (_openSongbooks.size > 0) {
    const creds = loadCredentials(app);
    const clientId = creds?.clientId ?? 'electron-unknown';
    for (const filePath of _openSongbooks.keys()) {
      void client.releaseFileLock(filePath, clientId);
    }
  }
  if (process.platform !== 'darwin') app.quit();
});
