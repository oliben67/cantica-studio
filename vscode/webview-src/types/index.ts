// ── Domain types (mirror of src/types/index.ts for the webview bundle) ────────

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
  name?: string;       // human-readable label; falls back to schedule in the UI
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
  dynamic?: boolean;
  sharedWith?: string[];
}

export type ActorType = 'ai' | 'python' | 'typescript';

export interface AIActorDef {
  id: string;
  name: string;
  actorType: ActorType;     // 'ai' (default) | 'python' | 'typescript'
  scriptPath?: string;      // code actors: path to the script
  scriptCommand?: string;   // code actors: runtime override (e.g. 'bun', 'ts-node')
  directory?: string;       // optional working directory exposed via MCP filesystem
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
  from: string;
  to: string;
  targetEvent?: string;
  prompt: PromptRef;
  label: string;
  kind?: 'event' | 'cron';
}

export type HandleSide = 'left' | 'right' | 'top' | 'bottom';

/** Slim descriptor of one edge that a node needs to render its handle. */
export interface EdgeHandleInfo {
  id: string;
  label: string;
  kind?: 'event' | 'cron';
  isSelf: boolean;
  side: HandleSide;   // which side of this node the handle sits on
}

export interface ActorGraph {
  id: string;
  name: string;
  actors: AIActorDef[];
  edges: ActorEdgeDef[];
}

export interface CanticaPrompt {
  name: string;
  namespace: string;
  description?: string;
  tags?: string[];
  _server?: string;
}

export interface ExtensionSettings {
  servers: { url: string; authToken: string }[];
  serverUrl: string;
  authToken: string;
  explorerSide: 'left' | 'right';
  canticaHome: string;
  studioPort: number;
  autoStartStudio: boolean;
  /** Per-provider model constraints. null = open; [] = disabled; [..] = allowlist. */
  providerModels: Record<string, string[] | null>;
}

/** Messages arriving FROM the extension host into the webview. */
export type IncomingMessage =
  | { type: 'loadGraph'; graph: ActorGraph }
  | { type: 'updatePrompts'; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'actorStatus'; name: string; running: boolean }
  | { type: 'actorPaused'; name: string; paused: boolean }
  | { type: 'actorOutput'; name: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'deleteSelected' }
  | { type: 'resetGraph' }
  | { type: 'triggerSave' };

/** Messages sent FROM the webview TO the extension host. */
export type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'saveGraph'; graph: ActorGraph }
  | { type: 'addActor' }
  | { type: 'runActor'; name: string; instruction: string }
  | { type: 'fireEvent'; name: string; eventName: string; context: string }
  | { type: 'stopActor'; name: string }
  | { type: 'pauseActor'; name: string }
  | { type: 'resumeActor'; name: string }
  | { type: 'refreshPrompts' }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' }
  | { type: 'configureServer' }
  | { type: 'startLocalStudio' }
  | { type: 'stopLocalStudio' }
  | { type: 'playSongbook' }
  | { type: 'stopSongbook' };

export interface VscodeApi {
  postMessage: (message: OutgoingMessage) => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}
