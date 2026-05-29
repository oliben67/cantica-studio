import React, { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AIActorDef } from '../types';
import { useStore } from '../store';

export type ActorNodeData = { actor: AIActorDef };
export type ActorNodeType = { id: string; type: 'actorNode'; position: { x: number; y: number }; data: ActorNodeData };

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#d97706',
  gpt: '#16a34a',
  gemini: '#2563eb',
  mistral: '#7c3aed',
};

export const ActorNode = memo(function ActorNode({ data, selected }: NodeProps) {
  const actor = (data as ActorNodeData).actor;
  const [eventsOpen, setEventsOpen] = useState(false);
  const [cronsOpen, setCronsOpen] = useState(false);
  const { runningActors, actorOutputs, selectActor } = useStore();
  const running = runningActors.has(actor.name);
  const output = actorOutputs.get(actor.name);
  const color = PROVIDER_COLORS[actor.provider] ?? '#6b7280';

  function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    const instruction = window.prompt(`Instruct ${actor.name}:`);
    if (instruction) {
      vscode.postMessage({ type: 'runActor', name: actor.name, instruction });
    }
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
      {/* Handles */}
      <Handle type="target" position={Position.Left} className="cs-handle cs-handle--target" />
      <Handle type="source" position={Position.Right} className="cs-handle cs-handle--source" />

      {/* Header */}
      <div className="cs-actor-header">
        <span className="cs-actor-badge" style={{ background: color }}>
          {actor.provider}
        </span>
        <span className="cs-actor-name">{actor.name}</span>
        <span className={`cs-actor-status${running ? ' cs-actor-status--on' : ''}`} title={running ? 'running' : 'idle'} />
      </div>

      {/* Define prompt */}
      {(actor.definePrompt.uri || actor.definePrompt.content) && (
        <div className="cs-actor-define-prompt">
          <span className="cs-actor-section-label">role</span>
          <span className="cs-actor-prompt-ref">
            {actor.definePrompt.uri ?? (actor.definePrompt.content ?? '').slice(0, 40)}
          </span>
        </div>
      )}

      {/* Prompt events */}
      {actor.promptEvents.length > 0 && (
        <div className="cs-actor-section">
          <button
            className="cs-actor-section-toggle"
            onClick={(e) => { e.stopPropagation(); setEventsOpen((o) => !o); }}
          >
            <span className="cs-actor-section-label">⚡ events ({actor.promptEvents.length})</span>
            <span className="cs-chevron">{eventsOpen ? '▴' : '▾'}</span>
          </button>
          {eventsOpen && (
            <ul className="cs-actor-list">
              {actor.promptEvents.map((evt) => (
                <li key={evt.name} className="cs-actor-list-item">
                  <button
                    className="cs-fire-btn"
                    title={`Fire ${evt.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      vscode.postMessage({ type: 'fireEvent', name: actor.name, eventName: evt.name, context: '' });
                    }}
                  >
                    ▶
                  </button>
                  <span className="cs-event-name">{evt.name}</span>
                  {evt.filePattern && <span className="cs-file-pattern">{evt.filePattern}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Cron jobs */}
      {actor.cronJobs.length > 0 && (
        <div className="cs-actor-section">
          <button
            className="cs-actor-section-toggle"
            onClick={(e) => { e.stopPropagation(); setCronsOpen((o) => !o); }}
          >
            <span className="cs-actor-section-label">🕐 crons ({actor.cronJobs.length})</span>
            <span className="cs-chevron">{cronsOpen ? '▴' : '▾'}</span>
          </button>
          {cronsOpen && (
            <ul className="cs-actor-list">
              {actor.cronJobs.map((c, i) => (
                <li key={i} className="cs-actor-list-item">
                  <code className="cs-cron-schedule">{c.schedule}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Last output */}
      {output && (
        <div className="cs-actor-output">
          <span className="cs-actor-section-label">last output</span>
          <p className="cs-actor-output-text">{output.slice(0, 120)}{output.length > 120 ? '…' : ''}</p>
        </div>
      )}

      {/* Footer actions */}
      <div className="cs-actor-footer">
        {running ? (
          <button className="cs-actor-btn cs-actor-btn--stop" onClick={handleStop}>Stop</button>
        ) : (
          <button className="cs-actor-btn cs-actor-btn--run" onClick={handleRun}>Run</button>
        )}
      </div>
    </div>
  );
});
