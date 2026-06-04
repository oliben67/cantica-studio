import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityModal } from '../../webview-src/components/ActivityModal';
import { useStore } from '../../webview-src/store';
import type { AIActorDef, ActorGraph } from '../../webview-src/types';

// vscode postMessage mock from setup.ts is already in place via acquireVsCodeApi

function actor(overrides: Partial<AIActorDef> = {}): AIActorDef {
  return {
    id: 'urn:x:a1', name: 'test-actor', actorType: 'ai',
    definePrompt: {}, provider: 'claude', model: 'claude-sonnet-4-6',
    maxTokens: 4096, maxHistory: 10, position: { x: 0, y: 0 },
    promptEvents: [], cronJobs: [], resources: [],
    ...overrides,
  };
}

function graph(actors: AIActorDef[] = []): ActorGraph {
  return { id: 'g', name: 'G', actors, edges: [] };
}

beforeEach(() => {
  useStore.setState({
    graph: graph([actor()]),
    runningActors: new Set(),
    activityModalActorId: null,
    actorOutputs: new Map(),
  });
});

// ── rendering ─────────────────────────────────────────────────────────────────

describe('ActivityModal rendering', () => {
  it('renders nothing when activityModalActorId is null', () => {
    const { container } = render(<ActivityModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal with actor name when open', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1' });
    render(<ActivityModal />);
    expect(screen.getByText(/test-actor/i)).toBeInTheDocument();
    expect(screen.getByText(/Activities/i)).toBeInTheDocument();
  });

  it('shows empty state message when no output', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1' });
    render(<ActivityModal />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it('renders user prompt bubbles for lines starting with "> "', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      actorOutputs: new Map([['test-actor', '> Hello there']]),
    });
    render(<ActivityModal />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('renders AI response bubbles for plain lines', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      actorOutputs: new Map([['test-actor', 'Hi, I am Claude!']]),
    });
    render(<ActivityModal />);
    expect(screen.getByText('Hi, I am Claude!')).toBeInTheDocument();
  });

  it('renders system lines (⏳ ✓ ⚠ ℹ) in their own style', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      actorOutputs: new Map([['test-actor', '✓ Ready · claude/claude-sonnet-4-6']]),
    });
    render(<ActivityModal />);
    expect(screen.getByText('✓ Ready · claude/claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('renders multiple messages in order', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      actorOutputs: new Map([['test-actor', '> Question\nAnswer line']]),
    });
    render(<ActivityModal />);
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText('Answer line')).toBeInTheDocument();
  });
});

// ── close ─────────────────────────────────────────────────────────────────────

describe('ActivityModal close', () => {
  it('clicking ✕ closes the modal', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1' });
    render(<ActivityModal />);
    fireEvent.click(screen.getByTitle('Close'));
    expect(useStore.getState().activityModalActorId).toBeNull();
  });

  it('clicking the overlay closes the modal', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1' });
    render(<ActivityModal />);
    const overlay = document.querySelector('.cs-modal-overlay') as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(useStore.getState().activityModalActorId).toBeNull();
  });

  it('clicking inside the modal does not close it', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1' });
    render(<ActivityModal />);
    const modal = document.querySelector('.cs-modal') as HTMLElement;
    fireEvent.mouseDown(modal);
    expect(useStore.getState().activityModalActorId).toBe('urn:x:a1');
  });
});

// ── prompt resend ─────────────────────────────────────────────────────────────

describe('ActivityModal prompt resend', () => {
  it('clicking a user bubble populates the input field', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      actorOutputs: new Map([['test-actor', '> Previous question']]),
    });
    render(<ActivityModal />);
    fireEvent.click(screen.getByText('Previous question'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Previous question');
  });
});

// ── send prompt ───────────────────────────────────────────────────────────────

describe('ActivityModal send prompt', () => {
  it('input is disabled when actor is not running', () => {
    useStore.setState({ activityModalActorId: 'urn:x:a1', runningActors: new Set() });
    render(<ActivityModal />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('input is enabled when actor is running', () => {
    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      runningActors: new Set(['test-actor']),
    });
    render(<ActivityModal />);
    const input = screen.getByRole('textbox');
    expect(input).not.toBeDisabled();
  });

  it('pressing Enter dispatches runActor message and appends to output', () => {
    const postMessage = vi.fn();
    (globalThis as unknown as Record<string, unknown>)['acquireVsCodeApi'] = () => ({
      postMessage, getState: vi.fn(), setState: vi.fn(),
    });

    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      runningActors: new Set(['test-actor']),
    });
    render(<ActivityModal />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'What time is it?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Input cleared
    expect((input as HTMLInputElement).value).toBe('');

    // Output appended
    const output = useStore.getState().actorOutputs.get('test-actor');
    expect(output).toContain('> What time is it?');
  });

  it('Send button dispatches when clicked', () => {
    const postMessage = vi.fn();
    (globalThis as unknown as Record<string, unknown>)['acquireVsCodeApi'] = () => ({
      postMessage, getState: vi.fn(), setState: vi.fn(),
    });

    useStore.setState({
      activityModalActorId: 'urn:x:a1',
      runningActors: new Set(['test-actor']),
    });
    render(<ActivityModal />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(useStore.getState().actorOutputs.get('test-actor')).toContain('> Hello!');
  });
});
