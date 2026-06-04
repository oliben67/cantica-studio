import React, { useState } from 'react';
import { useStore } from '../store';
import type { PromptRef } from '../types';

export function PropertiesModal() {
  const { graph, updateActor, propertiesModalActorId, closePropertiesModal } = useStore();
  const actor = propertiesModalActorId ? graph.actors.find(a => a.id === propertiesModalActorId) : null;

  const isCode = actor?.actorType === 'python' || actor?.actorType === 'typescript';
  const [defineUri, setDefineUri] = useState(() => actor?.definePrompt.uri ?? '');
  const [defineContent, setDefineContent] = useState(() => actor?.definePrompt.content ?? '');
  const [scriptPath, setScriptPath] = useState(() => actor?.scriptPath ?? '');
  const [scriptCommand, setScriptCommand] = useState(() => actor?.scriptCommand ?? '');
  const [directory, setDirectory] = useState(() => actor?.directory ?? '');
  const [maxTokens, setMaxTokens] = useState(() => actor?.maxTokens ?? 4096);
  const [maxHistory, setMaxHistory] = useState(() => actor?.maxHistory ?? 10);

  if (!actor) return null;

  function save() {
    if (!actor) return;
    const dir = directory.trim();
    const patch = dir ? { directory: dir } : {};
    if (isCode) {
      updateActor(actor.id, { scriptPath: scriptPath.trim(), scriptCommand: scriptCommand.trim(), ...patch });
    } else {
      const definePrompt: PromptRef = defineUri.trim() ? { uri: defineUri.trim() } : { content: defineContent };
      updateActor(actor.id, { definePrompt, maxTokens, maxHistory, ...patch });
    }
    closePropertiesModal();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closePropertiesModal}>
      <div className="cs-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">⚙ Properties — {actor.name} {isCode ? `[${actor.actorType}]` : ''}</span>
          <button className="cs-modal-close" onClick={closePropertiesModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          {isCode ? (
            <>
              <label className="cs-prop-label">
                Script path
                <input
                  className="cs-prop-input"
                  value={scriptPath}
                  onChange={e => setScriptPath(e.target.value)}
                  placeholder="/path/to/script.py  or  ./worker.ts"
                />
              </label>
              <label className="cs-prop-label">
                Runtime command <span className="cs-modal-hint">(optional override, e.g. bun, ts-node)</span>
                <input
                  className="cs-prop-input"
                  value={scriptCommand}
                  onChange={e => setScriptCommand(e.target.value)}
                  placeholder="python3 / node / bun / ts-node"
                />
              </label>
            </>
          ) : (
            <>
              <label className="cs-prop-label">
                Role prompt URI
                <input
                  className="cs-prop-input"
                  value={defineUri}
                  onChange={e => setDefineUri(e.target.value)}
                  placeholder="cantica://namespace/prompt"
                />
              </label>

              <label className="cs-prop-label">
                Role prompt <span className="cs-modal-hint">(inline — used when URI is empty)</span>
                <textarea
                  className="cs-prop-input cs-modal-textarea"
                  value={defineContent}
                  onChange={e => setDefineContent(e.target.value)}
                  placeholder="Define what this actor does…"
                  rows={4}
                />
              </label>

              <div className="cs-prop-row">
                <label className="cs-prop-label cs-prop-half">
                  Max tokens
                  <input
                    className="cs-prop-input"
                    type="number"
                    value={maxTokens}
                    onChange={e => setMaxTokens(Math.max(1, Number(e.target.value)))}
                    min={1}
                    max={200000}
                  />
                </label>
                <label className="cs-prop-label cs-prop-half">
                  Max history turns
                  <input
                    className="cs-prop-input"
                    type="number"
                    value={maxHistory}
                    onChange={e => setMaxHistory(Math.max(0, Number(e.target.value)))}
                    min={0}
                    max={100}
                  />
                </label>
              </div>
            </>
          )}

          <label className="cs-prop-label">
            Home directory <span className="cs-modal-hint">(optional — exposed as MCP filesystem resource)</span>
            <input
              className="cs-prop-input"
              value={directory}
              onChange={e => setDirectory(e.target.value)}
              placeholder="src/  or  /absolute/path"
            />
          </label>
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={save}>Save</button>
          <button className="cs-modal-btn" onClick={closePropertiesModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
