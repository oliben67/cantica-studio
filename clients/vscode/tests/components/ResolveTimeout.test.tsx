import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useResolveTimeout, RESOLVE_TIMEOUT_MS } from '../../webview-src/useResolveTimeout';
import { useStore } from '../../webview-src/store';

function Probe({ pending, onTimeout }: { pending: boolean; onTimeout: () => void }) {
  useResolveTimeout(pending, onTimeout);
  return null;
}

describe('useResolveTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('fires onTimeout after RESOLVE_TIMEOUT_MS of pending', () => {
    const onTimeout = vi.fn();
    render(<Probe pending={true} onTimeout={onTimeout} />);
    act(() => { vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS - 1); });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancels the timer when pending ends (model resolved / actor stopped)', () => {
    const onTimeout = vi.fn();
    const { rerender } = render(<Probe pending={true} onTimeout={onTimeout} />);
    act(() => { vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS / 2); });
    rerender(<Probe pending={false} onTimeout={onTimeout} />);
    act(() => { vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS * 2); });
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does not fire while pending is false', () => {
    const onTimeout = vi.fn();
    render(<Probe pending={false} onTimeout={onTimeout} />);
    act(() => { vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS * 2); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('store.markResolveTimedOut', () => {
  beforeEach(() => {
    useStore.setState({
      actorOutputs: new Map(),
      resolvedModels: {},
      resolveTimedOut: {},
      runningActors: new Set(['bot']),
      actorChatVisible: {},
    });
  });

  it('sets the flag and posts a single chat warning', () => {
    useStore.getState().markResolveTimedOut('bot');
    expect(useStore.getState().resolveTimedOut['bot']).toBe(true);
    const output = useStore.getState().actorOutputs.get('bot') ?? '';
    expect(output).toContain('Model resolution timed out');
  });

  it('is idempotent — the node and modal may both observe the timeout', () => {
    useStore.getState().markResolveTimedOut('bot');
    useStore.getState().markResolveTimedOut('bot');
    const output = useStore.getState().actorOutputs.get('bot') ?? '';
    expect(output.match(/Model resolution timed out/g)).toHaveLength(1);
  });

  it('is a no-op when the model already resolved', () => {
    useStore.setState({ resolvedModels: { bot: 'claude-sonnet-4.6' } });
    useStore.getState().markResolveTimedOut('bot');
    expect(useStore.getState().resolveTimedOut['bot']).toBeUndefined();
    expect(useStore.getState().actorOutputs.get('bot')).toBeUndefined();
  });

  it('clears the flag when the actor stops so the next session warns again', () => {
    useStore.getState().markResolveTimedOut('bot');
    useStore.getState().setRunning('bot', false);
    expect(useStore.getState().resolveTimedOut['bot']).toBeUndefined();
  });

  it('clears the flag when a late resolution arrives', () => {
    useStore.getState().markResolveTimedOut('bot');
    useStore.getState().setResolvedModel('bot', 'claude-sonnet-4.6');
    expect(useStore.getState().resolveTimedOut['bot']).toBeUndefined();
    expect(useStore.getState().resolvedModels['bot']).toBe('claude-sonnet-4.6');
  });
});
