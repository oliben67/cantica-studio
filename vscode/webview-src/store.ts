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
    autoStartStudio: true, graphFile: '.vscode/actors.jsonld',
  },
  explorerSide: 'left',

  setGraph: (graph) => set({ graph }),

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
}));
