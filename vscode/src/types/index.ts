export interface CanticaPrompt {
  name: string;
  namespace: string;
  description?: string;
  tags?: string[];
  created_at?: string;
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

/** Messages sent FROM the extension TO the webview. */
export type WebviewMessage =
  | { type: 'updateAgents'; namespaces: CanticaNamespace[]; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'error'; message: string };

/** Messages sent FROM the webview TO the extension. */
export type ExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openPrompt'; namespace: string; name: string }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' }
  | { type: 'saveWorkflow'; workflow: unknown };
