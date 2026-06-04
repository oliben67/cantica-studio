import { create } from 'zustand';
import type { AIActorDef, ActorEdgeDef, ActorGraph, ActorType, CanticaPrompt, ExtensionSettings } from './types';

let _idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++_idSeq}`;

function defaultActor(pos = { x: 100, y: 100 }): AIActorDef {
  return {
    id: `urn:cantica:studio:actor:${nextId('actor')}`,
    name: `actor-${_idSeq}`,
    actorType: 'ai',
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

function defaultCodeActor(type: 'python' | 'typescript', pos = { x: 100, y: 100 }): AIActorDef {
  const seq = ++_idSeq;
  return {
    id: `urn:cantica:studio:actor:${nextId('code')}`,
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
  setOutput: (name: string, output: string) => void;
  appendOutput: (name: string, text: string) => void;

  // Metadata
  setPrompts: (prompts: CanticaPrompt[]) => void;
  setSettings: (settings: ExtensionSettings) => void;
  setExplorerSide: (side: 'left' | 'right') => void;

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

  actorActivitiesVisible: Record<string, boolean>;
  toggleActivities: (actorId: string) => void;

  activityModalActorId: string | null;
  openActivityModal: (actorId: string) => void;
  closeActivityModal: () => void;

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

  addCodeActor: (type, pos) =>
    set((s) => ({
      graph: { ...s.graph, actors: [...s.graph.actors, defaultCodeActor(type, pos)] },
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

  replaceActorEdges: (actorId, edges) =>
    set((s) => ({
      graph: {
        ...s.graph,
        edges: [
          ...s.graph.edges.filter((e) => e.from !== actorId),
          ...edges.map((e) => ({ ...e, id: `urn:cantica:studio:edge:${nextId('edge')}` })),
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
      running ? next.add(name) : next.delete(name);
      return { runningActors: next };
    }),

  setOutput: (name, output) =>
    set((s) => {
      const next = new Map(s.actorOutputs);
      next.set(name, output);
      return { actorOutputs: next };
    }),

  appendOutput: (name, text) =>
    set((s) => {
      const next = new Map(s.actorOutputs);
      const prev = next.get(name) ?? '';
      next.set(name, prev ? `${prev}\n${text}` : text);
      return { actorOutputs: next };
    }),

  setPrompts: (prompts) => set({ prompts }),
  setSettings: (settings) => set({ settings, explorerSide: settings.explorerSide }),
  setExplorerSide: (side) => set({ explorerSide: side }),

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

  actorActivitiesVisible: {},
  toggleActivities: (actorId) => set(s => ({
    actorActivitiesVisible: { ...s.actorActivitiesVisible, [actorId]: !s.actorActivitiesVisible[actorId] },
  })),

  activityModalActorId: null,
  openActivityModal: (actorId) => set({ activityModalActorId: actorId }),
  closeActivityModal: () => set({ activityModalActorId: null }),

  resourcesModalActorId: null,
  openResourcesModal: (actorId) => set({ resourcesModalActorId: actorId }),
  closeResourcesModal: () => set({ resourcesModalActorId: null }),

  minimapVisible: true,
  toggleMinimap: () => set(s => ({ minimapVisible: !s.minimapVisible })),
}));
