import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AIActorDef, EdgeHandleInfo, HandleSide } from '../types';
import { useStore } from '../store';
import { vscode } from '../vscode';
import { PROVIDERS } from './ProviderMenu';

export type ActorNodeData = {
  actor: AIActorDef;
  outEdges: EdgeHandleInfo[];  // edges leaving this node → source handles on right
  inEdges: EdgeHandleInfo[];   // edges entering this node → target handles on left
};
export type ActorNodeType = { id: string; type: 'actorNode'; position: { x: number; y: number }; data: ActorNodeData };

// Distribute n handles evenly (never at 0% or 100%)
const pct = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;

const SIDE_POSITION: Record<HandleSide, Position> = {
  left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom,
};
// top/bottom handles offset by left%, left/right handles by top%
const handleStyle = (side: HandleSide, i: number, n: number) =>
  side === 'top' || side === 'bottom' ? { left: pct(i, n) } : { top: pct(i, n) };

function Handles({ edges, type }: { edges: EdgeHandleInfo[]; type: 'source' | 'target' }) {
  const prefix = type === 'source' ? 'out' : 'in';
  const sides: HandleSide[] = ['right', 'left', 'top', 'bottom'];
  const byClass = type === 'source' ? 'cs-handle--out' : 'cs-handle--in';
  if (edges.length === 0) {
    const fallbackPos = type === 'source' ? Position.Right : Position.Left;
    return <Handle type={type} position={fallbackPos} className={`cs-handle ${byClass} cs-handle--default`} />;
  }
  return (
    <>
      {sides.map(side => {
        const group = edges.filter(e => e.side === side);
        return group.map((e, i) => (
          <Handle
            key={`${prefix}-${e.id}`}
            id={`${prefix}-${e.id}`}
            type={type}
            position={SIDE_POSITION[side]}
            className={`cs-handle ${byClass} cs-handle--${e.kind ?? 'default'}`}
            style={handleStyle(side, i, group.length)}
            title={e.label}
          />
        ));
      })}
    </>
  );
}

function ActivityPanel({
  outputLines, scrollRef, onExpand, emptyLabel,
}: {
  outputLines: string[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onExpand: (e: React.MouseEvent) => void;
  emptyLabel: string;
}) {
  const lastTen = outputLines.slice(-10);
  return (
    <div className="cs-actor-output">
      <div className="cs-actor-output-header">
        <span className="cs-actor-section-label">activities</span>
        <button className="cs-actor-expand-btn" onClick={onExpand} title="Expand activities">⤢</button>
      </div>
      {lastTen.length > 0 ? (
        <div className="cs-actor-output-lines" ref={scrollRef}>
          {lastTen.map((line, i) => (
            <p key={i} className="cs-actor-output-text">{line}</p>
          ))}
        </div>
      ) : (
        <p className="cs-actor-output-text" style={{ opacity: 0.45 }}>{emptyLabel}</p>
      )}
    </div>
  );
}

export const ActorNode = memo(function ActorNode({ data, selected }: NodeProps) {
  const { actor, outEdges = [], inEdges = [] } = data as ActorNodeData;
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(actor.name);
  const [promptText, setPromptText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const activitiesScrollRef = useRef<HTMLDivElement>(null);

  const {
    runningActors, actorOutputs, selectActor, updateActor,
    openEventsModal, openCronsModal, openActorMenu, openProviderMenu,
    actorActivitiesVisible, toggleActivities, openActivityModal,
  } = useStore();

  const isCode = actor.actorType === 'python' || actor.actorType === 'typescript';
  const running = runningActors.has(actor.name);
  const output = actorOutputs.get(actor.name);
  const activitiesVisible = actorActivitiesVisible[actor.id] ?? false;
  const outputLines = output ? output.split('\n').filter(l => l.trim()) : [];
  const providerInfo = PROVIDERS[actor.provider];
  const color = providerInfo?.color ?? (isCode ? '#0ea5e9' : '#6b7280');
  const typeLabel = isCode ? actor.actorType!.toUpperCase() : (providerInfo?.label ?? actor.provider);

  useEffect(() => { if (!editing) setNameVal(actor.name); }, [actor.name, editing]);
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  useEffect(() => {
    if (activitiesScrollRef.current) {
      activitiesScrollRef.current.scrollTop = activitiesScrollRef.current.scrollHeight;
    }
  }, [output]);

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

  function startActor(e: React.MouseEvent) {
    e.stopPropagation();
    // Open the log panel immediately and write a placeholder so the user sees
    // something right away, before the async round-trip to the extension host.
    if (!activitiesVisible) toggleActivities(actor.id);
    useStore.getState().appendOutput(actor.name, `⏳ Starting ${actor.name}…`);
    vscode.postMessage({ type: 'runActor', name: actor.name, instruction: '__start__' });
  }

  function sendPrompt(e: React.MouseEvent) {
    e.stopPropagation();
    const text = promptText.trim();
    if (!text || !running) return;
    useStore.getState().appendOutput(actor.name, `> ${text}`);
    vscode.postMessage({ type: 'runActor', name: actor.name, instruction: text });
    setPromptText('');
    if (!activitiesVisible) toggleActivities(actor.id);
  }

  return (
    <div
      className={`cs-actor-node${selected ? ' cs-actor-node--selected' : ''}${running ? ' cs-actor-node--running' : ''}`}
      onClick={() => selectActor(actor.id)}
    >
      {/* Per-side handles — one per incoming/outgoing edge on the nearest face */}
      <Handles edges={inEdges} type="target" />
      <Handles edges={outEdges} type="source" />

      {/* ── Header: status | provider | name | gear ── */}
      <div className="cs-actor-header">
        <span
          className={`cs-actor-status${running ? ' cs-actor-status--on' : ''}`}
          title={running ? 'running' : 'idle'}
        />

        <div
          className="cs-actor-provider"
          onClick={e => { e.stopPropagation(); if (!isCode) openProviderMenu(actor.id, e.clientX, e.clientY); }}
          title={isCode ? actor.actorType : 'Click to change provider / model'}
        >
          <span className="cs-actor-badge" style={{ background: color }}>{typeLabel}</span>
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

      {isCode ? (
        <>
          {/* ── Code actor: script path ── */}
          <div className="cs-actor-model-row">
            <span className="cs-actor-section-label">script</span>
            <span className="cs-actor-model" title={actor.scriptPath}>
              {actor.scriptPath ? actor.scriptPath.split('/').pop() : <em style={{ opacity: 0.45 }}>no script</em>}
            </span>
            {outEdges.length > 0 && <span className="cs-actor-indicator" title={`${outEdges.length} connections`}>⇢</span>}
          </div>

          {activitiesVisible && (
            <ActivityPanel
              outputLines={outputLines}
              scrollRef={activitiesScrollRef}
              onExpand={e => { e.stopPropagation(); openActivityModal(actor.id); }}
              emptyLabel="not started"
            />
          )}

          {/* ── Code actor: start / stop only ── */}
          <div className="cs-actor-prompt-row" onClick={e => e.stopPropagation()}>
            {!running ? (
              <button
                className="cs-actor-btn cs-actor-btn--prompt"
                style={{ flex: 1 }}
                onClick={e => { e.stopPropagation(); vscode.postMessage({ type: 'runActor', name: actor.name, instruction: '__start__' }); if (!activitiesVisible) toggleActivities(actor.id); }}
                title="Start code actor"
              >▶ Start</button>
            ) : (
              <button
                className="cs-actor-btn cs-actor-btn--stop"
                style={{ flex: 1 }}
                onClick={handleStop}
                title="Stop code actor"
              >■ Stop</button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* ── AI actor: model row | indicators ── */}
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

          {(actor.definePrompt.uri || actor.definePrompt.content) && (
            <div className="cs-actor-define-prompt">
              <span className="cs-actor-section-label">role</span>
              <span className="cs-actor-prompt-ref">
                {actor.definePrompt.uri ?? (actor.definePrompt.content ?? '').slice(0, 50)}
              </span>
            </div>
          )}

          {activitiesVisible && (
            <ActivityPanel
              outputLines={outputLines}
              scrollRef={activitiesScrollRef}
              onExpand={e => { e.stopPropagation(); openActivityModal(actor.id); }}
              emptyLabel="no activity yet"
            />
          )}

          {/* ── AI actor: start / prompt / stop ── */}
          <div className="cs-actor-prompt-row" onClick={e => e.stopPropagation()}>
            {!running ? (
              <button
                className="cs-actor-btn cs-actor-btn--prompt"
                style={{ flex: 1 }}
                onClick={startActor}
                title="Start actor"
              >▶ Start</button>
            ) : (
              <>
                <input
                  ref={promptRef}
                  className="cs-actor-prompt-input"
                  placeholder="Send a prompt…"
                  value={promptText}
                  onChange={e => setPromptText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sendPrompt(e as unknown as React.MouseEvent); }
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                />
                <button className="cs-actor-btn cs-actor-btn--prompt" onClick={sendPrompt} title="Send prompt">Prompt</button>
                <button className="cs-actor-btn cs-actor-btn--stop" onClick={handleStop} title="Stop actor">■</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
});
