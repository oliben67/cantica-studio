import type * as vscode from 'vscode';
import type { ProviderApiKeys } from '../../shared/studioManager.js';

const SECRET_KEY = 'cantica.providerKeys';

/** Load provider API keys from VS Code SecretStorage. Missing keys are empty strings. */
export async function loadProviderKeys(secrets: vscode.SecretStorage): Promise<ProviderApiKeys> {
  const raw = await secrets.get(SECRET_KEY);
  const stored = raw ? (JSON.parse(raw) as Partial<ProviderApiKeys>) : {};
  return {
    anthropicApiKey: stored.anthropicApiKey ?? '',
    openaiApiKey: stored.openaiApiKey ?? '',
    geminiApiKey: stored.geminiApiKey ?? '',
    githubToken: stored.githubToken ?? '',
  };
}

/** Persist provider API keys into VS Code SecretStorage. */
export async function saveProviderKeys(
  secrets: vscode.SecretStorage,
  keys: ProviderApiKeys,
): Promise<void> {
  await secrets.store(SECRET_KEY, JSON.stringify(keys));
}
