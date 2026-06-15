import type * as vscode from 'vscode';
import type { Credentials } from '../../shared/auth-core.js';

// Re-export shared crypto utilities so existing callers that import from './auth.js' still work.
export type { Credentials } from '../../shared/auth-core.js';
export { generateKeyPair, publicKeyFromPrivate, createAssertion, makeCachedAssertion } from '../../shared/auth-core.js';

// ── VSCode-specific SecretStorage helpers ─────────────────────────────────────

const _SECRET_PRIVATE_KEY = 'cantica.client.privateKey';
const _SECRET_CLIENT_ID = 'cantica.client.clientId';

export async function loadCredentials(secrets: vscode.SecretStorage): Promise<Credentials | null> {
  const [privateKeyPem, clientId] = await Promise.all([
    secrets.get(_SECRET_PRIVATE_KEY),
    secrets.get(_SECRET_CLIENT_ID),
  ]);
  if (!privateKeyPem || !clientId) return null;
  return { clientId, privateKeyPem };
}

export async function saveCredentials(secrets: vscode.SecretStorage, creds: Credentials): Promise<void> {
  await Promise.all([
    secrets.store(_SECRET_PRIVATE_KEY, creds.privateKeyPem),
    secrets.store(_SECRET_CLIENT_ID, creds.clientId),
  ]);
}

export async function clearCredentials(secrets: vscode.SecretStorage): Promise<void> {
  await Promise.all([secrets.delete(_SECRET_PRIVATE_KEY), secrets.delete(_SECRET_CLIENT_ID)]);
}
