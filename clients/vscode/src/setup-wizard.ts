/**
 * First-time Studio setup wizard.
 *
 * Guides the user through:
 *   1. Local vs Remote mode
 *   2. Native (CLI) vs Container (Docker) for local mode
 *   3. Provider API keys (skipped for any already present in host env or SecretStorage)
 *
 * Saves choices to VS Code settings and API keys to SecretStorage.
 * Marks setup complete in globalState so the wizard only auto-runs once.
 */

import * as vscode from 'vscode';
import type { ProviderApiKeys } from '../../shared/studioManager.js';
import { loadProviderKeys, saveProviderKeys } from './provider-keys.js';

export const SETUP_DONE_KEY = 'cantica.studioSetupDone';

/** True if the one-time setup has already been completed. */
export function isSetupDone(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(SETUP_DONE_KEY, false);
}

/** Push the setup-done state as a VS Code context key (for when-clause use in package.json). */
export function publishSetupContext(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand('setContext', SETUP_DONE_KEY, isSetupDone(context));
}

/** Allow re-running the wizard (e.g. from a "Reconfigure" command). */
export async function resetSetup(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SETUP_DONE_KEY, false);
  publishSetupContext(context);
}

// ── Provider key prompts ──────────────────────────────────────────────────────

const PROVIDERS: {
  label: string;
  envKey: string;
  field: keyof ProviderApiKeys;
  placeholder: string;
}[] = [
  { label: 'Anthropic API Key', envKey: 'ANTHROPIC_API_KEY', field: 'anthropicApiKey', placeholder: 'sk-ant-...' },
  { label: 'OpenAI API Key',    envKey: 'OPENAI_API_KEY',    field: 'openaiApiKey',    placeholder: 'sk-...' },
  { label: 'Google Gemini Key', envKey: 'GEMINI_API_KEY',    field: 'geminiApiKey',    placeholder: 'AIza...' },
  { label: 'GitHub Token',      envKey: 'GITHUB_TOKEN',      field: 'githubToken',     placeholder: 'ghp_...' },
];

// ── Per-provider key configuration ───────────────────────────────────────────

/**
 * Show a QuickPick of all providers, let the user pick one, then prompt for
 * a new API key. Saves to SecretStorage. Returns the updated keys or null if cancelled.
 */
export async function configureProviderKeys(
  context: vscode.ExtensionContext,
): Promise<ProviderApiKeys | null> {
  const keys = await loadProviderKeys(context.secrets);

  const picks = PROVIDERS.map(p => {
    const hasEnv = !!process.env[p.envKey]?.trim();
    const hasKey = !!(hasEnv || keys[p.field]?.trim());
    return {
      label: p.label,
      description: hasEnv ? 'from environment variable' : hasKey ? 'key stored' : 'not configured',
      iconPath: new vscode.ThemeIcon(hasKey ? 'check' : 'circle-outline'),
      _provider: p,
    };
  });

  const chosen = await vscode.window.showQuickPick(picks, {
    title: 'Configure Provider API Keys',
    placeHolder: 'Select a provider to configure',
    ignoreFocusOut: true,
  });

  if (!chosen) return null;

  const p = chosen._provider;
  const hasExisting = !!keys[p.field]?.trim();

  const value = await vscode.window.showInputBox({
    title: `Configure ${p.label}`,
    prompt: hasExisting
      ? 'Enter new key to replace, or leave blank to clear the stored key'
      : 'Enter API key, or leave blank to skip',
    placeHolder: p.placeholder,
    password: true,
    ignoreFocusOut: true,
  });

  if (value === undefined) return null; // Escape — cancelled

  (keys as Record<string, string>)[p.field] = value.trim();
  await saveProviderKeys(context.secrets, keys);
  return keys;
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export type SetupResult =
  | { mode: 'local'; runMode: 'native' | 'container'; keys: ProviderApiKeys }
  | { mode: 'remote' }
  | null; // user cancelled

/**
 * Run the first-time setup wizard.
 * Returns the result so the caller can act on it (start server, etc.).
 * Returns null if the user cancels at any step.
 */
export async function runSetupWizard(context: vscode.ExtensionContext): Promise<SetupResult> {
  // ── Step 1: Local or Remote ──────────────────────────────────────────────

  const modeChoice = await vscode.window.showQuickPick(
    [
      {
        label: '$(device-desktop)  Local',
        description: 'Run Studio API on this machine',
        detail: 'The extension manages the server process. API keys stay on your machine.',
        value: 'local' as const,
      },
      {
        label: '$(globe)  Remote',
        description: 'Connect to an existing Studio API server',
        detail: 'Provide a server URL. Remote setup support is coming soon.',
        value: 'remote' as const,
      },
    ],
    {
      title: 'Cantica Studio — Setup (1 of 3)',
      placeHolder: 'How will you run the Studio API?',
      ignoreFocusOut: true,
    },
  );

  if (!modeChoice) return null;

  if (modeChoice.value === 'remote') {
    void vscode.window.showInformationMessage(
      'Remote Studio setup is coming soon. For now, please use Local mode.',
    );
    return { mode: 'remote' };
  }

  // ── Step 2: Native or Container ──────────────────────────────────────────

  const runChoice = await vscode.window.showQuickPick(
    [
      {
        label: '$(terminal)  Native',
        description: 'Uses the "studio" CLI installed via pip',
        detail: 'Fastest startup. Requires: pip install cantica-studio-api',
        value: 'native' as const,
      },
      {
        label: '$(package)  Container',
        description: 'Runs in Docker',
        detail: 'Isolated environment. Requires: Docker Desktop',
        value: 'container' as const,
      },
    ],
    {
      title: 'Cantica Studio — Setup (2 of 3)',
      placeHolder: 'How should the Studio API run?',
      ignoreFocusOut: true,
    },
  );

  if (!runChoice) return null;

  // ── Step 3: Provider API keys ─────────────────────────────────────────────

  const keys = await loadProviderKeys(context.secrets);
  let anyPrompted = false;

  for (const p of PROVIDERS) {
    // Skip if already available in host env or SecretStorage.
    if (process.env[p.envKey]?.trim() || keys[p.field]?.trim()) continue;

    anyPrompted = true;
    const value = await vscode.window.showInputBox({
      title: `Cantica Studio — Setup (3 of 3): API Keys`,
      prompt: `${p.label} — press Enter to skip`,
      placeHolder: p.placeholder,
      password: true,
      ignoreFocusOut: true,
    });

    if (value === undefined) return null; // cancelled (Escape)
    if (value.trim()) (keys as Record<string, string>)[p.field] = value.trim();
  }

  // Show a completion message if all keys were already present.
  if (!anyPrompted) {
    void vscode.window.showInformationMessage(
      'All provider keys are already configured via environment variables or stored credentials.',
    );
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  await saveProviderKeys(context.secrets, keys);

  const cfg = vscode.workspace.getConfiguration('canticaScores');
  await cfg.update('studioMode', 'local', vscode.ConfigurationTarget.Global);
  await cfg.update('studioRunMode', runChoice.value, vscode.ConfigurationTarget.Global);

  await context.globalState.update(SETUP_DONE_KEY, true);
  publishSetupContext(context);

  return { mode: 'local', runMode: runChoice.value, keys };
}
