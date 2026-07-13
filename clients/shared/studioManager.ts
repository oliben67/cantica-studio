import * as child_process from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Platform } from './platform.js';

const IMAGE = 'studio-api:latest';
const CONTAINER = 'studio-api';
const INTERNAL_PORT = 8043;

export type StudioMode = 'native' | 'container';

/** Provider API keys resolved at startup (SecretStorage > settings > host env). */
export interface ProviderApiKeys {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  githubToken?: string;
}

export class StudioManager {
  private _nativeProc: child_process.ChildProcess | null = null;
  private _stopPromise: Promise<void> | null = null;

  constructor(private readonly platform: Platform) {}

  dispose(): void {
    if (this._nativeProc?.pid) {
      try { process.kill(-this._nativeProc.pid, 'SIGTERM'); } catch {
        try { this._nativeProc.kill(); } catch { /* ignore */ }
      }
      this._nativeProc = null;
    }
  }

  /** Resolved canticaHome from settings or OS default. */
  static canticaHome(platform: Platform): string {
    const configured = platform.getConfig<string>('canticaScores', 'canticaHome', '');
    return configured || path.join(os.homedir(), '.cantica');
  }

  /** Port for the local studio API (from settings or default). */
  static studioPort(platform: Platform): number {
    return platform.getConfig<number>('canticaScores', 'studioPort', INTERNAL_PORT);
  }

  /** URL for the local studio API. */
  static studioUrl(platform: Platform): string {
    return `http://localhost:${StudioManager.studioPort(platform)}`;
  }

  /** Returns true if Docker is available on PATH. */
  async isDockerAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      child_process.exec('docker info', { timeout: 5000 }, (err) => resolve(!err));
    });
  }

  /** Returns true if the container is currently running. */
  async isRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      child_process.exec(
        `docker inspect --format "{{.State.Running}}" ${CONTAINER}`,
        { timeout: 5000 },
        (err, stdout) => resolve(!err && stdout.trim() === 'true'),
      );
    });
  }

  /** Returns true if the image exists locally. */
  async imageExists(): Promise<boolean> {
    return new Promise((resolve) => {
      child_process.exec(
        `docker image inspect ${IMAGE}`,
        { timeout: 5000 },
        (err) => resolve(!err),
      );
    });
  }

  /** Pull the image from the registry. */
  async pullImage(report: (message: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      report(`Pulling ${IMAGE}…`);
      this.platform.log(`[studio] Pulling ${IMAGE}`);
      const proc = child_process.spawn('docker', ['pull', IMAGE], { stdio: 'pipe' });
      proc.stdout.on('data', (d: Buffer) => this.platform.log(d.toString()));
      proc.stderr.on('data', (d: Buffer) => this.platform.log(d.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`docker pull exited with code ${code}`));
        }
      });
    });
  }

  /** Resolve a single provider key: passed keys (SecretStorage) > host env. */
  private _resolveKey(passed: string | undefined, envKey: string): string {
    return passed?.trim() || (process.env[envKey] ?? '');
  }

  /** Start the container. Assumes the image is present. */
  async start(report: (message: string) => void, keys?: ProviderApiKeys): Promise<void> {
    const port = StudioManager.studioPort(this.platform);
    const home = StudioManager.canticaHome(this.platform);

    // Remove a stopped/dead container with the same name first.
    await new Promise<void>((resolve) => {
      child_process.exec(`docker rm -f ${CONTAINER}`, { timeout: 5000 }, () => resolve());
    });

    report('Starting Cantica Studio API container…');
    this.platform.log(`[studio] Starting container — home=${home} port=${port}`);

    // Resolve API keys: passed keys (SecretStorage) > host env.
    const apiKeys: [string, string][] = [
      ['ANTHROPIC_API_KEY', this._resolveKey(keys?.anthropicApiKey, 'ANTHROPIC_API_KEY')],
      ['OPENAI_API_KEY',    this._resolveKey(keys?.openaiApiKey,    'OPENAI_API_KEY')],
      ['GEMINI_API_KEY',    this._resolveKey(keys?.geminiApiKey,    'GEMINI_API_KEY')],
      ['GITHUB_TOKEN',      this._resolveKey(keys?.githubToken,     'GITHUB_TOKEN')],
    ];

    const args = [
      'run',
      '-d',
      '--name', CONTAINER,
      '--restart', 'unless-stopped',
      '-p', `${port}:${INTERNAL_PORT}`,
      '-v', `${home}:/cantica-home`,
      '-e', `CANTICA_HOME=/cantica-home`,
      '-e', `CANTICA_PORT=${INTERNAL_PORT}`,
    ];

    for (const [key, value] of apiKeys) {
      if (value) args.push('-e', `${key}=${value}`);
    }

    args.push(IMAGE);

    await new Promise<void>((resolve, reject) => {
      child_process.execFile('docker', args, { timeout: 15_000 }, (err, stdout, stderr) => {
        if (err) {
          this.platform.log(`[studio] start error: ${stderr}`);
          reject(new Error(`Failed to start container: ${stderr || err.message}`));
        } else {
          this.platform.log(`[studio] Container started: ${stdout.trim()}`);
          resolve();
        }
      });
    });
  }

  /** Stop the studio API — native process or Docker container, with port-kill fallback. */
  async stop(mode: StudioMode = 'container'): Promise<void> {
    // Expose the in-progress promise so ensureRunning can wait for it to finish
    // before checking health, preventing a race where Start sees a healthy server
    // that is about to be removed by an in-flight Stop.
    this._stopPromise = this._doStop(mode);
    try {
      await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }

  private async _doStop(mode: StudioMode): Promise<void> {
    if (mode === 'native') {
      await this.stopNative();
    } else {
      // Kill tracked native process first (may coexist with container attempt).
      if (this.isNativeRunning()) await this.stopNative();
      const port = StudioManager.studioPort(this.platform);
      this.platform.log('[studio] Stopping container');
      // Try the expected container name, then stop any container publishing the studio port.
      // The second clause handles dev setups where the container was started with a different
      // name (e.g. via `docker compose` with a project-prefixed name).
      await new Promise<void>((resolve) => {
        const cmd = `docker rm -f ${CONTAINER} 2>/dev/null; docker ps --filter "publish=${port}" --format "{{.Names}}" 2>/dev/null | xargs -r docker rm -f 2>/dev/null; true`;
        child_process.exec(cmd, { timeout: 10_000 }, () => resolve());
      });
    }
    // Fallback: if the server is still reachable (e.g. started externally via `task serve`
    // which runs uvicorn --reload), kill by port.  We must kill the parent process (the
    // uvicorn reloader) BEFORE killing the child (the worker that owns the port), otherwise
    // the reloader detects the worker's death and immediately respawns it.
    if (await this.isHealthy()) {
      const port = StudioManager.studioPort(this.platform);
      this.platform.log(`[studio] Server still up after stop — killing port ${port} and parent`);
      await new Promise<void>((resolve) => {
        const cmd = process.platform === 'darwin'
          ? `for PID in $(lsof -ti :${port} 2>/dev/null); do PPID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' '); kill -9 "$PPID" 2>/dev/null; kill -9 "$PID" 2>/dev/null; done; true`
          : `docker ps --filter "publish=${port}" --format "{{.Names}}" 2>/dev/null | xargs -r docker rm -f 2>/dev/null; for PID in $(fuser ${port}/tcp 2>/dev/null); do PPID=$(awk '/^PPid:/{print $2}' /proc/$PID/status 2>/dev/null); kill -9 "$PPID" 2>/dev/null; kill -9 "$PID" 2>/dev/null; done; true`;
        child_process.exec(cmd, { timeout: 8_000 }, () => resolve());
      });
    }
  }

  /** Returns true if the API is already responding on its health endpoint. */
  async isHealthy(): Promise<boolean> {
    const url = `${StudioManager.studioUrl(this.platform)}/health`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Poll the health endpoint until it responds ok or timeout expires.
   * Returns true when healthy, false on timeout.
   */
  async waitUntilHealthy(
    timeoutMs = 30_000,
    intervalMs = 1_000,
  ): Promise<boolean> {
    const url = `${StudioManager.studioUrl(this.platform)}/health`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return true;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  // ── Native mode ───────────────────────────────────────────────────────────

  isNativeRunning(): boolean {
    return this._nativeProc != null && this._nativeProc.exitCode === null && !this._nativeProc.killed;
  }

  async startNative(report: (message: string) => void, keys?: ProviderApiKeys): Promise<void> {
    const port = StudioManager.studioPort(this.platform);
    const home = StudioManager.canticaHome(this.platform);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      STUDIO_PORT: String(port),
      STUDIO_WORKSPACE: home,
    };

    // Resolve API keys: passed keys (SecretStorage) > host env.
    for (const [envKey, passedKey] of [
      ['ANTHROPIC_API_KEY', keys?.anthropicApiKey],
      ['OPENAI_API_KEY',    keys?.openaiApiKey],
      ['GEMINI_API_KEY',    keys?.geminiApiKey],
      ['GITHUB_TOKEN',      keys?.githubToken],
    ] as [string, string | undefined][]) {
      const val = this._resolveKey(passedKey, envKey);
      if (val) env[envKey] = val;
    }

    report('Starting Cantica Studio API (native)…');
    this.platform.log(`[studio] Native start — port=${port} workspace=${home}`);

    await new Promise<void>((resolve, reject) => {
      // detached: true gives the child its own process group so we can kill the
      // whole group (reloader + worker) with process.kill(-pid) in stopNative().
      const proc = child_process.spawn('studio', [], { env, stdio: 'pipe', detached: true });
      proc.stdout?.on('data', (d: Buffer) => this.platform.log(d.toString().trimEnd()));
      proc.stderr?.on('data', (d: Buffer) => this.platform.log(d.toString().trimEnd()));
      proc.on('error', (err) => reject(new Error(`Failed to start studio: ${err.message}`)));
      // Resolve once the process is alive (a short delay so uvicorn can bind).
      setTimeout(() => {
        if (proc.exitCode === null) { this._nativeProc = proc; resolve(); }
        else reject(new Error(`studio exited immediately (code ${proc.exitCode})`));
      }, 800);
    });
  }

  async stopNative(): Promise<void> {
    if (!this._nativeProc?.pid) return;
    this.platform.log('[studio] Stopping native process group');
    try {
      // Kill the entire process group (reloader + worker) to prevent auto-restart.
      process.kill(-this._nativeProc.pid, 'SIGTERM');
    } catch {
      this._nativeProc.kill('SIGTERM');
    }
    this._nativeProc = null;
  }

  async ensureRunningNative(keys?: ProviderApiKeys): Promise<string | undefined> {
    if (this._stopPromise) await this._stopPromise;
    if (this.isNativeRunning()) return StudioManager.studioUrl(this.platform);
    if (await this.isHealthy()) return StudioManager.studioUrl(this.platform);

    return this.platform.withProgress('Cantica Studio', async (report) => {
      try {
        await this.startNative(report, keys);
        report('Waiting for API to become ready…');
        const healthy = await this.waitUntilHealthy(15_000);
        if (!healthy) {
          void this.platform.showError('Cantica Studio API did not become healthy in time.');
          return undefined;
        }
        return StudioManager.studioUrl(this.platform);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.platform.log(`[studio] Native error: ${message}`);
        void this.platform.showError(`Cantica Studio: ${message}`);
        return undefined;
      }
    });
  }

  /**
   * Ensure the local studio API is running.
   * Shows progress UI and handles image pulling if needed.
   * Returns the local URL if successful, or undefined on failure.
   */
  async ensureRunning(mode: StudioMode = 'container', keys?: ProviderApiKeys): Promise<string | undefined> {
    if (mode === 'native') return this.ensureRunningNative(keys);
    // Wait for any in-progress stop to finish before checking health, otherwise
    // isHealthy() may return true for a server that is about to be removed.
    if (this._stopPromise) await this._stopPromise;
    if (!(await this.isDockerAvailable())) {
      void this.platform.showError(
        'Docker is required for the local Cantica Studio. Install Docker Desktop and try again.',
        'Get Docker',
      ).then((choice) => {
        if (choice === 'Get Docker') {
          this.platform.openExternal('https://www.docker.com/products/docker-desktop/');
        }
      });
      return undefined;
    }

    if (await this.isRunning()) {
      return StudioManager.studioUrl(this.platform);
    }

    if (await this.isHealthy()) {
      return StudioManager.studioUrl(this.platform);
    }

    return this.platform.withProgress('Cantica Studio', async (report) => {
      try {
        if (!(await this.imageExists())) {
          await this.pullImage(report);
        }
        await this.start(report, keys);
        report('Waiting for API to become ready…');
        const healthy = await this.waitUntilHealthy();
        if (!healthy) {
          void this.platform.showError(
            'Cantica Studio API did not become healthy in time.',
          );
          return undefined;
        }
        return StudioManager.studioUrl(this.platform);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.platform.log(`[studio] Error: ${message}`);
        void this.platform.showError(`Cantica Studio: ${message}`);
        return undefined;
      }
    });
  }
}
