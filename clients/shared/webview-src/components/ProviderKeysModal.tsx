import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';
import type { ProviderKeyId, ProviderKeyStatus } from '../types';

const PROVIDERS: { id: ProviderKeyId; label: string; envKey: string; placeholder: string }[] = [
  { id: 'anthropicApiKey', label: 'Anthropic',       envKey: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  { id: 'openaiApiKey',    label: 'OpenAI',          envKey: 'OPENAI_API_KEY',    placeholder: 'sk-...' },
  { id: 'geminiApiKey',    label: 'Google Gemini',   envKey: 'GEMINI_API_KEY',    placeholder: 'AIza...' },
  { id: 'githubToken',     label: 'GitHub (Copilot)', envKey: 'GITHUB_TOKEN',     placeholder: 'ghp_... / github_pat_...' },
];

function statusBadge(status: ProviderKeyStatus | undefined): { text: string; cls: string } {
  switch (status) {
    case 'env':    return { text: 'set from env', cls: 'cs-key-status--env' };
    case 'stored': return { text: 'stored',       cls: 'cs-key-status--stored' };
    default:       return { text: 'not set',      cls: 'cs-key-status--none' };
  }
}

/**
 * Provider API key management form.
 *
 * The host only reports presence (`env` / `stored` / `none`) — key material is
 * write-only from here: typed values live in local component state, are posted
 * once via `saveProviderKey`, and are cleared immediately.
 */
export function ProviderKeysModal() {
  const { setupState, providerKeysModalOpen, closeProviderKeysModal } = useStore();

  // Draft values keyed by provider; only ever sent host-ward. The component
  // unmounts when the modal closes, so drafts never outlive a session.
  const [drafts, setDrafts] = useState<Partial<Record<ProviderKeyId, string>>>({});
  const [editing, setEditing] = useState<ProviderKeyId | null>(null);

  // Refresh presence info on open (mount — App renders this only while open).
  useEffect(() => {
    vscode.postMessage({ type: 'requestSetupState' });
  }, []);

  if (!providerKeysModalOpen) return null;

  function saveKey(id: ProviderKeyId) {
    const value = (drafts[id] ?? '').trim();
    if (!value) return;
    vscode.postMessage({ type: 'saveProviderKey', provider: id, key: value });
    setDrafts(d => ({ ...d, [id]: '' }));
    setEditing(null);
  }

  function clearKey(id: ProviderKeyId) {
    vscode.postMessage({ type: 'clearProviderKey', provider: id });
    setDrafts(d => ({ ...d, [id]: '' }));
    setEditing(null);
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeProviderKeysModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">🔑 Provider API Keys</span>
          <button className="cs-modal-close" onClick={closeProviderKeysModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          <p className="cs-modal-hint">
            Keys are stored encrypted on this machine and synced to the local Studio
            server. Keys set via environment variables take precedence and cannot be
            edited here.
          </p>

          {PROVIDERS.map(p => {
            const status = setupState?.keys?.[p.id];
            const badge = statusBadge(status);
            const isEnv = status === 'env';
            const isEditing = editing === p.id;
            return (
              <div key={p.id} className="cs-modal-event-item">
                <div className="cs-modal-event-header">
                  <span className="cs-modal-event-name" style={{ flex: 1, fontWeight: 600 }}>{p.label}</span>
                  <span className={`cs-modal-hint ${badge.cls}`} title={isEnv ? `Provided by $${p.envKey}` : undefined}>
                    {badge.text}
                  </span>
                  {!isEnv && !isEditing && (
                    <button
                      className="cs-modal-btn"
                      style={{ padding: '1px 8px', fontSize: 10 }}
                      onClick={() => setEditing(p.id)}
                    >
                      {status === 'stored' ? 'Replace' : 'Set key'}
                    </button>
                  )}
                  {!isEnv && status === 'stored' && (
                    <button
                      className="cs-modal-remove-btn"
                      title="Remove stored key"
                      onClick={() => clearKey(p.id)}
                    >✕</button>
                  )}
                </div>

                {isEditing && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      className="cs-prop-input"
                      type="password"
                      autoComplete="off"
                      style={{ flex: 1 }}
                      value={drafts[p.id] ?? ''}
                      onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveKey(p.id); }}
                      placeholder={p.placeholder}
                      autoFocus
                    />
                    <button
                      className="cs-modal-btn cs-modal-btn--primary"
                      onClick={() => saveKey(p.id)}
                      disabled={!(drafts[p.id] ?? '').trim()}
                    >Save</button>
                    <button
                      className="cs-modal-btn"
                      onClick={() => { setEditing(null); setDrafts(d => ({ ...d, [p.id]: '' })); }}
                    >Cancel</button>
                  </div>
                )}
              </div>
            );
          })}

          <p className="cs-modal-hint" style={{ marginTop: 8 }}>
            Already-running actors keep the credentials they started with — restart
            them to pick up a changed key.
          </p>
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={closeProviderKeysModal}>Done</button>
        </div>
      </div>
    </div>
  );
}
