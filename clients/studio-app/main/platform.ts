import { app, BrowserWindow, dialog, shell } from 'electron';
import type { Platform } from '../shared/platform.js';

export class ElectronPlatform implements Platform {
  private readonly _win: () => BrowserWindow | null;

  constructor(win: () => BrowserWindow | null) {
    this._win = win;
  }

  log(message: string): void {
    console.log(`[studio] ${message}`);
  }

  async showError(message: string, ...actions: string[]): Promise<string | undefined> {
    const win = this._win();
    const result = await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
      type: 'error',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions[result.response];
  }

  async withProgress<T>(
    title: string,
    task: (report: (message: string) => void) => Promise<T>,
  ): Promise<T> {
    this.log(title);
    return task((msg) => this.log(msg));
  }

  getConfig<T>(section: string, key: string, defaultValue: T): T {
    // In Electron, config comes from electron-store or env; start with env/defaults
    const envKey = `CANTICA_${key.toUpperCase().replace(/\./g, '_')}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) return envVal as unknown as T;
    return defaultValue;
  }

  openExternal(url: string): void {
    void shell.openExternal(url);
  }
}
