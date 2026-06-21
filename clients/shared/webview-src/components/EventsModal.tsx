import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { computeActorEdges } from '../edgeUtils';
import type { AIActorDef } from '../types';
import { vscode } from '../vscode';

type Draft = {
  id: string;
  name: string;
  promptContent: string;
  filePattern: string;
  targetActors: string[];   // empty = self
  sendResponse: boolean;
};

let _seq = 0;
const uid = () => `e${Date.now()}${++_seq}`;

function Inner({ actor, focusLabel }: { actor: AIActorDef; focusLabel: string | null }) {
  const { graph, updateActor, replaceActorEdges, closeEventsModal, runningActors } = useStore();
  const isRunning = runningActors.has(actor.name);
  const allActors = graph.actors;
  const otherActors = allActors.filter(a => a.id !== actor.id);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    actor.promptEvents.map(e => ({
      id: uid(),
      name: e.name,
      promptContent: e.prompt.content ?? e.prompt.uri ?? '',
      filePattern: e.filePattern ?? '',
      targetActors: e.targetActors ?? [],
      sendResponse: e.sendResponse ?? false,
    }))
  );

  function add() {
    setDrafts(prev => [...prev, { id: uid(), name: '', promptContent: '', filePattern: '', targetActors: [], sendResponse: false }]);
  }
  function setName(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, name: v } : d)); }
  function setPrompt(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, promptContent: v } : d)); }
  function setPattern(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, filePattern: v } : d)); }
  function toggleTarget(id: string, actorName: string, checked: boolean) {
    setDrafts(p => p.map(d => d.id === id ? {
      ...d,
      targetActors: checked
        ? [...d.targetActors, actorName]
        : d.targetActors.filter(n => n !== actorName),
    } : d));
  }
  function setSendResponse(id: string, v: boolean) { setDrafts(p => p.map(d => d.id === id ? { ...d, sendResponse: v } : d)); }
  function remove(id: string) { setDrafts(p => p.filter(d => d.id !== id)); }

  function buildEvents() {
    return drafts
      .filter(d => d.name.trim())
      .map(d => ({
        name: d.name.trim(),
        prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        ...(d.filePattern.trim() ? { filePattern: d.filePattern.trim() } : {}),
        ...(d.targetActors.length ? { targetActors: d.targetActors } : {}),
        ...(d.sendResponse ? { sendResponse: true } : {}),
      }));
  }

  function commitEvents() {
    const events = buildEvents();
    const updatedActor = { ...actor, promptEvents: events };
    updateActor(actor.id, { promptEvents: events });
    replaceActorEdges(actor.id, computeActorEdges(updatedActor, allActors));
  }

  // 💾 per-entry: persist current state, keep modal open
  function saveEntry() { commitEvents(); }

  // Save All: persist and close
  function save() { commitEvents(); closeEventsModal(); }

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
            const isFocused = !!focusLabel && d.name === focusLabel;
            return (
            <div
              key={d.id}
              ref={isFocused ? focusRef : null}
              className={`cs-modal-event-item${isFocused ? ' cs-modal-event-item--focused' : ''}`}
            >
              <div className="cs-modal-event-header">
                <input
                  className="cs-prop-input cs-modal-event-name"
                  value={d.name}
                  onChange={e => setName(d.id, e.target.value)}
                  placeholder="event-name"
                  autoComplete="off"
                />
                {isRunning && d.name.trim() && (
                  <button
                    className="cs-modal-save-btn"
                    title={`Fire "${d.name}" event now`}
                    onClick={() => vscode.postMessage({ type: 'fireEvent', name: actor.name, eventName: d.name.trim(), context: '' })}
                  >▶</button>
                )}
                <button className="cs-modal-save-btn" title="Save (keep open)" onClick={saveEntry}>💾</button>
                <button className="cs-modal-remove-btn" disabled={isRunning} title={isRunning ? 'Stop the actor to remove events' : undefined} onClick={() => remove(d.id)}>✕</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                <label className="cs-prop-label" style={{ marginBottom: 0 }}>
                  Prompt
                  <span className="cs-modal-hint"> — instruction sent when this event fires</span>
                </label>
                {d.targetActors.length > 0 && (
                  <label className="cs-send-response-label" style={{ fontSize: 11 }}>
                    <input
                      type="checkbox"
                      checked={d.sendResponse}
                      onChange={e => setSendResponse(d.id, e.target.checked)}
                      style={{ marginRight: 4 }}
                    />
                    Send response
                    <span
                      className="cs-modal-hint"
                      title="Checked: this actor's LLM runs on the prompt first, then its response is forwarded to the target. Unchecked: the prompt is sent directly to the target without consulting this actor."
                      style={{ cursor: 'help', marginLeft: 3 }}
                    >ⓘ</span>
                  </label>
                )}
              </div>
              <textarea
                className="cs-prop-input cs-modal-textarea"
                value={d.promptContent}
                onChange={e => setPrompt(d.id, e.target.value)}
                placeholder="Describe what happens when this event fires…"
                rows={3}
              />

              <label className="cs-prop-label">
                Send to
                <span className="cs-modal-hint"> — none = self only</span>
              </label>
              <div className="cs-actor-checks">
                {otherActors.length === 0 ? (
                  <span className="cs-modal-hint">No other actors — routes to self</span>
                ) : (
                  otherActors.map(a => (
                    <label key={a.id} className="cs-actor-check-label">
                      <input
                        type="checkbox"
                        checked={d.targetActors.includes(a.name)}
                        onChange={e => toggleTarget(d.id, a.name, e.target.checked)}
                      />
                      {a.name}
                    </label>
                  ))
                )}
                {d.targetActors.length === 0 && otherActors.length > 0 && (
                  <span className="cs-modal-hint cs-modal-self-note">→ self (default)</span>
                )}
              </div>

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
          <button
            className="cs-modal-btn"
            style={{ marginRight: 'auto' }}
            disabled={isRunning}
            title={isRunning ? 'Stop the actor to add new events' : undefined}
            onClick={add}
          >+ Add Event</button>
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save All</button>
          <button className="cs-modal-btn" onClick={closeEventsModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function EventsModal() {
  const { graph, eventsModalActorId, eventsModalFocusLabel } = useStore();
  if (!eventsModalActorId) return null;
  const actor = graph.actors.find(a => a.id === eventsModalActorId);
  if (!actor) return null;
  return <Inner key={eventsModalActorId} actor={actor} focusLabel={eventsModalFocusLabel} />;
}
