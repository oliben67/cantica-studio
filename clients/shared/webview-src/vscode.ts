import type { VscodeApi } from './types';

declare function acquireVsCodeApi(): VscodeApi;

// VS Code only allows acquireVsCodeApi() to be called once per webview.
export const vscode: VscodeApi = acquireVsCodeApi();
