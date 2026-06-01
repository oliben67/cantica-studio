import React, { useState } from 'react';
import { useStore } from '../store';
import type { AIActorDef } from '../types';
import { vscode } from '../vscode';

type Draft = {
  id: string;
  name: string;
  promptContent: string;
  filePattern: string;
  targetActor: string;
  targetEvent: string;
};

let _seq = 0;
const uid = () => `e${Date.now()}${++_seq}`;

function Inner({ actor }: { actor: AIActorDef }) {
  const { graph, updateActor, addEdge, closeEventsModal } = useStore();
  const allActors = graph.actors;

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    actor.promptEvents.map(e => ({
      id: uid(),
      name: e.name,
      promptContent: e.prompt.content ?? e.prompt.uri ?? '',
      filePattern: e.filePattern ?? '',
      targetActor: e.targetActor ?? '',
      targetEvent: e.targetEvent ?? '',
    }))
  );

  function add() {
    setDrafts(prev => [...prev, { id: uid(), name: '', promptContent: '', filePattern: '', targetActor: '', targetEvent: '' }]);
  }
  function setName(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, name: v } : d)); }
  function setPrompt(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, promptContent: v } : d)); }
  function setPattern(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, filePattern: v } : d)); }
  function setTarget(id: string, v: string) {
    setDrafts(p => p.map(d => d.id === id ? { ...d, targetActor: v, targetEvent: '' } : d));
  }
  function setTargetEvent(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, targetEvent: v } : d)); }
  function remove(id: string) { setDrafts(p => p.filter(d => d.id !== id)); }
  function fire(d: Draft) {
    if (d.name.trim() && actor) {
      vscode.postMessage({ type: 'fireEvent', name: actor.name, eventName: d.name.trim(), context: '' });
    }
  }

  function save() {
    const events = drafts
      .filter(d => d.name.trim())
      .map(d => ({
        name: d.name.trim(),
        prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        ...(d.filePattern.trim() ? { filePattern: d.filePattern.trim() } : {}),
        ...(d.targetActor.trim() ? { targetActor: d.targetActor.trim() } : {}),
        ...(d.targetEvent.trim() ? { targetEvent: d.targetEvent.trim() } : {}),
      }));
    updateActor(actor.id, { promptEvents: events });

    // Ensure graph edges exist for cross-actor targets
    for (const d of drafts) {
      if (!d.name.trim() || !d.targetActor.trim()) continue;
      const targetActorDef = allActors.find(a => a.name === d.targetActor.trim());
      if (!targetActorDef || targetActorDef.id === actor.id) continue;
      const edgeExists = graph.edges.some(
        e => e.from === actor.id && e.to === targetActorDef.id &&
             e.label === d.name.trim()
      );
      if (!edgeExists) {
        const edge: Parameters<typeof addEdge>[0] = {
          from: actor.id,
          to: targetActorDef.id,
          label: d.name.trim(),
          prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        };
        if (d.targetEvent.trim()) edge.targetEvent = d.targetEvent.trim();
        addEdge(edge);
      }
    }

    closeEventsModal();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeEventsModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">⚡ Events — {actor.name}</span>
          <button className="cs-modal-close" onClick={closeEventsModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          {drafts.length === 0 && (
            <p className="cs-modal-empty">No events yet. Click <strong>+ Add Event</strong> to create one.</p>
          )}
          {drafts.map(d => {
            const crossActor = d.targetActor.trim() && d.targetActor.trim() !== actor.name;
            const targetActorDef = crossActor
              ? allActors.find(a => a.name === d.targetActor.trim())
              : null;

            return (
              <div key={d.id} className="cs-modal-event-item">
                <div className="cs-modal-event-header">
                  <input
                    className="cs-prop-input cs-modal-event-name"
                    value={d.name}
                    onChange={e => setName(d.id, e.target.value)}
                    placeholder="event-name"
                    autoComplete="off"
                  />
                  <button className="cs-fire-btn" title="Fire now" onClick={() => fire(d)} disabled={!d.name.trim()}>▶</button>
                  <button className="cs-modal-remove-btn" onClick={() => remove(d.id)}>✕</button>
                </div>

                <label className="cs-prop-label">
                  Send to
                  <span className="cs-modal-hint"> — target actor (empty = self)</span>
                  <select className="cs-prop-select" value={d.targetActor} onChange={e => setTarget(d.id, e.target.value)}>
                    <option value="">self (default)</option>
                    {allActors.filter(a => a.id !== actor.id).map(a => (
                      <option key={a.id} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                </label>

                {crossActor && targetActorDef && targetActorDef.promptEvents.length > 0 && (
                  <label className="cs-prop-label">
                    Target event on <em>{d.targetActor}</em>
                    <span className="cs-modal-hint"> — fire a specific event, or leave empty for direct prompt</span>
                    <select className="cs-prop-select" value={d.targetEvent} onChange={e => setTargetEvent(d.id, e.target.value)}>
                      <option value="">direct prompt (no event)</option>
                      {targetActorDef.promptEvents.map(ev => (
                        <option key={ev.name} value={ev.name}>⚡ {ev.name}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="cs-prop-label">
                  Prompt
                  <span className="cs-modal-hint"> — what to do / send when this event fires</span>
                  <textarea
                    className="cs-prop-input cs-modal-textarea"
                    value={d.promptContent}
                    onChange={e => setPrompt(d.id, e.target.value)}
                    placeholder="Describe what happens when this event fires…"
                    rows={3}
                  />
                </label>

                <label className="cs-prop-label cs-modal-optional">
                  File pattern
                  <span className="cs-modal-hint"> — optional, triggers on file save</span>
                  <input
                    className="cs-prop-input"
                    value={d.filePattern}
                    onChange={e => setPattern(d.id, e.target.value)}
                    placeholder="src/**/*.ts"
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn" style={{ marginRight: 'auto' }} onClick={add}>+ Add Event</button>
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save</button>
          <button className="cs-modal-btn" onClick={closeEventsModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function EventsModal() {
  const { graph, eventsModalActorId } = useStore();
  if (!eventsModalActorId) return null;
  const actor = graph.actors.find(a => a.id === eventsModalActorId);
  if (!actor) return null;
  return <Inner key={eventsModalActorId} actor={actor} />;
}
