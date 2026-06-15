import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Credentials } from '../shared/auth-core.js';

function _credDir(app: Electron.App): string {
  const dir = join(app.getPath('userData'), 'cantica');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Fall back to a plain JSON file when the system keyring isn't available.
export function saveCredentials(app: Electron.App, creds: Credentials): void {
  const dir = _credDir(app);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(JSON.stringify(creds));
    writeFileSync(join(dir, 'credentials.enc'), enc);
  } else {
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify(creds, null, 2), 'utf-8');
  }
}

export function loadCredentials(app: Electron.App): Credentials | null {
  const dir = _credDir(app);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const p = join(dir, 'credentials.enc');
      if (!existsSync(p)) return null;
      return JSON.parse(safeStorage.decryptString(readFileSync(p))) as Credentials;
    } else {
      const p = join(dir, 'credentials.json');
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf-8')) as Credentials;
    }
  } catch {
    return null;
  }
}

export function clearCredentials(app: Electron.App): void {
  const dir = _credDir(app);
  for (const name of ['credentials.enc', 'credentials.json']) {
    const p = join(dir, name);
    if (existsSync(p)) writeFileSync(p, '');
  }
}
