/**
 * Studio setup state helpers.
 *
 * The setup flow itself runs as a modal form inside the panel webview
 * (SetupModal / ProviderKeysModal in clients/shared/webview-src) — the host
 * side lives in actors-panel.ts (`saveSetup` / `saveProviderKey` handlers).
 * This module only tracks whether the one-time setup has been completed.
 */

import * as vscode from 'vscode';

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
