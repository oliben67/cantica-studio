import '@testing-library/jest-dom';

// Stub the VS Code webview API used by the webview bundle
(globalThis as unknown as Record<string, unknown>)['acquireVsCodeApi'] = () => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

// Suppress ReactFlow "ResizeObserver not found" warnings in jsdom
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
