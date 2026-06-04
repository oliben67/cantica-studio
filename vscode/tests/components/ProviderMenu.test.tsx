import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderMenu } from '../../webview-src/components/ProviderMenu';
import { useStore } from '../../webview-src/store';
import type { AIActorDef, ActorGraph } from '../../webview-src/types';

// ── helpers ───────────────────────────────────────────────────────────────────

function actor(overrides: Partial<AIActorDef> = {}): AIActorDef {
  return {
    id: 'urn:x:a1', name: 'bot', actorType: 'ai',
    definePrompt: {}, provider: 'claude', model: 'claude-sonnet-4-6',
    maxTokens: 4096, maxHistory: 10, position: { x: 0, y: 0 },
    promptEvents: [], cronJobs: [], resources: [],
    ...overrides,
  };
}

function graph(actors: AIActorDef[] = []): ActorGraph {
  return { id: 'g', name: 'G', actors, edges: [] };
}

function openMenuFor(actorId: string) {
  useStore.setState({ providerMenuState: { actorId, x: 0, y: 0 } });
}

beforeEach(() => {
  useStore.setState({
    graph: graph([actor()]),
    runningActors: new Set(),
    providerMenuState: null,
  });
});

// ── rendering ─────────────────────────────────────────────────────────────────

describe('ProviderMenu rendering', () => {
  it('renders nothing when providerMenuState is null', () => {
    const { container } = render(<ProviderMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all provider sections when menu is open', () => {
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('GPT')).toBeInTheDocument();
    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByText('Copilot')).toBeInTheDocument();
    expect(screen.getByText('Mistral')).toBeInTheDocument();
  });

  it('shows model buttons for each provider', () => {
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    // claude-sonnet-4-6 is unique to the Claude section
    expect(screen.getByRole('button', { name: 'claude-sonnet-4-6' })).toBeInTheDocument();
    // gpt-4-turbo is unique to GPT (not in Copilot)
    expect(screen.getByRole('button', { name: 'gpt-4-turbo' })).toBeInTheDocument();
  });
});

// ── model selection ───────────────────────────────────────────────────────────

describe('ProviderMenu model selection', () => {
  it('clicking a model updates the actor and closes the menu', () => {
    useStore.setState({ graph: graph([actor({ provider: 'claude' })]) });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'claude-opus-4-8' }));

    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.model).toBe('claude-opus-4-8');
    expect(updated.provider).toBe('claude');
    expect(useStore.getState().providerMenuState).toBeNull();
  });

  it('clicking a different provider updates both provider and model', () => {
    useStore.setState({ graph: graph([actor({ provider: 'claude' })]) });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4-turbo' }));

    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.provider).toBe('gpt');
    expect(updated.model).toBe('gpt-4-turbo');
  });
});

// ── running lock ──────────────────────────────────────────────────────────────

describe('ProviderMenu running lock', () => {
  it('shows a notice banner when the actor is running', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    // The notice banner specifically contains "Running"
    expect(screen.getByText(/Running/i)).toBeInTheDocument();
    // Provider name appears inside the banner text
    const notice = document.querySelector('.cs-provider-notice');
    expect(notice?.textContent).toContain('Claude');
  });

  it('disables model buttons from other providers when running', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    // gpt-4-turbo only exists in the GPT section, not Copilot
    const gptBtn = screen.getByRole('button', { name: 'gpt-4-turbo' });
    expect(gptBtn).toBeDisabled();
  });

  it('keeps same-provider buttons enabled when running', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    const claudeBtn = screen.getByRole('button', { name: 'claude-opus-4-8' });
    expect(claudeBtn).not.toBeDisabled();
  });

  it('clicking a disabled button does not update the actor', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude', model: 'claude-sonnet-4-6' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4-turbo' }));

    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.provider).toBe('claude');   // unchanged
    expect(updated.model).toBe('claude-sonnet-4-6');
  });

  it('allows switching model within same provider while running', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude', model: 'claude-sonnet-4-6' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'claude-haiku-4-5' }));

    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.model).toBe('claude-haiku-4-5');
    expect(updated.provider).toBe('claude');
  });
});

// ── overlay close ─────────────────────────────────────────────────────────────

describe('ProviderMenu overlay', () => {
  it('clicking the overlay closes the menu', () => {
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    // The overlay is the first element (fixed inset div)
    const overlay = document.querySelector('.cs-provider-overlay') as HTMLElement;
    fireEvent.pointerDown(overlay);

    expect(useStore.getState().providerMenuState).toBeNull();
  });
});
