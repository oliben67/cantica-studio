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
  sendResponse?: boolean;    // true = fire this actor first, forward response; false (default) = send prompt directly
}

export interface CronJobDef {
  name?: string;
  schedule: string;
  prompt: PromptRef;
  targetActor?: string;
  targetEvent?: string;
  sendResponse?: boolean;  // true = fire this actor first, forward response; false (default) = send prompt directly
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
  /** True when an AIActor's provider/model fields no longer match the hash encoded in its id. */
  corrupted?: boolean;
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
  studioMode: 'local' | 'remote';
  /** How to start the Studio API locally: native CLI or Docker container. */
  studioRunMode: 'native' | 'container';
  studioBaseUrl: string;
  studioPort: number;
  autoStartStudio: boolean;
}

// ── API call log ──────────────────────────────────────────────────────────────

export interface LogEntry {
  ts: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
}

export interface McpLogEntry {
  ts: number;
  tool: string;
  durationMs: number;
  status: 'ok' | 'error';
  args: Record<string, string>;
}

// ── Songbook tree (for Electron primary sidebar) ──────────────────────────────

export interface SongbookFileEntry {
  type: 'file';
  name: string;
  path: string;
}

export interface SongbookFolderEntry {
  type: 'folder';
  name: string;
  path: string;
  children: SongbookEntry[];
}

export type SongbookEntry = SongbookFileEntry | SongbookFolderEntry;

// ── Webview message protocol ──────────────────────────────────────────────────

/** Messages sent FROM the extension host TO the webview. */
export type ToWebview =
  | { type: 'loadGraph'; graph: ActorGraph }
  | { type: 'updatePrompts'; prompts: CanticaPrompt[] }
  | { type: 'updateSettings'; settings: ExtensionSettings }
  | { type: 'providerModels'; models: Record<string, string[]> }
  | { type: 'actorStatus'; name: string; running: boolean }
  | { type: 'actorPaused'; name: string; paused: boolean }
  | { type: 'actorOutput'; name: string; output: string }
  | { type: 'actorModelResolved'; name: string; model: string }
  | { type: 'apiLog'; entry: LogEntry }
  | { type: 'mcpLog'; entry: McpLogEntry }
  | { type: 'error'; message: string }
  | { type: 'deleteSelected' }
  | { type: 'resetGraph' }
  | { type: 'triggerSave' }
  | { type: 'updateSongbooks'; entries: SongbookEntry[]; activeFile: string | null }
  | { type: 'studioStatus'; health: 'healthy' | 'starting' | 'down'; url: string; version?: string; uptimeSeconds?: number; workspace?: string; containerized?: boolean }
  | { type: 'studioMode'; mode: 'native' | 'container' };

/** Messages sent FROM the webview TO the extension host. */
export type FromWebview =
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
  | { type: 'stopSongbook' }
  | { type: 'openSongbook'; path: string }
  | { type: 'refreshSongbooks' }
  | { type: 'setStudioMode'; mode: 'native' | 'container' };

// Legacy alias so agents-panel.ts type annotation still resolves
export type WebviewMessage = ToWebview;
