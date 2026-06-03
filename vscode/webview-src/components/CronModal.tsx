import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { computeActorEdges } from '../edgeUtils';
import type { AIActorDef } from '../types';

const CRON_FIELDS = ['min', 'hour', 'day', 'month', 'weekday'] as const;

function parseCron(expr: string): string[] {
  const parts = expr.trim().split(/\s+/);
  return CRON_FIELDS.map((_, i) => parts[i] ?? '*');
}

function CronBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = parseCron(value);
  function updateField(idx: number, v: string) {
    const next = parseCron(value);
    next[idx] = v.trim() || '*';
    onChange(next.join(' '));
  }
  return (
    <div className="cs-cron-builder">
      {CRON_FIELDS.map((label, i) => (
        <div key={label} className="cs-cron-field">
          <input
            className="cs-prop-input cs-cron-input"
            value={parts[i] ?? '*'}
            onChange={e => updateField(i, e.target.value)}
            title={label}
          />
          <span className="cs-cron-label">{label}</span>
        </div>
      ))}
      <code className="cs-cron-expr">{value}</code>
    </div>
  );
}

type Draft = { id: string; name: string; schedule: string; promptContent: string; targetActor: string; targetEvent: string };

let _seq = 0;
const uid = () => `c${Date.now()}${++_seq}`;

function Inner({ actor, focusLabel }: { actor: AIActorDef; focusLabel: string | null }) {
  const { graph, updateActor, replaceActorEdges, closeCronsModal } = useStore();
  const allActors = graph.actors;
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    actor.cronJobs.map(c => ({
      id: uid(),
      name: c.name ?? '',
      schedule: c.schedule,
      promptContent: c.prompt.content ?? c.prompt.uri ?? '',
      targetActor: c.targetActor ?? '',
      targetEvent: c.targetEvent ?? '',
    }))
  );

  function add() {
    setDrafts(prev => [...prev, { id: uid(), name: '', schedule: '* * * * *', promptContent: '', targetActor: '', targetEvent: '' }]);
  }
  function setName(id: string, v: string)     { setDrafts(p => p.map(d => d.id === id ? { ...d, name: v } : d)); }
  function setSchedule(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, schedule: v } : d)); }
  function setPrompt(id: string, v: string)   { setDrafts(p => p.map(d => d.id === id ? { ...d, promptContent: v } : d)); }
  function setTarget(id: string, v: string) {
    setDrafts(p => p.map(d => d.id === id ? { ...d, targetActor: v, targetEvent: '' } : d));
  }
  function setTargetEvent(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, targetEvent: v } : d)); }
  function remove(id: string) { setDrafts(p => p.filter(d => d.id !== id)); }

  function buildCrons() {
    return drafts
      .filter(d => d.schedule.trim())
      .map(d => ({
        ...(d.name.trim() ? { name: d.name.trim() } : {}),
        schedule: d.schedule.trim(),
        prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        ...(d.targetActor.trim() ? { targetActor: d.targetActor.trim() } : {}),
        ...(d.targetEvent.trim() ? { targetEvent: d.targetEvent.trim() } : {}),
      }));
  }

  function commitCrons() {
    const crons = buildCrons();
    const updatedActor = { ...actor, cronJobs: crons };
    updateActor(actor.id, { cronJobs: crons });
    replaceActorEdges(actor.id, computeActorEdges(updatedActor, allActors));
  }

  // 💾 per-entry: persist current state, keep modal open
  function saveEntry() { commitCrons(); }

  // Save All: persist and close
  function save() { commitCrons(); closeCronsModal(); }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeCronsModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">⏱ Cron Jobs — {actor.name}</span>
          <button className="cs-modal-close" onClick={closeCronsModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          {drafts.length === 0 && (
            <p className="cs-modal-empty">No cron jobs yet. Click <strong>+ Add Cron</strong> to create one.</p>
          )}
          {drafts.map(d => {
            const crossActor = d.targetActor.trim() && d.targetActor.trim() !== actor.name;
            const targetActorDef = crossActor
              ? allActors.find(a => a.name === d.targetActor.trim())
              : null;
            const isFocused = !!focusLabel && d.schedule === focusLabel;

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
                    placeholder="cron-name (optional label)"
                    autoComplete="off"
                  />
                  <button className="cs-modal-save-btn" title="Save (keep open)" onClick={saveEntry}>💾</button>
                  <button className="cs-modal-remove-btn" onClick={() => remove(d.id)}>✕</button>
                </div>

                <CronBuilder value={d.schedule} onChange={v => setSchedule(d.id, v)} />

                <label className="cs-prop-label" style={{ marginTop: 6 }}>
                  Route to
                  <span className="cs-modal-hint"> — target actor (empty = self, creates a graph edge)</span>
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

                <label className="cs-prop-label" style={{ marginTop: 4 }}>
                  Prompt
                  <span className="cs-modal-hint"> — what the actor should do on this schedule</span>
                  <textarea
                    className="cs-prop-input cs-modal-textarea"
                    value={d.promptContent}
                    onChange={e => setPrompt(d.id, e.target.value)}
                    placeholder="Describe what the actor should do when the cron triggers…"
                    rows={3}
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn" style={{ marginRight: 'auto' }} onClick={add}>+ Add Cron</button>
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save All</button>
          <button className="cs-modal-btn" onClick={closeCronsModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function CronModal() {
  const { graph, cronsModalActorId, cronsModalFocusLabel } = useStore();
  if (!cronsModalActorId) return null;
  const actor = graph.actors.find(a => a.id === cronsModalActorId);
  if (!actor) return null;
  return <Inner key={cronsModalActorId} actor={actor} focusLabel={cronsModalFocusLabel} />;
}
