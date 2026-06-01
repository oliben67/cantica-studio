import { create } from 'zustand';
import type { AIActorDef, ActorEdgeDef, ActorGraph, CanticaPrompt, ExtensionSettings } from './types';

let _idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++_idSeq}`;

function defaultActor(pos = { x: 100, y: 100 }): AIActorDef {
  return {
    id: `urn:cantica:studio:actor:${nextId('actor')}`,
    name: `actor-${_idSeq}`,
    definePrompt: {},
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    maxHistory: 10,
    position: pos,
    promptEvents: [],
    cronJobs: [],
    resources: [],
  };
}

interface GraphState {
  graph: ActorGraph;
  selectedActorId: string | null;
  selectedEdgeId: string | null;
  runningActors: Set<string>;
  actorOutputs: Map<string, string>;
  prompts: CanticaPrompt[];
  settings: ExtensionSettings;
  explorerSide: 'left' | 'right';

  // Graph mutations
  setGraph: (graph: ActorGraph) => void;
  addActor: (pos?: { x: number; y: number }) => void;
  updateActor: (id: string, patch: Partial<AIActorDef>) => void;
  removeActor: (id: string) => void;
  addEdge: (edge: Omit<ActorEdgeDef, 'id'>) => void;
  updateEdge: (id: string, patch: Partial<ActorEdgeDef>) => void;
  removeEdge: (id: string) => void;
  updateActorPosition: (id: string, pos: { x: number; y: number }) => void;
  resetGraph: () => void;

  // Selection
  selectActor: (id: string | null) => void;
  selectEdge: (id: string | null) => void;

  // Runtime state
  setRunning: (name: string, running: boolean) => void;
  setOutput: (name: string, output: string) => void;

  // Metadata
  setPrompts: (prompts: CanticaPrompt[]) => void;
  setSettings: (settings: ExtensionSettings) => void;
  setExplorerSide: (side: 'left' | 'right') => void;

  // Modal UI state
  eventsModalActorId: string | null;
  cronsModalActorId: string | null;
  openEventsModal: (actorId: string) => void;
  closeEventsModal: () => void;
  openCronsModal: (actorId: string) => void;
  closeCronsModal: () => void;

  providerMenuState: { actorId: string; x: number; y: number } | null;
  openProviderMenu: (actorId: string, x: number, y: number) => void;
  closeProviderMenu: () => void;

  actorMenuState: { actorId: string; x: number; y: number } | null;
  openActorMenu: (actorId: string, x: number, y: number) => void;
  closeActorMenu: () => void;

  propertiesModalActorId: string | null;
  openPropertiesModal: (actorId: string) => void;
  closePropertiesModal: () => void;

  actorLogsVisible: Record<string, boolean>;
  toggleLogs: (actorId: string) => void;

  sendPromptActorId: string | null;
  openSendPrompt: (actorId: string) => void;
  clearSendPrompt: () => void;

  resourcesModalActorId: string | null;
  openResourcesModal: (actorId: string) => void;
  closeResourcesModal: () => void;

  minimapVisible: boolean;
  toggleMinimap: () => void;
}

export const useStore = create<GraphState>((set) => ({
  graph: { id: 'urn:cantica:studio:graph:default', name: 'New Workflow', actors: [], edges: [] },
  selectedActorId: null,
  selectedEdgeId: null,
  runningActors: new Set(),
  actorOutputs: new Map(),
  prompts: [],
  settings: {
    servers: [], serverUrl: 'http://localhost:8042', authToken: '',
    explorerSide: 'left', canticaHome: '', studioPort: 8043,
    autoStartStudio: true,
  },
  explorerSide: 'left',

  setGraph: (graph) => set({ graph }),

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

  updateActor: (id, patch) =>
    set((s) => ({
      graph: {
        ...s.graph,
        actors: s.graph.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    })),

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
          { ...edge, id: `urn:cantica:studio:edge:${nextId('edge')}` },
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
      running ? next.add(name) : next.delete(name);
      return { runningActors: next };
    }),

  setOutput: (name, output) =>
    set((s) => {
      const next = new Map(s.actorOutputs);
      next.set(name, output);
      return { actorOutputs: next };
    }),

  setPrompts: (prompts) => set({ prompts }),
  setSettings: (settings) => set({ settings, explorerSide: settings.explorerSide }),
  setExplorerSide: (side) => set({ explorerSide: side }),

  eventsModalActorId: null,
  cronsModalActorId: null,
  openEventsModal: (actorId) => set({ eventsModalActorId: actorId }),
  closeEventsModal: () => set({ eventsModalActorId: null }),
  openCronsModal: (actorId) => set({ cronsModalActorId: actorId }),
  closeCronsModal: () => set({ cronsModalActorId: null }),

  providerMenuState: null,
  openProviderMenu: (actorId, x, y) => set({ providerMenuState: { actorId, x, y } }),
  closeProviderMenu: () => set({ providerMenuState: null }),

  actorMenuState: null,
  openActorMenu: (actorId, x, y) => set({ actorMenuState: { actorId, x, y } }),
  closeActorMenu: () => set({ actorMenuState: null }),

  propertiesModalActorId: null,
  openPropertiesModal: (actorId) => set({ propertiesModalActorId: actorId }),
  closePropertiesModal: () => set({ propertiesModalActorId: null }),

  actorLogsVisible: {},
  toggleLogs: (actorId) => set(s => ({
    actorLogsVisible: { ...s.actorLogsVisible, [actorId]: !s.actorLogsVisible[actorId] },
  })),

  sendPromptActorId: null,
  openSendPrompt: (actorId) => set({ sendPromptActorId: actorId }),
  clearSendPrompt: () => set({ sendPromptActorId: null }),

  resourcesModalActorId: null,
  openResourcesModal: (actorId) => set({ resourcesModalActorId: actorId }),
  closeResourcesModal: () => set({ resourcesModalActorId: null }),

  minimapVisible: true,
  toggleMinimap: () => set(s => ({ minimapVisible: !s.minimapVisible })),
}));
