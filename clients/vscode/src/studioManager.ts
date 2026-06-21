import * as vscode from 'vscode';
import { StudioManager as SharedStudioManager } from '../../shared/studioManager.js';
import type { Platform } from '../../shared/platform.js';
import type { ProviderApiKeys, StudioMode } from '../../shared/studioManager.js';

export type { ProviderApiKeys, StudioMode };

export type { Platform } from '../../shared/platform.js';

/**
 * VSCode implementation of the Platform interface.
 * Bridges shared StudioManager logic to VSCode APIs.
 */
export class VscodePlatform implements Platform, vscode.Disposable {
  readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Cantica Studio');
  }

  log(message: string): void {
    this.outputChannel.appendLine(message);
  }

  async showError(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...actions);
  }

  async withProgress<T>(
    title: string,
    task: (report: (message: string) => void) => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      (progress) => task((message) => progress.report({ message })),
    );
  }

  getConfig<T>(section: string, key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(section).get<T>(key) ?? defaultValue;
  }

  openExternal(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}

/**
 * VSCode-flavoured StudioManager — wraps the shared implementation and
 * auto-creates a VscodePlatform so existing callers can do `new StudioManager()`
 * without any changes.
 *
 * Also re-exposes the static helpers with the VSCode platform pre-wired, in
 * case other callers use them.
 */
export class StudioManager implements vscode.Disposable {
  private readonly _platform: VscodePlatform;
  private readonly _shared: SharedStudioManager;

  constructor() {
    this._platform = new VscodePlatform();
    this._shared = new SharedStudioManager(this._platform);
  }

  static canticaHome(): string {
    return SharedStudioManager.canticaHome(new VscodePlatform());
  }

  static studioPort(): number {
    return SharedStudioManager.studioPort(new VscodePlatform());
  }

  static studioUrl(): string {
    return SharedStudioManager.studioUrl(new VscodePlatform());
  }

  async isDockerAvailable(): Promise<boolean> {
    return this._shared.isDockerAvailable();
  }

  isNativeRunning(): boolean {
    return this._shared.isNativeRunning();
  }

  async isRunning(): Promise<boolean> {
    return this._shared.isRunning();
  }

  async imageExists(): Promise<boolean> {
    return this._shared.imageExists();
  }

  async stop(mode?: StudioMode): Promise<void> {
    return this._shared.stop(mode);
  }

  async waitUntilHealthy(timeoutMs?: number, intervalMs?: number): Promise<boolean> {
    return this._shared.waitUntilHealthy(timeoutMs, intervalMs);
  }

  async ensureRunning(mode: StudioMode = 'container', keys?: ProviderApiKeys): Promise<string | undefined> {
    return this._shared.ensureRunning(mode, keys);
  }

  dispose(): void {
    this._platform.dispose();
  }
}
