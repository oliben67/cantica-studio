import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderApiKeys } from '../shared/studioManager.js';

function _keyDir(app: Electron.App): string {
  const dir = join(app.getPath('userData'), 'cantica');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const EMPTY: ProviderApiKeys = {
  anthropicApiKey: '',
  openaiApiKey: '',
  geminiApiKey: '',
  githubToken: '',
};

/** Load provider API keys. Missing keys are empty strings. */
export function loadProviderKeys(app: Electron.App): ProviderApiKeys {
  const dir = _keyDir(app);
  try {
    let raw: string | null = null;
    if (safeStorage.isEncryptionAvailable()) {
      const p = join(dir, 'provider-keys.enc');
      if (existsSync(p)) raw = safeStorage.decryptString(readFileSync(p));
    } else {
      const p = join(dir, 'provider-keys.json');
      if (existsSync(p)) raw = readFileSync(p, 'utf-8');
    }
    if (!raw) return { ...EMPTY };
    const stored = JSON.parse(raw) as Partial<ProviderApiKeys>;
    return { ...EMPTY, ...stored };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist provider API keys — encrypted via safeStorage when available,
 *  plain JSON otherwise (mirrors auth-store's credential fallback). */
export function saveProviderKeys(app: Electron.App, keys: ProviderApiKeys): void {
  const dir = _keyDir(app);
  const json = JSON.stringify(keys);
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(join(dir, 'provider-keys.enc'), safeStorage.encryptString(json));
  } else {
    writeFileSync(join(dir, 'provider-keys.json'), json, 'utf-8');
  }
}
