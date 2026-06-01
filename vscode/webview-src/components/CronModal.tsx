import React, { useState } from 'react';
import { useStore } from '../store';
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

type Draft = { id: string; schedule: string; promptContent: string; targetActor: string; targetEvent: string };

let _seq = 0;
const uid = () => `c${Date.now()}${++_seq}`;

function Inner({ actor }: { actor: AIActorDef }) {
  const { graph, updateActor, addEdge, closeCronsModal } = useStore();
  const allActors = graph.actors;

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    actor.cronJobs.map(c => ({
      id: uid(),
      schedule: c.schedule,
      promptContent: c.prompt.content ?? c.prompt.uri ?? '',
      targetActor: c.targetActor ?? '',
      targetEvent: c.targetEvent ?? '',
    }))
  );

  function add() {
    setDrafts(prev => [...prev, { id: uid(), schedule: '* * * * *', promptContent: '', targetActor: '', targetEvent: '' }]);
  }
  function setSchedule(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, schedule: v } : d)); }
  function setPrompt(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, promptContent: v } : d)); }
  function setTarget(id: string, v: string) {
    setDrafts(p => p.map(d => d.id === id ? { ...d, targetActor: v, targetEvent: '' } : d));
  }
  function setTargetEvent(id: string, v: string) { setDrafts(p => p.map(d => d.id === id ? { ...d, targetEvent: v } : d)); }
  function remove(id: string) { setDrafts(p => p.filter(d => d.id !== id)); }

  function save() {
    const crons = drafts
      .filter(d => d.schedule.trim())
      .map(d => ({
        schedule: d.schedule.trim(),
        prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        ...(d.targetActor.trim() ? { targetActor: d.targetActor.trim() } : {}),
        ...(d.targetEvent.trim() ? { targetEvent: d.targetEvent.trim() } : {}),
      }));
    updateActor(actor.id, { cronJobs: crons });

    // Ensure graph edges exist for cross-actor targets
    for (const d of drafts) {
      if (!d.schedule.trim() || !d.targetActor.trim()) continue;
      const targetActorDef = allActors.find(a => a.name === d.targetActor.trim());
      if (!targetActorDef || targetActorDef.id === actor.id) continue;
      const label = `cron:${d.schedule.trim()}`;
      const edgeExists = graph.edges.some(
        e => e.from === actor.id && e.to === targetActorDef.id && e.label === label
      );
      if (!edgeExists) {
        const edge: Parameters<typeof addEdge>[0] = {
          from: actor.id,
          to: targetActorDef.id,
          label,
          prompt: d.promptContent.trim() ? { content: d.promptContent.trim() } : { content: '' },
        };
        if (d.targetEvent.trim()) edge.targetEvent = d.targetEvent.trim();
        addEdge(edge);
      }
    }

    closeCronsModal();
  }

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

            return (
              <div key={d.id} className="cs-modal-event-item">
                <div className="cs-modal-event-header">
                  <span className="cs-modal-event-section">Schedule</span>
                  <button className="cs-modal-remove-btn" onClick={() => remove(d.id)}>✕</button>
                </div>

                <CronBuilder value={d.schedule} onChange={v => setSchedule(d.id, v)} />

                <label className="cs-prop-label" style={{ marginTop: 6 }}>
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
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save</button>
          <button className="cs-modal-btn" onClick={closeCronsModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function CronModal() {
  const { graph, cronsModalActorId } = useStore();
  if (!cronsModalActorId) return null;
  const actor = graph.actors.find(a => a.id === cronsModalActorId);
  if (!actor) return null;
  return <Inner key={cronsModalActorId} actor={actor} />;
}
