// ── Shared domain types ───────────────────────────────────────────────────────

export interface PromptRef {
  uri?: string;
  content?: string;
}

export interface PromptEventDef {
  name: string;
  prompt: PromptRef;
  filePattern?: string;
  targetActors?: string[];   // empty = self; multiple = broadcast
}

export interface CronJobDef {
  name?: string;
  schedule: string;
  prompt: PromptRef;
  targetActor?: string;
  targetEvent?: string;
}

export interface AgentResource {
  id: string;
  name: string;
  type: 'file' | 'api' | 'text' | 'other';
  uri: string;
  description?: string;
  dynamic?: boolean;       // true = created at runtime
  sharedWith?: string[];   // actor names this resource is shared with
}

export type ActorType = 'ai' | 'python' | 'typescript';

export interface AIActorDef {
  id: string;
  name: string;
  actorType: ActorType;
  scriptPath?: string;
  scriptCommand?: string;
  directory?: string;
  definePrompt: PromptRef;
  provider: string;
  model: string;
  maxTokens: number;
  maxHistory: number;
  position: { x: number; y: number };
  promptEvents: PromptEventDef[];
  cronJobs: CronJobDef[];
  resources: AgentResource[];
}

export interface ActorEdgeDef {
  id: string;
  from: string;          // actor id
  to: string;            // actor id
  targetEvent?: string;  // fires named event on target; undefined = default inbox
  prompt: PromptRef;
  label: string;
  kind?: 'event' | 'cron';
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
  /** Per-provider model constraints. null = open; [] = disabled; [..] = allowlist. */
  providerModels: Record<string, string[] | null>;
}

// ── Webview message protocol ──────────────────────────────────────────────────

/** Messages sent FROM the extension host TO the webview. */
export type ToWebview =
  | { type: 'loadGraph'; graph: ActorGraph }
  | { type: 'updatePrompts'; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'actorStatus'; name: string; running: boolean }
  | { type: 'actorOutput'; name: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'deleteSelected' }
  | { type: 'resetGraph' }
  | { type: 'triggerSave' };

/** Messages sent FROM the webview TO the extension host. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'saveGraph'; graph: ActorGraph }
  | { type: 'addActor' }
  | { type: 'runActor'; name: string; instruction: string }
  | { type: 'fireEvent'; name: string; eventName: string; context: string }
  | { type: 'stopActor'; name: string }
  | { type: 'refreshPrompts' }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' }
  | { type: 'configureServer' }
  | { type: 'startLocalStudio' }
  | { type: 'stopLocalStudio' }
  | { type: 'playSongbook' }
  | { type: 'stopSongbook' };

// Legacy alias so agents-panel.ts type annotation still resolves
export type WebviewMessage = ToWebview;
