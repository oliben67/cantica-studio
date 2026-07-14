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
  sendResponse?: boolean;    // true = fire this actor first, forward response; false (default) = send prompt directly
}

export interface CronJobDef {
  name?: string;       // human-readable label; falls back to schedule in the UI
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
  /** Per-provider model allowlists: missing/undefined → default list,
   *  null → open (default list shown), [] → provider hidden, [names] → only these. */
  providerModels?: Record<string, string[] | null>;
}


// ── Admin (remote mode): users, flags, directory mappings ─────────────────────

export interface AdminUserFlag {
  id: string;
  flag: string;
  comment: string;
  created_by: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  e_user_id: string | null;
  roles: string[];
  flags: AdminUserFlag[];
  created_at: string;
  updated_at: string;
}

export interface AdminMapping {
  id: string;
  external_group: string;
  role: string;
  created_at: string;
}

export interface AdminData {
  users: AdminUser[];
  roles: string[];
  mappings: AdminMapping[];
}

// ── Setup & provider keys ─────────────────────────────────────────────────────

export type ProviderKeyId = 'anthropicApiKey' | 'openaiApiKey' | 'geminiApiKey' | 'githubToken';

/** Where a provider key currently comes from. Key material itself never
 *  crosses into the webview — only this presence status. */
export type ProviderKeyStatus = 'env' | 'stored' | 'none';

export interface SetupState {
  mode: 'local' | 'remote';
  runMode: 'native' | 'container';
  remoteUrl: string;
  setupDone: boolean;
  keys: Record<ProviderKeyId, ProviderKeyStatus>;
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

/** Messages arriving FROM the extension host into the webview. */
export type IncomingMessage =
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
  | { type: 'studioStatus'; health: 'healthy' | 'starting' | 'down'; url: string; version?: string; uptimeSeconds?: number; workspace?: string; containerized?: boolean }
  | { type: 'updateSongbooks'; entries: unknown[]; activeFile: string | null; openFiles?: string[] }
  | { type: 'activeSongbookChanged'; path: string | null }
  | { type: 'studioMode'; mode: 'native' | 'container' }
  | { type: 'setupState'; state: SetupState }
  | { type: 'openSetup' }
  | { type: 'openProviderKeys' }
  | { type: 'adminData'; data: AdminData }
  | { type: 'serverWarning'; text: string };

/** Messages sent FROM the webview TO the extension host. */
export type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'saveGraph'; graph: ActorGraph; path?: string }
  | { type: 'addActor' }
  | { type: 'runActor'; name: string; instruction: string }
  | { type: 'fireEvent'; name: string; eventName: string; context: string }
  | { type: 'stopActor'; name: string }
  | { type: 'refreshActor'; name: string }
  | { type: 'pauseActor'; name: string }
  | { type: 'resumeActor'; name: string }
  | { type: 'refreshPrompts' }
  | { type: 'explorerSideChanged'; side: 'left' | 'right' }
  | { type: 'configureServer' }
  | { type: 'startLocalStudio' }
  | { type: 'stopLocalStudio' }
  | { type: 'playSongbook' }
  | { type: 'stopSongbook' }
  | { type: 'openSongbook'; uri?: string; content?: unknown }
  | { type: 'switchSongbook'; path: string }
  | { type: 'closeSongbook'; path: string }
  | { type: 'requestSetupState' }
  | { type: 'saveSetup'; mode: 'local' | 'remote'; runMode: 'native' | 'container'; remoteUrl?: string }
  | { type: 'saveProviderKey'; provider: ProviderKeyId; key: string }
  | { type: 'clearProviderKey'; provider: ProviderKeyId }
  | { type: 'requestAdminData' }
  | { type: 'activateUser'; userId: string }
  | { type: 'addUserFlag'; userId: string; flag: string; comment?: string }
  | { type: 'removeUserFlag'; userId: string; flagId: string }
  | { type: 'addDirectoryMapping'; externalGroup: string; roleName: string }
  | { type: 'removeDirectoryMapping'; mappingId: string };

/** A single entry drained from the server's runtime notification log. */
export type Notification =
  | { type?: undefined; name: string; prompt: string; output: string }
  | { type: 'actorModelResolved'; name: string; model: string };

export interface VscodeApi {
  postMessage: (message: OutgoingMessage) => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}
