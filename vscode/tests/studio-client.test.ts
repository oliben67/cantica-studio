import { describe, it, expect } from 'vitest';
import { parseGraph, serializeGraph } from '../src/studio-client';

// ── parseGraph ────────────────────────────────────────────────────────────────

describe('parseGraph', () => {
  it('sets default id and name when missing', () => {
    const g = parseGraph({});
    expect(g.id).toBe('urn:cantica:studio:graph:default');
    expect(g.name).toBe('Workflow');
    expect(g.actors).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it('reads @id and name', () => {
    const g = parseGraph({ '@id': 'urn:x:g', 'name': 'My Graph' });
    expect(g.id).toBe('urn:x:g');
    expect(g.name).toBe('My Graph');
  });

  it('parses a minimal AI actor', () => {
    const g = parseGraph({
      actors: [{
        '@id': 'urn:x:a1',
        '@type': 'AIActor',
        name: 'bot',
        actorType: 'ai',
        definePrompt: null,
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
        maxHistory: 10,
        position: { x: 1, y: 2 },
        promptEvents: [],
        cronJobs: [],
        resources: [],
      }],
    });
    const actor = g.actors[0]!;
    expect(actor.id).toBe('urn:x:a1');
    expect(actor.name).toBe('bot');
    expect(actor.provider).toBe('claude');
    expect(actor.model).toBe('claude-sonnet-4-6');
    expect(actor.position).toEqual({ x: 1, y: 2 });
    expect(actor.definePrompt).toEqual({});
  });

  it('defaults actorType to "ai" when missing', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a' }] });
    expect(g.actors[0]!.actorType).toBe('ai');
  });

  it('parses directory field', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a', directory: 'src/' }] });
    expect(g.actors[0]!.directory).toBe('src/');
  });

  it('parses a cantica:// definePrompt as uri', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a', definePrompt: 'cantica://ns/prompt' }] });
    expect(g.actors[0]!.definePrompt).toEqual({ uri: 'cantica://ns/prompt' });
  });

  it('parses an inline definePrompt as content', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a', definePrompt: 'You are helpful.' }] });
    expect(g.actors[0]!.definePrompt).toEqual({ content: 'You are helpful.' });
  });

  it('parses a code actor with scriptPath', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'w', actorType: 'python', scriptPath: '/app/w.py' }] });
    const a = g.actors[0]!;
    expect(a.actorType).toBe('python');
    expect(a.scriptPath).toBe('/app/w.py');
  });

  it('parses promptEvents including targetActors', () => {
    const g = parseGraph({
      actors: [{
        '@id': 'x', name: 'a',
        promptEvents: [{ name: 'check', prompt: 'Do a check.', targetActors: ['reviewer'] }],
      }],
    });
    const evt = g.actors[0]!.promptEvents[0]!;
    expect(evt.name).toBe('check');
    expect(evt.prompt).toEqual({ content: 'Do a check.' });
    expect(evt.targetActors).toEqual(['reviewer']);
  });

  it('promotes legacy targetActor string to targetActors array', () => {
    const g = parseGraph({
      actors: [{
        '@id': 'x', name: 'a',
        promptEvents: [{ name: 'e', prompt: 'p', targetActor: 'old-style' }],
      }],
    });
    expect(g.actors[0]!.promptEvents[0]!.targetActors).toEqual(['old-style']);
  });

  it('parses cronJobs', () => {
    const g = parseGraph({
      actors: [{
        '@id': 'x', name: 'a',
        cronJobs: [{ name: 'daily', schedule: '0 9 * * *', prompt: 'Morning brief.' }],
      }],
    });
    const cron = g.actors[0]!.cronJobs[0]!;
    expect(cron.name).toBe('daily');
    expect(cron.schedule).toBe('0 9 * * *');
    expect(cron.prompt).toEqual({ content: 'Morning brief.' });
  });

  it('drops edges without a kind (legacy)', () => {
    const g = parseGraph({
      edges: [{ '@id': 'e1', from: 'a', to: 'b', prompt: 'p', label: 'lbl' }],
    });
    expect(g.edges).toHaveLength(0);
  });

  it('drops self-loop edges', () => {
    const g = parseGraph({
      edges: [{ '@id': 'e1', from: 'a', to: 'a', kind: 'event', prompt: 'p', label: 'lbl' }],
    });
    expect(g.edges).toHaveLength(0);
  });

  it('parses valid event edge', () => {
    const g = parseGraph({
      edges: [{ '@id': 'urn:e1', from: 'a', to: 'b', kind: 'event', prompt: 'p', label: 'review' }],
    });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.kind).toBe('event');
    expect(g.edges[0]!.label).toBe('review');
  });

  it('parses cron edge with targetEvent', () => {
    const g = parseGraph({
      edges: [{
        '@id': 'urn:e2', from: 'a', to: 'b', kind: 'cron',
        prompt: 'p', label: 'tick', targetEvent: 'on-tick',
      }],
    });
    expect(g.edges[0]!.targetEvent).toBe('on-tick');
  });
});

// ── serializeGraph ────────────────────────────────────────────────────────────

describe('serializeGraph', () => {
  it('round-trips a graph through serialize → parseGraph', () => {
    const original = parseGraph({
      '@id': 'urn:x:g', 'name': 'RT Test',
      actors: [{
        '@id': 'urn:x:a1', '@type': 'AIActor', name: 'bot',
        actorType: 'ai', definePrompt: 'cantica://ns/role',
        provider: 'claude', model: 'claude-opus-4-8',
        maxTokens: 8192, maxHistory: 5,
        position: { x: 10, y: 20 },
        promptEvents: [{ name: 'review', prompt: 'Review this.', targetActors: ['editor'] }],
        cronJobs: [{ name: 'daily', schedule: '0 9 * * *', prompt: 'Good morning.' }],
        resources: [],
      }],
      edges: [{
        '@id': 'urn:x:e1', from: 'urn:x:a1', to: 'urn:x:a2',
        kind: 'event', prompt: 'p', label: 'review',
      }],
    });

    const raw = serializeGraph(original);
    const restored = parseGraph(raw as Record<string, unknown>);

    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.actors[0]!.name).toBe('bot');
    expect(restored.actors[0]!.definePrompt).toEqual({ uri: 'cantica://ns/role' });
    expect(restored.actors[0]!.model).toBe('claude-opus-4-8');
    expect(restored.actors[0]!.promptEvents[0]!.targetActors).toEqual(['editor']);
    expect(restored.actors[0]!.cronJobs[0]!.name).toBe('daily');
  });

  it('serializes directory when present', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a', directory: 'src/' }] });
    const raw = serializeGraph(g);
    const actors = raw['actors'] as Record<string, unknown>[];
    expect(actors[0]!['directory']).toBe('src/');
  });

  it('omits directory when absent', () => {
    const g = parseGraph({ actors: [{ '@id': 'x', name: 'a' }] });
    const raw = serializeGraph(g);
    const actors = raw['actors'] as Record<string, unknown>[];
    expect(actors[0]!['directory']).toBeUndefined();
  });
});
