import { create } from 'zustand';
import type { AdminData, AIActorDef, ActorEdgeDef, ActorGraph, CanticaPrompt, ExtensionSettings, LogEntry, McpLogEntry, SetupState } from './types';

let _idSeq = 0;

/** DJB2 8-char hex hash of any string. */
function _h(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Compound actor ID: urn:cantica:studio:actor:{baseHash}:{nameHash}:{providerModelHash} */
function actorId(base: string, name: string, provider: string, model: string): string {
  return `urn:cantica:studio:actor:${_h(base)}:${_h(name)}:${_h(`${provider}:${model}`)}`;
}

function defaultActor(pos = { x: 100, y: 100 }): AIActorDef {
  const provider = 'claude';
  const model = 'claude-sonnet-4-6';
  const seq = ++_idSeq;
  const name = `actor-${seq}`;
  // Use timestamp+seq as the base hash — placeholder for file path when no file is loaded
  return {
    id: actorId(`${Date.now()}-${seq}`, name, provider, model),
    name,
    actorType: 'ai',
    definePrompt: {},
    provider,
    model,
    maxTokens: 4096,
    maxHistory: 10,
    position: pos,
    promptEvents: [],
    cronJobs: [],
    resources: [],
  };
}

function defaultCodeActor(type: 'python' | 'typescript', pos = { x: 100, y: 100 }): AIActorDef {
  const seq = ++_idSeq;
  return {
    id: `urn:cantica:studio:actor:code-${Date.now()}-${seq}`,
    name: `${type}-${seq}`,
    actorType: type,
    scriptPath: '',
    scriptCommand: '',
    definePrompt: {},
    provider: '',
    model: '',
    maxTokens: 0,
    maxHistory: 0,
    position: pos,
    promptEvents: [],
    cronJobs: [],
    resources: [],
  };
}

interface GraphState {
  graph: ActorGraph;
  /** True while the graph is being replaced by a server push — suppresses auto-save. */
  remoteLoad: boolean;
  selectedActorId: string | null;
  selectedEdgeId: string | null;
  runningActors: Set<string>;
  pausedActors: Set<string>;
  actorOutputs: Map<string, string>;
  prompts: CanticaPrompt[];
  settings: ExtensionSettings;
  explorerSide: 'left' | 'right';

  // Graph mutations
  setGraph: (graph: ActorGraph) => void;
  /** Load a graph pushed by the extension host — does NOT trigger auto-save. */
  loadGraphFromRemote: (graph: ActorGraph) => void;
  addActor: (pos?: { x: number; y: number }) => void;
  addCodeActor: (type: 'python' | 'typescript', pos?: { x: number; y: number }) => void;
  updateActor: (id: string, patch: Partial<AIActorDef>) => void;
  removeActor: (id: string) => void;
  addEdge: (edge: Omit<ActorEdgeDef, 'id'>) => void;
  updateEdge: (id: string, patch: Partial<ActorEdgeDef>) => void;
  removeEdge: (id: string) => void;
  replaceActorEdges: (actorId: string, edges: Omit<ActorEdgeDef, 'id'>[]) => void;
  updateActorPosition: (id: string, pos: { x: number; y: number }) => void;
  resetGraph: () => void;

  // Selection
  selectActor: (id: string | null) => void;
  selectEdge: (id: string | null) => void;

  // Runtime state
  setRunning: (name: string, running: boolean) => void;
  setPaused: (name: string, paused: boolean) => void;
  setOutput: (name: string, output: string) => void;
  appendOutput: (name: string, text: string) => void;
  resolvedModels: Record<string, string>;
  setResolvedModel: (name: string, model: string) => void;
  /** Actors whose resolve window expired — prompts unlocked despite no resolution. */
  resolveTimedOut: Record<string, boolean>;
  /** Flag a resolve timeout and post a one-shot warning to the actor's chat. */
  markResolveTimedOut: (name: string) => void;

  // Metadata
  setPrompts: (prompts: CanticaPrompt[]) => void;
  setSettings: (settings: ExtensionSettings) => void;
  setExplorerSide: (side: 'left' | 'right') => void;
  dynamicModels: Record<string, string[]>;
  setDynamicModels: (models: Record<string, string[]>) => void;

  // Modal UI state
  eventsModalActorId: string | null;
  eventsModalFocusLabel: string | null;  // event name to scroll to on open
  cronsModalActorId: string | null;
  cronsModalFocusLabel: string | null;   // cron schedule to scroll to on open
  openEventsModal: (actorId: string, focusLabel?: string) => void;
  closeEventsModal: () => void;
  openCronsModal: (actorId: string, focusLabel?: string) => void;
  closeCronsModal: () => void;

  providerMenuState: { actorId: string; x: number; y: number } | null;
  openProviderMenu: (actorId: string, x: number, y: number) => void;
  closeProviderMenu: () => void;

  actorMenuState: { actorId: string; x: number; y: number } | null;
  openActorMenu: (actorId: string, x: number, y: number) => void;
  closeActorMenu: () => void;

  edgeMenuState: { edgeId: string; x: number; y: number } | null;
  openEdgeMenu: (edgeId: string, x: number, y: number) => void;
  closeEdgeMenu: () => void;

  propertiesModalActorId: string | null;
  openPropertiesModal: (actorId: string) => void;
  closePropertiesModal: () => void;

  actorChatVisible: Record<string, boolean>;
  toggleChat: (actorId: string) => void;
  openChatIfHidden: (name: string) => void;

  chatModalActorId: string | null;
  openChatModal: (actorId: string) => void;
  closeChatModal: () => void;

  resourcesModalActorId: string | null;
  openResourcesModal: (actorId: string) => void;
  closeResourcesModal: () => void;

  minimapVisible: boolean;
  toggleMinimap: () => void;

  logEntries: LogEntry[];
  mcpLogEntries: McpLogEntry[];
  logVisible: boolean;
  appendLog: (entry: LogEntry) => void;
  appendMcpLog: (entry: McpLogEntry) => void;
  clearLog: () => void;
  toggleLog: () => void;

  studioHealth: 'healthy' | 'starting' | 'down' | null;
  setStudioHealth: (health: 'healthy' | 'starting' | 'down') => void;

  activeSongbookPath: string | null;
  setActiveSongbookPath: (path: string | null) => void;

  // Setup & provider keys (state pushed by the host; keys never enter the webview)
  setupState: SetupState | null;
  setSetupState: (state: SetupState) => void;
  setupModalOpen: boolean;
  openSetupModal: () => void;
  closeSetupModal: () => void;
  providerKeysModalOpen: boolean;
  openProviderKeysModal: () => void;
  closeProviderKeysModal: () => void;

  // Admin screens (remote mode): user activation/flags, directory mappings
  adminData: AdminData | null;
  setAdminData: (data: AdminData) => void;
  adminUsersModalOpen: boolean;
  openAdminUsersModal: () => void;
  closeAdminUsersModal: () => void;
  directoryMappingsModalOpen: boolean;
  openDirectoryMappingsModal: () => void;
  closeDirectoryMappingsModal: () => void;
  serverWarning: string | null;
  setServerWarning: (text: string | null) => void;
}

export const useStore = create<GraphState>((set, get) => ({
  graph: { id: 'urn:cantica:studio:graph:default', name: 'New Workflow', actors: [], edges: [] },
  remoteLoad: false,
  selectedActorId: null,
  selectedEdgeId: null,
  runningActors: new Set(),
  pausedActors: new Set(),
  actorOutputs: new Map(),
  resolvedModels: {},
  prompts: [],
  settings: {
    servers: [], serverUrl: 'http://localhost:8042', authToken: '',
    explorerSide: 'left', canticaHome: '', studioPort: 8043,
    autoStartStudio: true,
  },
  explorerSide: 'left',

  setGraph: (graph) => set({ graph }),

  loadGraphFromRemote: (graph) => {
    // Set remoteLoad=true, replace graph, then clear the flag.
    // The auto-save subscription checks remoteLoad and skips saving.
    set({ remoteLoad: true, graph });
    set({ remoteLoad: false });
  },

  resetGraph: () =>
    set((s) => ({
      graph: { ...s.graph, actors: [], edges: [] },
      selectedActorId: null,
      selectedEdgeId: null,
    })),

  addActor: (pos) =>
    set((s) => ({
      graph: { ...s.graph, actors: [...s.graph.actors, defaultActor(pos)] },
    })),

  addCodeActor: (type, pos) =>
    set((s) => ({
      graph: { ...s.graph, actors: [...s.graph.actors, defaultCodeActor(type, pos)] },
    })),

  updateActor: (id, patch) =>
    set((s) => {
      const actor = s.graph.actors.find(a => a.id === id);
      if (!actor) return s;
      const updated = { ...actor, ...patch };

      // When provider or model changes on an AI actor, recompute the model-hash
      // segment of the compound ID and remap any edges that reference the old ID.
      let newId = id;
      if ((patch.provider !== undefined || patch.model !== undefined) && actor.actorType === 'ai') {
        const prefix = 'urn:cantica:studio:actor:';
        const local = id.slice(prefix.length);
        const parts = local.split(':');
        if (parts.length === 3 && parts[0] && parts[1]) {
          // New compound format — update third segment only
          newId = `${prefix}${parts[0]}:${parts[1]}:${_h(`${updated.provider}:${updated.model}`)}`;
        } else {
          // Legacy format (actor-{ts}-{seq}[-{hash}]) — strip old hash, append new
          const base = local.replace(/-[0-9a-f]{8}$/, '');
          newId = `${prefix}${base}-${_h(`${updated.provider}:${updated.model}`)}`;
        }
        updated.id = newId;
      }

      return {
        graph: {
          ...s.graph,
          actors: s.graph.actors.map(a => a.id === id ? updated : a),
          edges: newId !== id
            ? s.graph.edges.map(e => ({
                ...e,
                ...(e.from === id ? { from: newId } : {}),
                ...(e.to === id ? { to: newId } : {}),
              }))
            : s.graph.edges,
        },
      };
    }),

  removeActor: (id) =>
    set((s) => ({
      graph: {
        ...s.graph,
        actors: s.graph.actors.filter((a) => a.id !== id),
        edges: s.graph.edges.filter((e) => e.from !== id && e.to !== id),
      },
      selectedActorId: s.selectedActorId === id ? null : s.selectedActorId,
    })),

  addEdge: (edge) =>
    set((s) => ({
      graph: {
        ...s.graph,
        edges: [
          ...s.graph.edges,
          { ...edge, id: `urn:cantica:studio:edge:edge-${Date.now()}-${++_idSeq}` },
        ],
      },
    })),

  updateEdge: (id, patch) =>
    set((s) => ({
      graph: {
        ...s.graph,
        edges: s.graph.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
    })),

  removeEdge: (id) =>
    set((s) => ({
      graph: { ...s.graph, edges: s.graph.edges.filter((e) => e.id !== id) },
      selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
    })),

  replaceActorEdges: (actorId, edges) =>
    set((s) => ({
      graph: {
        ...s.graph,
        edges: [
          ...s.graph.edges.filter((e) => e.from !== actorId),
          ...edges.map((e) => ({ ...e, id: `urn:cantica:studio:edge:edge-${Date.now()}-${++_idSeq}` })),
        ],
      },
    })),

  updateActorPosition: (id, pos) =>
    set((s) => ({
      graph: {
        ...s.graph,
        actors: s.graph.actors.map((a) => (a.id === id ? { ...a, position: pos } : a)),
      },
    })),

  selectActor: (id) => set({ selectedActorId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedActorId: null }),

  setRunning: (name, running) =>
    set((s) => {
      const next = new Set(s.runningActors);
      if (running) { next.add(name); } else { next.delete(name); }
      // Clear paused state when actor stops
      const nextPaused = running ? s.pausedActors : (() => { const p = new Set(s.pausedActors); p.delete(name); return p; })();
      // Clear resolved model when actor stops (so it re-resolves on next start)
      const nextResolved = running ? s.resolvedModels : (() => { const r = { ...s.resolvedModels }; delete r[name]; return r; })();
      // Clear the resolve-timeout flag when actor stops (next start warns again)
      const nextTimedOut = running ? s.resolveTimedOut : (() => { const t = { ...s.resolveTimedOut }; delete t[name]; return t; })();
      return { runningActors: next, pausedActors: nextPaused, resolvedModels: nextResolved, resolveTimedOut: nextTimedOut };
    }),

  setPaused: (name, paused) =>
    set((s) => {
      const next = new Set(s.pausedActors);
      if (paused) { next.add(name); } else { next.delete(name); }
      return { pausedActors: next };
    }),

  setResolvedModel: (name, model) =>
    set((s) => {
      const nextTimedOut = (() => { const t = { ...s.resolveTimedOut }; delete t[name]; return t; })();
      return { resolvedModels: { ...s.resolvedModels, [name]: model }, resolveTimedOut: nextTimedOut };
    }),

  resolveTimedOut: {},
  markResolveTimedOut: (name) => {
    const s = get();
    // One warning per pending session — the node and the chat modal may both observe the timeout.
    if (s.resolveTimedOut[name] || s.resolvedModels[name]) return;
    set({ resolveTimedOut: { ...s.resolveTimedOut, [name]: true } });
    s.appendOutput(name, '⚠ Model resolution timed out — prompts unlocked; your first prompt will resolve the model.');
    s.openChatIfHidden(name);
  },

  setOutput: (name, output) =>
    set((s) => {
      const next = new Map(s.actorOutputs);
      next.set(name, output);
      return { actorOutputs: next };
    }),

  appendOutput: (name, text) =>
    set((s) => {
      const next = new Map(s.actorOutputs);
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const stamped = `[${ts}] ${text}`;
      const prev = next.get(name) ?? '';
      next.set(name, prev ? `${prev}\n${stamped}` : stamped);
      return { actorOutputs: next };
    }),

  setPrompts: (prompts) => set({ prompts }),
  setSettings: (settings) => set({ settings, explorerSide: settings.explorerSide }),
  setExplorerSide: (side) => set({ explorerSide: side }),
  dynamicModels: {},
  setDynamicModels: (models) => set({ dynamicModels: models }),

  eventsModalActorId: null,
  eventsModalFocusLabel: null,
  cronsModalActorId: null,
  cronsModalFocusLabel: null,
  openEventsModal: (actorId, focusLabel) => set({ eventsModalActorId: actorId, eventsModalFocusLabel: focusLabel ?? null }),
  closeEventsModal: () => set({ eventsModalActorId: null, eventsModalFocusLabel: null }),
  openCronsModal: (actorId, focusLabel) => set({ cronsModalActorId: actorId, cronsModalFocusLabel: focusLabel ?? null }),
  closeCronsModal: () => set({ cronsModalActorId: null, cronsModalFocusLabel: null }),

  providerMenuState: null,
  openProviderMenu: (actorId, x, y) => set({ providerMenuState: { actorId, x, y } }),
  closeProviderMenu: () => set({ providerMenuState: null }),

  actorMenuState: null,
  openActorMenu: (actorId, x, y) => set({ actorMenuState: { actorId, x, y } }),
  closeActorMenu: () => set({ actorMenuState: null }),

  edgeMenuState: null,
  openEdgeMenu: (edgeId, x, y) => set({ edgeMenuState: { edgeId, x, y } }),
  closeEdgeMenu: () => set({ edgeMenuState: null }),

  propertiesModalActorId: null,
  openPropertiesModal: (actorId) => set({ propertiesModalActorId: actorId }),
  closePropertiesModal: () => set({ propertiesModalActorId: null }),

  actorChatVisible: {},
  toggleChat: (actorId) => set(s => ({
    actorChatVisible: { ...s.actorChatVisible, [actorId]: !s.actorChatVisible[actorId] },
  })),
  openChatIfHidden: (name) => set(s => {
    const actor = s.graph.actors.find(a => a.name === name);
    if (!actor || s.actorChatVisible[actor.id]) return {};
    return { actorChatVisible: { ...s.actorChatVisible, [actor.id]: true } };
  }),

  chatModalActorId: null,
  openChatModal: (actorId) => set({ chatModalActorId: actorId }),
  closeChatModal: () => set({ chatModalActorId: null }),

  resourcesModalActorId: null,
  openResourcesModal: (actorId) => set({ resourcesModalActorId: actorId }),
  closeResourcesModal: () => set({ resourcesModalActorId: null }),

  minimapVisible: true,
  toggleMinimap: () => set(s => ({ minimapVisible: !s.minimapVisible })),

  logEntries: [],
  mcpLogEntries: [],
  logVisible: false,
  appendLog: (entry) =>
    set((s) => ({ logEntries: s.logEntries.length >= 500 ? [...s.logEntries.slice(-499), entry] : [...s.logEntries, entry] })),
  appendMcpLog: (entry) =>
    set((s) => ({ mcpLogEntries: s.mcpLogEntries.length >= 200 ? [...s.mcpLogEntries.slice(-199), entry] : [...s.mcpLogEntries, entry] })),
  clearLog: () => set({ logEntries: [], mcpLogEntries: [] }),
  toggleLog: () => set(s => ({ logVisible: !s.logVisible })),

  studioHealth: null,
  setStudioHealth: (health) => set({ studioHealth: health }),

  activeSongbookPath: null,
  setActiveSongbookPath: (path) => set({ activeSongbookPath: path }),

  setupState: null,
  setSetupState: (state) => set({ setupState: state }),
  setupModalOpen: false,
  openSetupModal: () => set({ setupModalOpen: true }),
  closeSetupModal: () => set({ setupModalOpen: false }),
  providerKeysModalOpen: false,
  openProviderKeysModal: () => set({ providerKeysModalOpen: true }),
  closeProviderKeysModal: () => set({ providerKeysModalOpen: false }),

  adminData: null,
  setAdminData: (data) => set({ adminData: data }),
  adminUsersModalOpen: false,
  openAdminUsersModal: () => set({ adminUsersModalOpen: true }),
  closeAdminUsersModal: () => set({ adminUsersModalOpen: false }),
  directoryMappingsModalOpen: false,
  openDirectoryMappingsModal: () => set({ directoryMappingsModalOpen: true }),
  closeDirectoryMappingsModal: () => set({ directoryMappingsModalOpen: false }),
  serverWarning: null,
  setServerWarning: (text) => set({ serverWarning: text }),

}));
