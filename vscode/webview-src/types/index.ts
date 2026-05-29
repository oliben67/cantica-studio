// ── Domain types (mirror of src/types/index.ts for the webview bundle) ────────

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
  id: string;
  name: string;
  definePrompt: PromptRef;
  provider: string;
  model: string;
  maxTokens: number;
  maxHistory: number;
  position: { x: number; y: number };
  promptEvents: PromptEventDef[];
  cronJobs: CronJobDef[];
}

export interface ActorEdgeDef {
  id: string;
  from: string;
  to: string;
  targetEvent?: string;
  prompt: PromptRef;
  label: string;
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
  graphFile: string;
}

/** Messages arriving FROM the extension host into the webview. */
export type IncomingMessage =
  | { type: 'loadGraph'; graph: ActorGraph }
  | { type: 'updatePrompts'; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'actorStatus'; name: string; running: boolean }
  | { type: 'actorOutput'; name: string; output: string }
  | { type: 'error'; message: string };

/** Messages sent FROM the webview TO the extension host. */
export type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'saveGraph'; graph: ActorGraph }
  | { type: 'addActor' }
  | { type: 'runActor'; name: string; instruction: string }
  | { type: 'fireEvent'; name: string; eventName: string; context: string }
  | { type: 'stopActor'; name: string }
  | { type: 'refreshPrompts' }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' };

export interface VscodeApi {
  postMessage: (message: OutgoingMessage) => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}
