import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetupModal } from '../../webview-src/components/SetupModal';
import { ProviderKeysModal } from '../../webview-src/components/ProviderKeysModal';
import { useStore } from '../../webview-src/store';
import { vscode } from '../../webview-src/vscode';
import type { SetupState } from '../../webview-src/types';

function setupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    mode: 'local',
    runMode: 'container',
    remoteUrl: '',
    setupDone: true,
    keys: { anthropicApiKey: 'none', openaiApiKey: 'none', geminiApiKey: 'none', githubToken: 'none' },
    ...overrides,
  };
}

const post = vscode.postMessage as ReturnType<typeof vi.fn>;

beforeEach(() => {
  post.mockClear();
  useStore.setState({
    setupState: setupState(),
    setupModalOpen: false,
    providerKeysModalOpen: false,
  });
});

// ── store slice ───────────────────────────────────────────────────────────────

describe('setup store slice', () => {
  it('open/close toggles modal visibility', () => {
    useStore.getState().openSetupModal();
    expect(useStore.getState().setupModalOpen).toBe(true);
    useStore.getState().closeSetupModal();
    expect(useStore.getState().setupModalOpen).toBe(false);

    useStore.getState().openProviderKeysModal();
    expect(useStore.getState().providerKeysModalOpen).toBe(true);
    useStore.getState().closeProviderKeysModal();
    expect(useStore.getState().providerKeysModalOpen).toBe(false);
  });

  it('setSetupState replaces the state', () => {
    useStore.getState().setSetupState(setupState({ mode: 'remote', remoteUrl: 'https://x' }));
    expect(useStore.getState().setupState?.mode).toBe('remote');
    expect(useStore.getState().setupState?.remoteUrl).toBe('https://x');
  });
});

// ── SetupModal ────────────────────────────────────────────────────────────────

describe('SetupModal', () => {
  it('renders nothing when closed', () => {
    render(<SetupModal />);
    expect(screen.queryByText('Studio Setup', { exact: false })).not.toBeInTheDocument();
  });

  it('requests fresh state when opened', () => {
    useStore.setState({ setupModalOpen: true });
    render(<SetupModal />);
    expect(post).toHaveBeenCalledWith({ type: 'requestSetupState' });
  });

  it('saves local mode with run mode and closes', () => {
    useStore.setState({ setupModalOpen: true });
    render(<SetupModal />);
    fireEvent.click(screen.getByText('Save'));
    expect(post).toHaveBeenCalledWith({ type: 'saveSetup', mode: 'local', runMode: 'container' });
    expect(useStore.getState().setupModalOpen).toBe(false);
  });

  it('remote mode requires a valid URL before saving', () => {
    useStore.setState({
      setupModalOpen: true,
      setupState: setupState({ mode: 'remote', remoteUrl: '' }),
    });
    render(<SetupModal />);
    expect(screen.getByText('Save')).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('https://studio.example.com:8043'), {
      target: { value: 'https://studio.example.com:8043' },
    });
    expect(screen.getByText('Save')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Save'));
    expect(post).toHaveBeenCalledWith({
      type: 'saveSetup', mode: 'remote', runMode: 'container', remoteUrl: 'https://studio.example.com:8043',
    });
  });
});

// ── ProviderKeysModal ─────────────────────────────────────────────────────────

describe('ProviderKeysModal', () => {
  it('shows presence status per provider', () => {
    useStore.setState({
      providerKeysModalOpen: true,
      setupState: setupState({
        keys: { anthropicApiKey: 'env', openaiApiKey: 'stored', geminiApiKey: 'none', githubToken: 'none' },
      }),
    });
    render(<ProviderKeysModal />);
    expect(screen.getByText('set from env')).toBeInTheDocument();
    expect(screen.getByText('stored')).toBeInTheDocument();
    expect(screen.getAllByText('not set')).toHaveLength(2);
  });

  it('env-provided keys cannot be edited', () => {
    useStore.setState({
      providerKeysModalOpen: true,
      setupState: setupState({
        keys: { anthropicApiKey: 'env', openaiApiKey: 'none', geminiApiKey: 'none', githubToken: 'none' },
      }),
    });
    render(<ProviderKeysModal />);
    // Three "Set key" buttons (openai, gemini, github) — none for the env-backed anthropic.
    expect(screen.getAllByText('Set key')).toHaveLength(3);
  });

  it('saving a key posts it once and clears the draft', () => {
    useStore.setState({ providerKeysModalOpen: true });
    render(<ProviderKeysModal />);
    fireEvent.click(screen.getAllByText('Set key')[0]!);
    const input = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(input, { target: { value: '  sk-ant-secret  ' } });
    fireEvent.click(screen.getByText('Save'));
    expect(post).toHaveBeenCalledWith({
      type: 'saveProviderKey', provider: 'anthropicApiKey', key: 'sk-ant-secret',
    });
    // Editor closes after save — no lingering password input.
    expect(screen.queryByPlaceholderText('sk-ant-...')).not.toBeInTheDocument();
  });

  it('clearing a stored key posts clearProviderKey', () => {
    useStore.setState({
      providerKeysModalOpen: true,
      setupState: setupState({
        keys: { anthropicApiKey: 'stored', openaiApiKey: 'none', geminiApiKey: 'none', githubToken: 'none' },
      }),
    });
    render(<ProviderKeysModal />);
    fireEvent.click(screen.getByTitle('Remove stored key'));
    expect(post).toHaveBeenCalledWith({ type: 'clearProviderKey', provider: 'anthropicApiKey' });
  });
});
