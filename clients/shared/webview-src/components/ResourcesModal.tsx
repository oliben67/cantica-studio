import React, { useState } from 'react';
import { useStore } from '../store';
import type { AgentResource, AIActorDef } from '../types';

type Draft = Omit<AgentResource, 'id'>;

const RESOURCE_TYPES: AgentResource['type'][] = ['file', 'api', 'text', 'other'];

const TYPE_LABELS: Record<AgentResource['type'], string> = {
  file: '📄 File',
  api:  '🔌 API',
  text: '📝 Text',
  other: '📦 Other',
};

let _seq = 0;
const uid = () => `res-${Date.now()}-${++_seq}`;

function isLocked(r: AgentResource, running: boolean): boolean {
  if (!running) return false;           // not running → all editable
  if (!r.dynamic) return true;          // static (pre-play) → locked
  return !!(r.sharedWith?.length);      // dynamic + shared → locked
}

// ── Inner (keyed per actor) ────────────────────────────────────────────────

function Inner({ actor }: { actor: AIActorDef }) {
  const { graph, updateActor, runningActors, closeResourcesModal } = useStore();
  const allActors = graph.actors;
  const running = runningActors.has(actor.name);

  const [resources, setResources] = useState<AgentResource[]>(() =>
    (actor.resources ?? []).map(r => ({ ...r, sharedWith: [...(r.sharedWith ?? [])] }))
  );

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: '', type: 'file', uri: '', description: '' });
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState('');

  function addResource() {
    if (!draft.name.trim() || !draft.uri.trim()) return;
    const r: AgentResource = { ...draft, id: uid(), dynamic: false, sharedWith: [] };
    setResources(prev => [...prev, r]);
    setDraft({ name: '', type: 'file', uri: '', description: '' });
    setAdding(false);
  }

  function removeResource(id: string) {
    setResources(prev => prev.filter(r => r.id !== id));
  }

  function shareResource(id: string) {
    if (!shareTarget.trim()) return;
    setResources(prev => prev.map(r =>
      r.id === id
        ? { ...r, sharedWith: [...new Set([...(r.sharedWith ?? []), shareTarget.trim()])] }
        : r
    ));
    setSharingId(null);
    setShareTarget('');
  }

  function save() {
    updateActor(actor.id, { resources });
    closeResourcesModal();
  }

  const otherActors = allActors.filter(a => a.id !== actor.id);

  return (
    <div className="cs-modal-overlay" onMouseDown={closeResourcesModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">📦 Resources — {actor.name}</span>
          <button className="cs-modal-close" onClick={closeResourcesModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          {resources.length === 0 && !adding && (
            <p className="cs-modal-empty">No resources yet. Click <strong>+ Add Resource</strong> to create one.</p>
          )}

          {resources.map(r => {
            const locked = isLocked(r, running);
            return (
              <div key={r.id} className={`cs-modal-event-item${locked ? ' cs-resource-locked' : ''}`}>
                <div className="cs-modal-event-header">
                  <span className="cs-resource-type-badge">{TYPE_LABELS[r.type] ?? r.type}</span>
                  <span className="cs-modal-event-name" style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
                  {locked && <span className="cs-resource-lock" title="Locked">🔒</span>}
                  {r.sharedWith?.length ? (
                    <span className="cs-modal-hint" title={`Shared with: ${r.sharedWith.join(', ')}`}>
                      shared ({r.sharedWith.length})
                    </span>
                  ) : null}
                  {!locked && otherActors.length > 0 && (
                    <button
                      className="cs-modal-btn"
                      style={{ padding: '1px 8px', fontSize: 10 }}
                      onClick={() => { setSharingId(r.id); setShareTarget(''); }}
                      title="Share with another actor"
                    >Share</button>
                  )}
                  {!locked && (
                    <button className="cs-modal-remove-btn" onClick={() => removeResource(r.id)}>✕</button>
                  )}
                </div>

                <div className="cs-resource-uri">
                  <span className="cs-actor-section-label">uri</span>
                  <span className="cs-actor-model">{r.uri}</span>
                </div>

                {r.description && (
                  <div className="cs-resource-uri">
                    <span className="cs-actor-section-label">desc</span>
                    <span style={{ fontSize: 11, color: 'var(--cs-text-muted)' }}>{r.description}</span>
                  </div>
                )}

                {sharingId === r.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <select
                      className="cs-prop-select"
                      value={shareTarget}
                      onChange={e => setShareTarget(e.target.value)}
                      style={{ flex: 1 }}
                    >
                      <option value="">— select actor —</option>
                      {otherActors.map(a => (
                        <option key={a.id} value={a.name}>{a.name}</option>
                      ))}
                    </select>
                    <button className="cs-modal-btn cs-modal-btn--primary" onClick={() => shareResource(r.id)}>Share</button>
                    <button className="cs-modal-btn" onClick={() => setSharingId(null)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}

          {adding && (
            <div className="cs-modal-event-item">
              <div className="cs-modal-event-header">
                <span className="cs-modal-event-section">New resource</span>
                <button className="cs-modal-remove-btn" onClick={() => setAdding(false)}>✕</button>
              </div>

              <label className="cs-prop-label">
                Name
                <input
                  className="cs-prop-input"
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="my-config"
                  autoFocus
                />
              </label>

              <label className="cs-prop-label">
                Type
                <select className="cs-prop-select" value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value as AgentResource['type'] }))}>
                  {RESOURCE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </label>

              <label className="cs-prop-label">
                URI / path
                <span className="cs-modal-hint"> — file path, URL, or inline text</span>
                <input
                  className="cs-prop-input"
                  value={draft.uri}
                  onChange={e => setDraft(d => ({ ...d, uri: e.target.value }))}
                  placeholder={draft.type === 'file' ? 'data/config.json' : draft.type === 'api' ? 'https://api.example.com' : 'inline content or reference'}
                />
              </label>

              <label className="cs-prop-label cs-modal-optional">
                Description
                <input
                  className="cs-prop-input"
                  value={draft.description ?? ''}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="What this resource provides"
                />
              </label>

              <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                <button className="cs-modal-btn cs-modal-btn--primary" onClick={addResource} disabled={!draft.name.trim() || !draft.uri.trim()}>
                  Add
                </button>
                <button className="cs-modal-btn" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn" style={{ marginRight: 'auto' }} onClick={() => setAdding(true)} disabled={adding}>
            + Add Resource
          </button>
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save</button>
          <button className="cs-modal-btn" onClick={closeResourcesModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ResourcesModal() {
  const { graph, resourcesModalActorId } = useStore();
  if (!resourcesModalActorId) return null;
  const actor = graph.actors.find(a => a.id === resourcesModalActorId);
  if (!actor) return null;
  return <Inner key={resourcesModalActorId} actor={actor} />;
}
