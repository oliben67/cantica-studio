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
      'meta-llama-3.1-405b-instruct',
      'meta-llama-3.1-70b-instruct',
      'meta-llama-3.1-8b-instruct',
      'mistral-large-2407',
    ],
  },
};

export function ProviderMenu() {
  const { providerMenuState, closeProviderMenu, updateActor, graph, runningActors } = useStore();

  if (!providerMenuState) return null;

  const { actorId, x, y } = providerMenuState;
  const actor = graph.actors.find(a => a.id === actorId);
  const currentProvider = actor?.provider ?? '';
  const isRunning = actor ? runningActors.has(actor.name) : false;

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
        {Object.entries(PROVIDERS).map(([key, { label, color, models }]) => {
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
