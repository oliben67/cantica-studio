import React from 'react';
import type { AIActorDef, ActorEdgeDef, CanticaPrompt, CronJobDef, PromptEventDef, PromptRef } from '../types';
import { useStore } from '../store';

const PROVIDERS = ['claude', 'gpt', 'gemini', 'mistral', 'deepseek'];

function PromptRefInput({ value, onChange, prompts, placeholder }: {
  value: PromptRef;
  onChange: (v: PromptRef) => void;
  prompts: CanticaPrompt[];
  placeholder?: string;
}) {
  const raw = value.uri ?? value.content ?? '';
  return (
    <div className="cs-prop-prompt-row">
      <input
        className="cs-prop-input"
        value={raw}
        placeholder={placeholder ?? 'cantica:// URI or raw text'}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v.startsWith('cantica://') ? { uri: v } : { content: v });
        }}
        list="cs-prompt-datalist"
      />
      <datalist id="cs-prompt-datalist">
        {prompts.map((p) => (
          <option key={`${p._server}/${p.namespace}/${p.name}`}
            value={`cantica://${p.namespace}/${p.name}`}
            label={`${p.namespace}/${p.name}`} />
        ))}
      </datalist>
    </div>
  );
}

// ── Actor properties ──────────────────────────────────────────────────────────

function ActorProps({ actor }: { actor: AIActorDef }) {
  const { updateActor, removeActor, prompts } = useStore();
  const up = (patch: Partial<AIActorDef>) => updateActor(actor.id, patch);

  function addEvent() {
    up({ promptEvents: [...actor.promptEvents, { name: 'new-event', prompt: {} }] });
  }
  function updateEvent(i: number, newEvt: PromptEventDef) {
    up({ promptEvents: actor.promptEvents.map((e, j) => (j === i ? newEvt : e)) });
  }
  function removeEvent(i: number) {
    up({ promptEvents: actor.promptEvents.filter((_, j) => j !== i) });
  }
  function addCron() {
    up({ cronJobs: [...actor.cronJobs, { schedule: '0 9 * * 1-5', prompt: {} }] });
  }
  function updateCron(i: number, patch: Partial<CronJobDef>) {
    const crons = actor.cronJobs.map((c, j) => (j === i ? { ...c, ...patch } : c));
    up({ cronJobs: crons });
  }
  function removeCron(i: number) {
    up({ cronJobs: actor.cronJobs.filter((_, j) => j !== i) });
  }

  return (
    <div className="cs-props-body">
      <label className="cs-prop-label">Name
        <input className="cs-prop-input" value={actor.name} onChange={(e) => up({ name: e.target.value })} />
      </label>

      <label className="cs-prop-label">Define Prompt (role)
        <PromptRefInput value={actor.definePrompt} onChange={(v) => up({ definePrompt: v })} prompts={prompts} />
      </label>

      <div className="cs-prop-row">
        <label className="cs-prop-label cs-prop-half">Provider
          <select className="cs-prop-select" value={actor.provider} onChange={(e) => up({ provider: e.target.value })}>
            {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="cs-prop-label cs-prop-half">Model
          <input className="cs-prop-input" value={actor.model} onChange={(e) => up({ model: e.target.value })} />
        </label>
      </div>

      <div className="cs-prop-row">
        <label className="cs-prop-label cs-prop-half">Max tokens
          <input className="cs-prop-input" type="number" value={actor.maxTokens}
            onChange={(e) => up({ maxTokens: Number(e.target.value) })} />
        </label>
        <label className="cs-prop-label cs-prop-half">History turns
          <input className="cs-prop-input" type="number" value={actor.maxHistory}
            onChange={(e) => up({ maxHistory: Number(e.target.value) })} />
        </label>
      </div>

      {/* Prompt events */}
      <div className="cs-prop-section-header">
        <span>⚡ Prompt Events</span>
        <button className="cs-prop-add-btn" onClick={addEvent}>+ Add</button>
      </div>
      {actor.promptEvents.map((evt, i) => (
        <div key={i} className="cs-prop-list-item">
          <div className="cs-prop-row">
            <input className="cs-prop-input cs-prop-half" placeholder="event name"
              value={evt.name} onChange={(e) => updateEvent(i, { ...evt, name: e.target.value })} />
            <input className="cs-prop-input cs-prop-half" placeholder="file pattern (optional)"
              value={evt.filePattern ?? ''}
              onChange={(e) => {
                const fp = e.target.value;
                updateEvent(i, fp ? { ...evt, filePattern: fp } : { name: evt.name, prompt: evt.prompt });
              }} />
          </div>
          <PromptRefInput value={evt.prompt} onChange={(v) => updateEvent(i, { ...evt, prompt: v })} prompts={prompts}
            placeholder="Prompt URI or content" />
          <button className="cs-prop-remove-btn" onClick={() => removeEvent(i)}>✕ Remove</button>
        </div>
      ))}

      {/* Cron jobs */}
      <div className="cs-prop-section-header">
        <span>🕐 Cron Jobs</span>
        <button className="cs-prop-add-btn" onClick={addCron}>+ Add</button>
      </div>
      {actor.cronJobs.map((c, i) => (
        <div key={i} className="cs-prop-list-item">
          <input className="cs-prop-input" placeholder="cron schedule (e.g. 0 9 * * 1-5)"
            value={c.schedule} onChange={(e) => updateCron(i, { schedule: e.target.value })} />
          <PromptRefInput value={c.prompt} onChange={(v) => updateCron(i, { prompt: v })} prompts={prompts} />
          <button className="cs-prop-remove-btn" onClick={() => removeCron(i)}>✕ Remove</button>
        </div>
      ))}

      <button className="cs-prop-danger-btn" onClick={() => removeActor(actor.id)}>Delete Actor</button>
    </div>
  );
}

// ── Edge properties ───────────────────────────────────────────────────────────

function EdgeProps_({ edge }: { edge: ActorEdgeDef }) {
  const { updateEdge, removeEdge, prompts, graph } = useStore();
  const up = (patch: Partial<ActorEdgeDef>) => updateEdge(edge.id, patch);
  const fromActor = graph.actors.find((a) => a.id === edge.from);
  const availableEvents = fromActor?.promptEvents.map((e) => e.name) ?? [];

  return (
    <div className="cs-props-body">
      <label className="cs-prop-label">Label
        <input className="cs-prop-input" value={edge.label} onChange={(e) => up({ label: e.target.value })} />
      </label>

      <label className="cs-prop-label">Target Event (optional)
        <select className="cs-prop-select" value={edge.targetEvent ?? ''}
          onChange={(e) => {
            const te = e.target.value;
            up(te ? { targetEvent: te } : {});
          }}>
          <option value="">— default inbox —</option>
          {availableEvents.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>

      <label className="cs-prop-label">Message Prompt
        <PromptRefInput value={edge.prompt} onChange={(v) => up({ prompt: v })} prompts={prompts}
          placeholder="Use {output} as placeholder for the source actor's output" />
      </label>

      <button className="cs-prop-danger-btn" onClick={() => removeEdge(edge.id)}>Delete Edge</button>
    </div>
  );
}

// ── Panel wrapper ─────────────────────────────────────────────────────────────

export function ActorPropertiesPanel() {
  const { selectedActorId, selectedEdgeId, graph } = useStore();

  const actor = selectedActorId ? graph.actors.find((a) => a.id === selectedActorId) : null;
  const edge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : null;

  if (!actor && !edge) {
    return (
      <div className="cs-props-empty">
        <p>Select an actor or edge to edit its properties.</p>
      </div>
    );
  }

  return (
    <div className="cs-props-panel">
      <div className="cs-props-header">
        {actor ? `Actor: ${actor.name}` : `Edge: ${edge?.label || 'unnamed'}`}
      </div>
      {actor && <ActorProps actor={actor} />}
      {edge && <EdgeProps_ edge={edge} />}
    </div>
  );
}
