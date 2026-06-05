import React from 'react';
import { useStore } from '../store';

export const PROVIDERS: Record<string, { label: string; color: string; models: string[] }> = {
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
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o1-mini',
      'o3-mini',
      'claude-3-5-sonnet',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6',
      'claude-sonnet-4-7',
      'meta-llama-3.1-405b-instruct',
      'meta-llama-3.1-70b-instruct',
      'meta-llama-3.1-8b-instruct',
      'mistral-large-2407',
      'gemini-2.0-flash',
    ],
  },
};

// ── Constraint resolution ─────────────────────────────────────────────────────
//
// providerModels setting rules (per provider key):
//   undefined / missing key  →  show built-in default model list
//   null                     →  any model name accepted (open); show built-in list
//   []  (empty array)        →  provider disabled — hidden entirely
//   ["m1","m2",…]            →  show only these models (may include custom names)

type ProviderEntry = { key: string; label: string; color: string; models: string[] };

function resolveProviders(constraints: Record<string, string[] | null>): ProviderEntry[] {
  return Object.entries(PROVIDERS).flatMap(([key, { label, color, models }]) => {
    const constraint = constraints[key];
    if (Array.isArray(constraint) && constraint.length === 0) return [];  // disabled
    const resolvedModels = (constraint === undefined || constraint === null) ? models : constraint;
    return [{ key, label, color, models: resolvedModels }];
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProviderMenu() {
  const { providerMenuState, closeProviderMenu, updateActor, graph, runningActors, settings } = useStore();

  if (!providerMenuState) return null;

  const { actorId, x, y } = providerMenuState;
  const actor = graph.actors.find(a => a.id === actorId);
  const currentProvider = actor?.provider ?? '';
  const isRunning = actor ? runningActors.has(actor.name) : false;

  const providers = resolveProviders(settings.providerModels ?? {});

  function select(provider: string, model: string) {
    if (isRunning && provider !== currentProvider) return;
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
            🔒 Running — only <strong>{PROVIDERS[currentProvider]?.label ?? currentProvider}</strong> models available
          </div>
        )}
        {providers.map(({ key, label, color, models }) => {
          const locked = isRunning && key !== currentProvider;
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
                  title={locked ? `Stop the actor to switch to ${label}` : undefined}
                  onClick={() => select(key, model)}
                >
                  {model}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
