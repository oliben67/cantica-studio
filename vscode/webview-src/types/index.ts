export interface CanticaPrompt {
  name: string;
  namespace: string;
  description?: string;
  tags?: string[];
}

export interface CanticaNamespace {
  name: string;
  description?: string;
  is_proprietary?: boolean;
}

export interface ExtensionSettings {
  serverUrl: string;
  authToken: string;
  explorerSide: 'left' | 'right';
}

/** Messages arriving FROM the extension host into the webview. */
export type IncomingMessage =
  | { type: 'updateAgents'; namespaces: CanticaNamespace[]; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'error'; message: string };

/** Messages sent FROM the webview TO the extension host. */
export type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openPrompt'; namespace: string; name: string }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' }
  | { type: 'saveWorkflow'; workflow: unknown };

export interface VscodeApi {
  postMessage: (message: OutgoingMessage) => void;
  getState: <T>() => T;
  setState: <T>(state: T) => void;
}
