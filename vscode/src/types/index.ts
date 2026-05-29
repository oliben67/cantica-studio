// ── Shared domain types ───────────────────────────────────────────────────────

export interface PromptRef {
  uri?: string;
  content?: string;
}

export interface PromptEventDef {
  name: string;
  prompt: PromptRef;
  filePattern?: string;
}

export interface CronJobDef {
  schedule: string;
  prompt: PromptRef;
}

export interface AIActorDef {
  id: string;            // urn:cantica:studio:actor:{uuid}
  name: string;
  definePrompt: PromptRef;
  provider: string;      // "claude" | "gpt" | "gemini"
  model: string;
  maxTokens: number;
  maxHistory: number;
  position: { x: number; y: number };
  promptEvents: PromptEventDef[];
  cronJobs: CronJobDef[];
}

export interface ActorEdgeDef {
  id: string;
  from: string;          // actor id
  to: string;            // actor id
  targetEvent?: string;  // fires named event on target; undefined = default inbox
  prompt: PromptRef;
  label: string;
}

export interface ActorGraph {
  id: string;
  name: string;
  actors: AIActorDef[];
  edges: ActorEdgeDef[];
}

// ── Multi-server configuration ────────────────────────────────────────────────

export interface CanticaServer {
  url: string;
  authToken: string;
}

export interface CanticaPrompt {
  name: string;
  namespace: string;
  description?: string;
  tags?: string[];
  _server?: string;
}

// Legacy — kept so agents-provider.ts compiles unchanged
export interface CanticaNamespace {
  name: string;
  description?: string;
  is_proprietary?: boolean;
}

// ── Extension settings ────────────────────────────────────────────────────────

export interface ExtensionSettings {
  servers: CanticaServer[];
  serverUrl: string;
  authToken: string;
  explorerSide: 'left' | 'right';
  canticaHome: string;
  studioPort: number;
  autoStartStudio: boolean;
  graphFile: string;
}

// ── Webview message protocol ──────────────────────────────────────────────────

/** Messages sent FROM the extension host TO the webview. */
export type ToWebview =
  | { type: 'loadGraph'; graph: ActorGraph }
  | { type: 'updatePrompts'; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'actorStatus'; name: string; running: boolean }
  | { type: 'actorOutput'; name: string; output: string }
  | { type: 'error'; message: string };

/** Messages sent FROM the webview TO the extension host. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'saveGraph'; graph: ActorGraph }
  | { type: 'addActor' }
  | { type: 'runActor'; name: string; instruction: string }
  | { type: 'fireEvent'; name: string; eventName: string; context: string }
  | { type: 'stopActor'; name: string }
  | { type: 'refreshPrompts' }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' };

// Legacy alias so agents-panel.ts type annotation still resolves
export type WebviewMessage = ToWebview;
