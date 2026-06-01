import React, { useState } from 'react';
import { useStore } from '../store';
import type { ActorEdgeDef, PromptRef } from '../types';

interface Props {
  fromActorId: string;
  preselectedToId?: string;
  existingEdgeId?: string;
  onClose: () => void;
}

export function PromptModal({ fromActorId, preselectedToId, existingEdgeId, onClose }: Props) {
  const { graph, addEdge, updateEdge, removeEdge } = useStore();
  const actors = graph.actors;
  const existingEdge = existingEdgeId ? graph.edges.find(e => e.id === existingEdgeId) : undefined;
  const fromActor = actors.find(a => a.id === fromActorId);

  const defaultTo =
    existingEdge?.to ??
    preselectedToId ??
    actors.find(a => a.id !== fromActorId)?.id ??
    fromActorId;

  const [toActorId, setToActorId] = useState(defaultTo);
  const [label, setLabel] = useState(existingEdge?.label ?? 'message');
  const [targetEvent, setTargetEvent] = useState(existingEdge?.targetEvent ?? '');
  const [promptUri, setPromptUri] = useState(existingEdge?.prompt.uri ?? '');
  const [promptContent, setPromptContent] = useState(existingEdge?.prompt.content ?? '');

  function handleSubmit() {
    const prompt: PromptRef = promptUri.trim() ? { uri: promptUri.trim() } : { content: promptContent };
    const evt = targetEvent.trim() || undefined;
    if (existingEdgeId) {
      const patch: Partial<ActorEdgeDef> = { to: toActorId, label, prompt };
      if (evt !== undefined) patch.targetEvent = evt;
      updateEdge(existingEdgeId, patch);
    } else {
      const edge: Omit<ActorEdgeDef, 'id'> = { from: fromActorId, to: toActorId, label, prompt };
      if (evt !== undefined) edge.targetEvent = evt;
      addEdge(edge);
    }
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={onClose} onKeyDown={handleKey}>
      <div className="cs-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">{existingEdgeId ? 'Edit Connection' : 'New Connection'}</span>
          <button className="cs-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cs-modal-body">
          <div className="cs-modal-from">
            <span className="cs-actor-badge" style={{ background: '#7c3aed', marginRight: 6 }}>from</span>
            <strong>{fromActor?.name ?? fromActorId}</strong>
          </div>

          <label className="cs-prop-label">
            To actor
            <select className="cs-prop-select" value={toActorId} onChange={e => setToActorId(e.target.value)}>
              {actors.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.id === fromActorId ? ' (self)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="cs-prop-label">
            Label
            <input className="cs-prop-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="message" />
          </label>

          <label className="cs-prop-label">
            Target event <span style={{ opacity: 0.55, fontSize: 10 }}>(optional)</span>
            <input className="cs-prop-input" value={targetEvent} onChange={e => setTargetEvent(e.target.value)} placeholder="event-name" />
          </label>

          <label className="cs-prop-label">
            Prompt URI
            <input className="cs-prop-input" value={promptUri} onChange={e => setPromptUri(e.target.value)} placeholder="cantica://namespace/prompt" />
          </label>

          <label className="cs-prop-label">
            Inline prompt
            <textarea
              className="cs-prop-input cs-modal-textarea"
              value={promptContent}
              onChange={e => setPromptContent(e.target.value)}
              placeholder="Write prompt content here…"
              rows={4}
            />
          </label>
        </div>

        <div className="cs-modal-footer">
          {existingEdgeId && (
            <button
              className="cs-modal-btn cs-modal-btn--danger"
              onClick={() => { removeEdge(existingEdgeId); onClose(); }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={handleSubmit}>
            {existingEdgeId ? 'Update' : 'Create'}
          </button>
          <button className="cs-modal-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
