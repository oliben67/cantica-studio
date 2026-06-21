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

function defaultSettings() {
  return {
    servers: [], serverUrl: '', authToken: '', explorerSide: 'left' as const,
    canticaHome: '', studioPort: 8043, autoStartStudio: true, providerModels: {},
  };
}

beforeEach(() => {
  useStore.setState({
    graph: graph([actor()]),
    runningActors: new Set(),
    providerMenuState: null,
    settings: defaultSettings(),
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
    // claude-opus-4-8 is unique to the Claude section (not in Copilot)
    expect(screen.getByRole('button', { name: 'claude-opus-4-8' })).toBeInTheDocument();
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
    // The notice banner contains "Running"
    expect(screen.getByText(/Running/i)).toBeInTheDocument();
    const notice = document.querySelector('.cs-provider-notice');
    expect(notice?.textContent).toContain('model and provider cannot be changed');
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

  it('disables all model buttons (including same-provider) when running', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    const claudeBtn = screen.getByRole('button', { name: 'claude-opus-4-8' });
    expect(claudeBtn).toBeDisabled();
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

  it('clicking any model button while running does not update the actor', () => {
    useStore.setState({
      graph: graph([actor({ provider: 'claude', model: 'claude-sonnet-4-6' })]),
      runningActors: new Set(['bot']),
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'claude-haiku-4-5' }));

    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.model).toBe('claude-sonnet-4-6');   // unchanged
    expect(updated.provider).toBe('claude');
  });
});

// ── providerModels constraints ────────────────────────────────────────────────

describe('ProviderMenu providerModels constraints', () => {
  it('empty array [] hides the provider entirely', () => {
    useStore.setState({ settings: { ...defaultSettings(), providerModels: { gpt: [] } } });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    // GPT badge should not be in the document
    expect(screen.queryByText('GPT')).not.toBeInTheDocument();
    // Other providers still visible
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('allowlist shows only the specified models', () => {
    useStore.setState({
      // claude-3-5-sonnet-20241022 is only in Claude's built-in list, not Copilot's
      settings: { ...defaultSettings(), providerModels: { claude: ['claude-3-5-sonnet-20241022'] } },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    expect(screen.getByRole('button', { name: 'claude-3-5-sonnet-20241022' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'claude-opus-4-8' })).not.toBeInTheDocument();
  });

  it('allowlist may contain custom model names not in the built-in list', () => {
    useStore.setState({
      settings: {
        ...defaultSettings(),
        // Restrict every provider except copilot so model names are unambiguous
        providerModels: {
          claude: [], gpt: [], gemini: [], mistral: [],
          copilot: ['my-copilot-model-a', 'my-copilot-model-b', 'my-custom-new'],
        },
      },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    expect(screen.getByRole('button', { name: 'my-copilot-model-a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'my-copilot-model-b' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'my-custom-new' })).toBeInTheDocument();
  });

  it('null shows the full built-in default list', () => {
    useStore.setState({
      settings: { ...defaultSettings(), providerModels: { claude: null } },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    // Use models unique to the Claude section (not in Copilot's default list)
    expect(screen.getByRole('button', { name: 'claude-opus-4-8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'claude-3-haiku-20240307' })).toBeInTheDocument();
  });

  it('missing key (undefined) falls back to the built-in default list', () => {
    // providerModels doesn't mention 'claude' at all
    useStore.setState({
      settings: { ...defaultSettings(), providerModels: { gpt: [] } },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    expect(screen.getByRole('button', { name: 'claude-opus-4-8' })).toBeInTheDocument();
  });

  it('selecting a custom model from allowlist updates the actor', () => {
    useStore.setState({
      settings: { ...defaultSettings(), providerModels: { copilot: ['my-custom-model'] } },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'my-custom-model' }));
    const updated = useStore.getState().graph.actors[0]!;
    expect(updated.provider).toBe('copilot');
    expect(updated.model).toBe('my-custom-model');
  });

  it('disabling all except one provider still shows that provider', () => {
    useStore.setState({
      settings: {
        ...defaultSettings(),
        providerModels: { gpt: [], gemini: [], mistral: [], copilot: [] },
      },
    });
    openMenuFor('urn:x:a1');
    render(<ProviderMenu />);
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.queryByText('GPT')).not.toBeInTheDocument();
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
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
