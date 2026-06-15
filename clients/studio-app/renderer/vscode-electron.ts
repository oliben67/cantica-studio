interface VscodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    __canticaBridge: { postMessage(msg: unknown): void };
  }
}

// Mirrors the shape of acquireVsCodeApi() so all existing callers work.
export const vscode: VscodeApi = {
  postMessage: (msg) => window.__canticaBridge.postMessage(msg),
  getState: () => undefined,
  setState: () => undefined,
};
