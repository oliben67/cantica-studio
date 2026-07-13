import React from 'react';
import { useStore } from '../store';

export type ProviderMeta = { label: string; color: string; models: string[] };

/** Static fallback model lists — used when the API hasn't returned dynamic models yet. */
export const PROVIDERS: Record<string, ProviderMeta> = {
  claude: {
    label: 'Claude',
    color: '#d97706',
    models: [
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-5',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
  },
  gpt: {
    label: 'GPT',
    color: '#16a34a',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1',
      'o1-mini',
      'o3-mini',
      'o1-preview',
    ],
  },
  gemini: {
    label: 'Gemini',
    color: '#2563eb',
    models: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.0-pro',
    ],
  },
  mistral: {
    label: 'Mistral',
    color: '#7c3aed',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
      'open-mistral-7b',
      'open-mixtral-8x7b',
      'open-mixtral-8x22b',
    ],
  },
  copilot: {
    label: 'Copilot',
    color: '#2da44e',
    models: [
      'auto',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
      'gpt-5-mini',
      'gpt-5.3-codex',
      'claude-sonnet-4.6',
      'claude-sonnet-4.5',
      'claude-opus-4.8',
      'claude-opus-4.7',
      'claude-haiku-4.5',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
    ],
  },
};

// ── Constraint resolution ─────────────────────────────────────────────────────
//
// providerModels setting rules (per provider key):
//   undefined / missing key  →  show dynamic models (or built-in fallback)
//   null                     →  any model name accepted (open); show dynamic/built-in list
//   []  (empty array)        →  provider disabled — hidden entirely
//   ["m1","m2",…]            →  show only these models (may include custom names)

type ProviderEntry = { key: string; label: string; color: string; models: string[] };

function resolveProviders(
  constraints: Record<string, string[] | null>,
  dynamic: Record<string, string[]>,
): ProviderEntry[] {
  return Object.entries(PROVIDERS).flatMap(([key, { label, color, models }]) => {
    const constraint = constraints[key];
    if (Array.isArray(constraint) && constraint.length === 0) return [];  // disabled
    if (constraint !== undefined && constraint !== null) {
      return [{ key, label, color, models: constraint }];
    }
    // Use live models from API when available, otherwise fall back to static list
    const resolvedModels = dynamic[key]?.length ? dynamic[key] : models;
    return [{ key, label, color, models: resolvedModels }];
  });
}

/** Returns true if `model` is in the available list for `provider` (or dynamic list is empty). */
export function isModelAvailable(
  provider: string,
  model: string,
  dynamic: Record<string, string[]>,
): boolean {
  const list = dynamic[provider];
  if (!list || list.length === 0) return true;  // no data yet — assume valid
  return list.includes(model);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProviderMenu() {
  const { providerMenuState, closeProviderMenu, updateActor, graph, runningActors, settings, dynamicModels } = useStore();

  if (!providerMenuState) return null;

  const { actorId, x, y } = providerMenuState;
  const actor = graph.actors.find(a => a.id === actorId);
  // const currentProvider = actor?.provider ?? '';
  const isRunning = actor ? runningActors.has(actor.name) : false;

  const providers = resolveProviders(settings.providerModels ?? {}, dynamicModels);

  function select(provider: string, model: string) {
    if (isRunning) return;
    updateActor(actorId, { provider, model });
    closeProviderMenu();
  }

  return (
    <>
      {/* Transparent overlay — captures outside clicks, prevents canvas selection */}
      <div
        className="cs-provider-overlay"
        onPointerDown={e => { e.stopPropagation(); closeProviderMenu(); }}
      />

      <div className="cs-provider-menu" style={{ left: x, top: y }}>
        {isRunning && (
          <div className="cs-provider-notice">
            🔒 Running — model and provider cannot be changed
          </div>
        )}
        {providers.map(({ key, label, color, models }) => {
          const locked = isRunning;
          return (
            <div key={key} className={`cs-provider-section${locked ? ' cs-provider-section--locked' : ''}`}>
              <div className="cs-provider-section-header">
                <span className="cs-actor-badge" style={{ background: color }}>{label}</span>
                {locked && <span className="cs-provider-lock-icon">🔒</span>}
              </div>
              {models.map(model => (
                <button
                  key={model}
                  className="cs-provider-model-btn"
                  disabled={locked}
                  title={locked ? 'Stop the actor to change model or provider' : undefined}
                  onClick={() => select(key, model)}
                >
                  {model === 'auto' ? 'auto — resolves on first run' : model}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
