import React, { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AIActorDef } from '../types';
import { useStore } from '../store';
import { vscode } from '../vscode';
import { PROVIDERS } from './ProviderMenu';

export type ActorNodeData = { actor: AIActorDef };
export type ActorNodeType = { id: string; type: 'actorNode'; position: { x: number; y: number }; data: ActorNodeData };

export const ActorNode = memo(function ActorNode({ data, selected }: NodeProps) {
  const actor = (data as ActorNodeData).actor;
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(actor.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    runningActors, actorOutputs, selectActor, updateActor,
    openEventsModal, openCronsModal, openActorMenu, openProviderMenu,
    actorLogsVisible,
  } = useStore();

  const running = runningActors.has(actor.name);
  const output = actorOutputs.get(actor.name);
  const logsVisible = actorLogsVisible[actor.id] ?? false;
  const providerInfo = PROVIDERS[actor.provider];
  const color = providerInfo?.color ?? '#6b7280';

  useEffect(() => { if (!editing) setNameVal(actor.name); }, [actor.name, editing]);
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  function commitName() {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== actor.name) updateActor(actor.id, { name: trimmed });
    else setNameVal(actor.name);
    setEditing(false);
  }

  function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    vscode.postMessage({ type: 'stopActor', name: actor.name });
  }

  return (
    <div
      className={`cs-actor-node${selected ? ' cs-actor-node--selected' : ''}${running ? ' cs-actor-node--running' : ''}`}
      onClick={() => selectActor(actor.id)}
    >
      <Handle type="target" position={Position.Left} className="cs-handle cs-handle--target" />
      <Handle type="source" position={Position.Right} className="cs-handle cs-handle--source" />

      {/* ── Header: status | provider | name | gear ── */}
      <div className="cs-actor-header">
        <span
          className={`cs-actor-status${running ? ' cs-actor-status--on' : ''}`}
          title={running ? 'running' : 'idle'}
        />

        <div
          className="cs-actor-provider"
          onClick={e => { e.stopPropagation(); openProviderMenu(actor.id, e.clientX, e.clientY); }}
          title="Click to change provider / model"
        >
          <span className="cs-actor-badge" style={{ background: color }}>
            {providerInfo?.label ?? actor.provider}
          </span>
        </div>

        {editing ? (
          <input
            ref={inputRef}
            className="cs-actor-name-input"
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setNameVal(actor.name); setEditing(false); }
              e.stopPropagation();
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="cs-actor-name"
            title="Click to rename"
            onClick={e => { e.stopPropagation(); setEditing(true); }}
          >{actor.name}</span>
        )}

        <button
          className="cs-actor-gear"
          title="Actor settings"
          onClick={e => { e.stopPropagation(); openActorMenu(actor.id, e.clientX, e.clientY); }}
        >⚙</button>
      </div>

      {/* ── Model row: model name | indicators (right) ── */}
      <div className="cs-actor-model-row">
        <span className="cs-actor-section-label">model</span>
        <span className="cs-actor-model">{actor.model}</span>
        {actor.promptEvents.length > 0 && (
          <button
            className="cs-actor-indicator"
            title={`${actor.promptEvents.length} event(s) — click to edit`}
            onClick={e => { e.stopPropagation(); openEventsModal(actor.id); }}
          >⚡</button>
        )}
        {actor.cronJobs.length > 0 && (
          <button
            className="cs-actor-indicator"
            title={`${actor.cronJobs.length} cron job(s) — click to edit`}
            onClick={e => { e.stopPropagation(); openCronsModal(actor.id); }}
          >⏱</button>
        )}
      </div>

      {/* ── Define prompt ── */}
      {(actor.definePrompt.uri || actor.definePrompt.content) && (
        <div className="cs-actor-define-prompt">
          <span className="cs-actor-section-label">role</span>
          <span className="cs-actor-prompt-ref">
            {actor.definePrompt.uri ?? (actor.definePrompt.content ?? '').slice(0, 50)}
          </span>
        </div>
      )}

      {/* ── Inline logs (toggled from ActorMenu) ── */}
      {logsVisible && (
        <div className="cs-actor-output">
          <span className="cs-actor-section-label">logs</span>
          {output ? (
            <p className="cs-actor-output-text">{output.slice(0, 240)}{output.length > 240 ? '…' : ''}</p>
          ) : (
            <p className="cs-actor-output-text" style={{ opacity: 0.45 }}>no output yet</p>
          )}
        </div>
      )}

      {/* ── Stop button when running ── */}
      {running && (
        <div className="cs-actor-footer">
          <button className="cs-actor-btn cs-actor-btn--stop" onClick={handleStop}>Stop</button>
        </div>
      )}
    </div>
  );
});
