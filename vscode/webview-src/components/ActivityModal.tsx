import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';

// ── Message parsing ────────────────────────────────────────────────────────────

type MsgKind = 'user' | 'ai' | 'system';

interface ChatMsg {
  kind: MsgKind;
  text: string;
}

function parseLine(line: string): ChatMsg {
  if (line.startsWith('> ')) return { kind: 'user', text: line.slice(2) };
  if (/^[⏳✓⚠ℹ]/.test(line)) return { kind: 'system', text: line };
  return { kind: 'ai', text: line };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ActivityModal() {
  const {
    graph, activityModalActorId, closeActivityModal,
    actorOutputs, runningActors, appendOutput,
  } = useStore();

  const [promptText, setPromptText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const actor = activityModalActorId
    ? graph.actors.find(a => a.id === activityModalActorId) ?? null
    : null;

  const running = actor ? runningActors.has(actor.name) : false;
  const output = actor ? (actorOutputs.get(actor.name) ?? '') : '';
  const messages: ChatMsg[] = output
    ? output.split('\n').filter(l => l.trim()).map(parseLine)
    : [];

  // Auto-scroll to bottom when messages arrive
  useEffect(() => {
    if (activityModalActorId && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, activityModalActorId]);

  // Focus input when modal opens
  useEffect(() => {
    if (activityModalActorId) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [activityModalActorId]);

  if (!actor) return null;

  function sendPrompt() {
    const text = promptText.trim();
    if (!text || !running || !actor) return;
    appendOutput(actor.name, `> ${text}`);
    vscode.postMessage({ type: 'runActor', name: actor.name, instruction: text });
    setPromptText('');
  }

  function handlePromptClick(text: string) {
    setPromptText(text);
    inputRef.current?.focus();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeActivityModal}>
      <div className="cs-modal cs-modal--activity" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="cs-modal-header">
          <span className="cs-modal-title">⚡ {actor.name} — Activities</span>
          <button className="cs-modal-close" onClick={closeActivityModal} title="Close">✕</button>
        </div>

        {/* Chat body */}
        <div className="cs-chat-body" ref={scrollRef}>
          {messages.length === 0 ? (
            <p className="cs-chat-empty">No activity yet — start the actor and send a prompt.</p>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`cs-chat-row cs-chat-row--${msg.kind}`}>
                {msg.kind === 'user' ? (
                  <button
                    className="cs-chat-bubble cs-chat-bubble--user"
                    onClick={() => handlePromptClick(msg.text)}
                    title="Click to edit and resend"
                  >
                    {msg.text}
                  </button>
                ) : (
                  <span className={`cs-chat-bubble cs-chat-bubble--${msg.kind}`}>
                    {msg.text}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input row */}
        <div className="cs-chat-input-row">
          <input
            ref={inputRef}
            className="cs-chat-input"
            placeholder={running ? 'Send a prompt… (Enter to send)' : 'Start the actor first'}
            value={promptText}
            disabled={!running}
            onChange={e => setPromptText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); sendPrompt(); }
              e.stopPropagation();
            }}
          />
          <button
            className="cs-actor-btn cs-actor-btn--prompt"
            style={{ whiteSpace: 'nowrap' }}
            onClick={sendPrompt}
            disabled={!running}
            title="Send prompt"
          >Send</button>
        </div>
      </div>
    </div>
  );
}
