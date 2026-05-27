import * as child_process from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const IMAGE = 'cantica-studio-api:latest';
const CONTAINER = 'cantica-studio-api';
const INTERNAL_PORT = 8043;

export class StudioManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Cantica Studio');
  }

  dispose(): void {
    this.outputChannel.dispose();
  }

  /** Resolved canticaHome from settings or OS default. */
  static canticaHome(): string {
    const cfg = vscode.workspace.getConfiguration('canticaScores');
    const configured = cfg.get<string>('canticaHome') ?? '';
    return configured || path.join(os.homedir(), '.cantica');
  }

  /** Port for the local studio API (from settings or default). */
  static studioPort(): number {
    const cfg = vscode.workspace.getConfiguration('canticaScores');
    return cfg.get<number>('studioPort') ?? INTERNAL_PORT;
  }

  /** URL for the local studio API. */
  static studioUrl(): string {
    return `http://localhost:${StudioManager.studioPort()}`;
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
  async pullImage(progress: vscode.Progress<{ message?: string }>): Promise<void> {
    return new Promise((resolve, reject) => {
      progress.report({ message: `Pulling ${IMAGE}…` });
      this.outputChannel.appendLine(`[studio] Pulling ${IMAGE}`);
      const proc = child_process.spawn('docker', ['pull', IMAGE], { stdio: 'pipe' });
      proc.stdout.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      proc.stderr.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`docker pull exited with code ${code}`));
        }
      });
    });
  }

  /** Start the container. Assumes the image is present. */
  async start(progress: vscode.Progress<{ message?: string }>): Promise<void> {
    const port = StudioManager.studioPort();
    const home = StudioManager.canticaHome();

    // Remove a stopped/dead container with the same name first.
    await new Promise<void>((resolve) => {
      child_process.exec(`docker rm -f ${CONTAINER}`, { timeout: 5000 }, () => resolve());
    });

    progress.report({ message: 'Starting Cantica Studio API container…' });
    this.outputChannel.appendLine(`[studio] Starting container — home=${home} port=${port}`);

    const args = [
      'run',
      '-d',
      '--name', CONTAINER,
      '--restart', 'unless-stopped',
      '-p', `${port}:${INTERNAL_PORT}`,
      '-v', `${home}:/cantica-home`,
      '-e', `CANTICA_HOME=/cantica-home`,
      '-e', `CANTICA_PORT=${INTERNAL_PORT}`,
      IMAGE,
    ];

    await new Promise<void>((resolve, reject) => {
      child_process.execFile('docker', args, { timeout: 15_000 }, (err, stdout, stderr) => {
        if (err) {
          this.outputChannel.appendLine(`[studio] start error: ${stderr}`);
          reject(new Error(`Failed to start container: ${stderr || err.message}`));
        } else {
          this.outputChannel.appendLine(`[studio] Container started: ${stdout.trim()}`);
          resolve();
        }
      });
    });
  }

  /** Stop (and remove) the container. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.outputChannel.appendLine('[studio] Stopping container');
      child_process.exec(`docker rm -f ${CONTAINER}`, { timeout: 10_000 }, () => resolve());
    });
  }

  /**
   * Poll the health endpoint until it responds ok or timeout expires.
   * Returns true when healthy, false on timeout.
   */
  async waitUntilHealthy(
    timeoutMs = 30_000,
    intervalMs = 1_000,
  ): Promise<boolean> {
    const url = `${StudioManager.studioUrl()}/health`;
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

  /**
   * Ensure the local studio API is running.
   * Shows progress UI and handles image pulling if needed.
   * Returns the local URL if successful, or undefined on failure.
   */
  async ensureRunning(): Promise<string | undefined> {
    if (!(await this.isDockerAvailable())) {
      void vscode.window.showErrorMessage(
        'Docker is required for the local Cantica Studio. Install Docker Desktop and try again.',
        'Get Docker',
      ).then((choice) => {
        if (choice === 'Get Docker') {
          void vscode.env.openExternal(vscode.Uri.parse('https://www.docker.com/products/docker-desktop/'));
        }
      });
      return undefined;
    }

    if (await this.isRunning()) {
      return StudioManager.studioUrl();
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Cantica Studio',
        cancellable: false,
      },
      async (progress) => {
        try {
          if (!(await this.imageExists())) {
            await this.pullImage(progress);
          }
          await this.start(progress);
          progress.report({ message: 'Waiting for API to become ready…' });
          const healthy = await this.waitUntilHealthy();
          if (!healthy) {
            this.outputChannel.show(true);
            void vscode.window.showErrorMessage(
              'Cantica Studio API did not become healthy in time. See Output panel.',
            );
            return undefined;
          }
          return StudioManager.studioUrl();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.outputChannel.appendLine(`[studio] Error: ${message}`);
          this.outputChannel.show(true);
          void vscode.window.showErrorMessage(`Cantica Studio: ${message}`);
          return undefined;
        }
      },
    );
  }
}
