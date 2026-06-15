import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../webview-src/store';
import type { AIActorDef, ActorGraph } from '../webview-src/types';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeActor(overrides: Partial<AIActorDef> = {}): AIActorDef {
  return {
    id: 'urn:x:actor-1',
    name: 'bot',
    actorType: 'ai',
    definePrompt: { content: 'You are a bot.' },
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    maxHistory: 10,
    position: { x: 0, y: 0 },
    promptEvents: [],
    cronJobs: [],
    resources: [],
    ...overrides,
  };
}

function emptyGraph(actors: AIActorDef[] = []): ActorGraph {
  return { id: 'urn:x:graph', name: 'Test', actors, edges: [] };
}

// Reset store to default before each test
beforeEach(() => {
  useStore.setState({
    graph: emptyGraph(),
    remoteLoad: false,
    selectedActorId: null,
    selectedEdgeId: null,
    runningActors: new Set(),
    actorOutputs: new Map(),
    actorChatVisible: {},
    chatModalActorId: null,
    propertiesModalActorId: null,
    eventsModalActorId: null,
    cronsModalActorId: null,
    actorMenuState: null,
    providerMenuState: null,
    edgeMenuState: null,
    resourcesModalActorId: null,
  });
});

// ── graph mutations ───────────────────────────────────────────────────────────

describe('graph mutations', () => {
  it('setGraph replaces the entire graph', () => {
    const actor = makeActor();
    const g = emptyGraph([actor]);
    useStore.getState().setGraph(g);
    expect(useStore.getState().graph.actors).toHaveLength(1);
    expect(useStore.getState().graph.actors[0].name).toBe('bot');
  });

  it('addActor appends a new actor with defaults', () => {
    useStore.getState().addActor({ x: 50, y: 50 });
    expect(useStore.getState().graph.actors).toHaveLength(1);
    const a = useStore.getState().graph.actors[0]!;
    expect(a.actorType).toBe('ai');
    expect(a.provider).toBe('claude');
  });

  it('addCodeActor(python) creates a Python code actor', () => {
    useStore.getState().addCodeActor('python', { x: 0, y: 0 });
    const a = useStore.getState().graph.actors[0]!;
    expect(a.actorType).toBe('python');
    expect(a.provider).toBe('');
  });

  it('addCodeActor(typescript) creates a TypeScript code actor', () => {
    useStore.getState().addCodeActor('typescript', { x: 0, y: 0 });
    const a = useStore.getState().graph.actors[0]!;
    expect(a.actorType).toBe('typescript');
  });

  it('updateActor patches specific fields without touching others', () => {
    const actor = makeActor();
    useStore.getState().setGraph(emptyGraph([actor]));
    useStore.getState().updateActor(actor.id, { model: 'claude-opus-4-8' });
    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.model).toBe('claude-opus-4-8');
    expect(updated.provider).toBe('claude'); // unchanged
  });

  it('removeActor deletes the actor by id', () => {
    const a1 = makeActor({ id: 'urn:x:a1', name: 'a1' });
    const a2 = makeActor({ id: 'urn:x:a2', name: 'a2' });
    useStore.getState().setGraph(emptyGraph([a1, a2]));
    useStore.getState().removeActor('urn:x:a1');
    expect(useStore.getState().graph.actors).toHaveLength(1);
    expect(useStore.getState().graph.actors[0]!.name).toBe('a2');
  });

  it('loadGraphFromRemote replaces graph and leaves remoteLoad false', () => {
    const g = emptyGraph([makeActor()]);
    useStore.getState().loadGraphFromRemote(g);
    expect(useStore.getState().graph.actors).toHaveLength(1);
    // remoteLoad must be cleared after the call so subsequent user edits save normally
    expect(useStore.getState().remoteLoad).toBe(false);
  });

  it('remoteLoad flag is false after loadGraphFromRemote — auto-save not triggered', () => {
    // Simulate a subscription: record whether a save would fire
    let wouldSave = false;
    const unsub = useStore.subscribe((state, prev) => {
      if (state.graph !== prev.graph && !state.remoteLoad) wouldSave = true;
    });
    useStore.getState().loadGraphFromRemote(emptyGraph([makeActor()]));
    unsub();
    expect(wouldSave).toBe(false);
  });

  it('user mutations (addActor) do trigger the auto-save subscription', () => {
    let wouldSave = false;
    const unsub = useStore.subscribe((state, prev) => {
      if (state.graph !== prev.graph && !state.remoteLoad) wouldSave = true;
    });
    useStore.getState().addActor();
    unsub();
    expect(wouldSave).toBe(true);
  });

  it('resetGraph clears all actors and edges', () => {
    useStore.getState().setGraph(emptyGraph([makeActor()]));
    useStore.getState().resetGraph();
    expect(useStore.getState().graph.actors).toHaveLength(0);
    expect(useStore.getState().graph.edges).toHaveLength(0);
  });

  it('updateActorPosition updates position without touching other fields', () => {
    const actor = makeActor();
    useStore.getState().setGraph(emptyGraph([actor]));
    useStore.getState().updateActorPosition(actor.id, { x: 999, y: 888 });
    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.position).toEqual({ x: 999, y: 888 });
    expect(updated.name).toBe('bot');
  });
});

// ── runtime state ─────────────────────────────────────────────────────────────

describe('runtime state', () => {
  it('setRunning(true) adds the actor name to runningActors', () => {
    useStore.getState().setRunning('bot', true);
    expect(useStore.getState().runningActors.has('bot')).toBe(true);
  });

  it('setRunning(false) removes the actor name from runningActors', () => {
    useStore.getState().setRunning('bot', true);
    useStore.getState().setRunning('bot', false);
    expect(useStore.getState().runningActors.has('bot')).toBe(false);
  });

  it('multiple actors can run simultaneously', () => {
    useStore.getState().setRunning('a', true);
    useStore.getState().setRunning('b', true);
    expect(useStore.getState().runningActors.has('a')).toBe(true);
    expect(useStore.getState().runningActors.has('b')).toBe(true);
  });

  it('setOutput replaces the output for the named actor', () => {
    useStore.getState().setOutput('bot', 'hello');
    expect(useStore.getState().actorOutputs.get('bot')).toBe('hello');
  });

  it('setOutput overwrites previous output', () => {
    useStore.getState().setOutput('bot', 'first');
    useStore.getState().setOutput('bot', 'second');
    expect(useStore.getState().actorOutputs.get('bot')).toBe('second');
  });

  it('appendOutput appends with a newline separator', () => {
    useStore.getState().appendOutput('bot', 'line1');
    useStore.getState().appendOutput('bot', 'line2');
    expect(useStore.getState().actorOutputs.get('bot')).toBe('line1\nline2');
  });

  it('appendOutput creates the entry if none exists', () => {
    useStore.getState().appendOutput('new-actor', 'first');
    expect(useStore.getState().actorOutputs.get('new-actor')).toBe('first');
  });

  it('appendOutput does not add a leading newline when empty', () => {
    useStore.getState().appendOutput('bot', 'only line');
    expect(useStore.getState().actorOutputs.get('bot')).toBe('only line');
  });
});

// ── chat visibility ───────────────────────────────────────────────────────

describe('chat visibility', () => {
  it('toggleChat flips visibility from false to true', () => {
    useStore.getState().toggleChat('urn:x:a1');
    expect(useStore.getState().actorChatVisible['urn:x:a1']).toBe(true);
  });

  it('toggleChat flips visibility from true to false', () => {
    useStore.getState().toggleChat('urn:x:a1');
    useStore.getState().toggleChat('urn:x:a1');
    expect(useStore.getState().actorChatVisible['urn:x:a1']).toBe(false);
  });

  it('different actors toggle independently', () => {
    useStore.getState().toggleChat('urn:x:a1');
    expect(useStore.getState().actorChatVisible['urn:x:a2']).toBeFalsy();
  });
});

// ── modal open/close ──────────────────────────────────────────────────────────

describe('modal state', () => {
  it('openChatModal sets chatModalActorId', () => {
    useStore.getState().openChatModal('urn:x:a1');
    expect(useStore.getState().chatModalActorId).toBe('urn:x:a1');
  });

  it('closeChatModal clears chatModalActorId', () => {
    useStore.getState().openChatModal('urn:x:a1');
    useStore.getState().closeChatModal();
    expect(useStore.getState().chatModalActorId).toBeNull();
  });

  it('openPropertiesModal sets propertiesModalActorId', () => {
    useStore.getState().openPropertiesModal('urn:x:a1');
    expect(useStore.getState().propertiesModalActorId).toBe('urn:x:a1');
  });

  it('closePropertiesModal clears propertiesModalActorId', () => {
    useStore.getState().openPropertiesModal('urn:x:a1');
    useStore.getState().closePropertiesModal();
    expect(useStore.getState().propertiesModalActorId).toBeNull();
  });
});

// ── selection ─────────────────────────────────────────────────────────────────

describe('selection', () => {
  it('selectActor sets selectedActorId and clears edge selection', () => {
    useStore.getState().selectEdge('edge-1');
    useStore.getState().selectActor('urn:x:a1');
    expect(useStore.getState().selectedActorId).toBe('urn:x:a1');
    expect(useStore.getState().selectedEdgeId).toBeNull();
  });

  it('selectEdge sets selectedEdgeId and clears actor selection', () => {
    useStore.getState().selectActor('urn:x:a1');
    useStore.getState().selectEdge('edge-1');
    expect(useStore.getState().selectedEdgeId).toBe('edge-1');
    expect(useStore.getState().selectedActorId).toBeNull();
  });
});
