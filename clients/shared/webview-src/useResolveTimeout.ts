import { useEffect, useRef } from 'react';

/** How long a Copilot 'auto' actor may stay "resolving" before prompts unlock anyway. */
export const RESOLVE_TIMEOUT_MS = 60_000;

/**
 * Invokes `onTimeout` once `pending` has stayed true for RESOLVE_TIMEOUT_MS.
 *
 * Guards the prompt lockout for Copilot 'auto' actors: if the backend's model
 * probe fails, no `actorModelResolved` ever arrives — the timeout handler
 * (store.markResolveTimedOut) unlocks the prompt and posts a chat warning.
 * Sending a prompt after the unlock is safe: the first instruct() resolves
 * the model server-side as a fallback. The timer restarts with each pending
 * session (actor stop/start).
 */
export function useResolveTimeout(pending: boolean, onTimeout: () => void): void {
  const cb = useRef(onTimeout);
  useEffect(() => { cb.current = onTimeout; });

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => cb.current(), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
}
