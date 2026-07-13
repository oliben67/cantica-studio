import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';

// ── Message parsing ────────────────────────────────────────────────────────────

type MsgKind = 'user' | 'ai' | 'system';

interface ChatMsg {
  kind: MsgKind;
  text: string;
  ts?: string | undefined;
}

const TS_RE = /^\[(\d{2}:\d{2}:\d{2})\] ([\s\S]*)$/;

function parseLine(line: string): ChatMsg {
  const m = TS_RE.exec(line);
  const ts = m?.[1];
  const content = m ? (m[2] ?? line) : line;
  if (content.startsWith('> ')) return { kind: 'user', text: content.slice(2), ts };
  if (/^[⏳✓⚠ℹ]/.test(content)) return { kind: 'system', text: content, ts };
  return { kind: 'ai', text: content, ts };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatModal() {
  const {
    graph, chatModalActorId, closeChatModal,
    actorOutputs, runningActors, appendOutput, resolvedModels, resolveTimedOut,
  } = useStore();

  const [promptText, setPromptText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const actor = chatModalActorId
    ? graph.actors.find(a => a.id === chatModalActorId) ?? null
    : null;

  const running = actor ? runningActors.has(actor.name) : false;
  // Copilot 'auto' actors accept no prompts until the model probe finishes.
  const isPending = !!actor && actor.provider === 'copilot' && actor.model === 'auto'
    && running && !resolvedModels[actor.name];
  // The lock lifts when the model resolves OR when the actor node's resolve
  // timer expires (store.resolveTimedOut) — a failed probe can't block forever.
  const promptLocked = isPending && !!actor && !resolveTimedOut[actor.name];
  const output = actor ? (actorOutputs.get(actor.name) ?? '') : '';
  const messages: ChatMsg[] = output
    ? output.split('\n').filter(l => l.trim()).map(parseLine)
    : [];

  // Auto-scroll to bottom when messages arrive
  useEffect(() => {
    if (chatModalActorId && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, chatModalActorId]);

  // Focus input when modal opens
  useEffect(() => {
    if (chatModalActorId) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [chatModalActorId]);

  if (!actor) return null;

  function sendPrompt() {
    const text = promptText.trim();
    if (!text || !running || promptLocked || !actor) return;
    appendOutput(actor.name, `> ${text}`);
    vscode.postMessage({ type: 'runActor', name: actor.name, instruction: text });
    setPromptText('');
  }

  function handlePromptClick(text: string) {
    setPromptText(text);
    inputRef.current?.focus();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeChatModal}>
      <div className="cs-modal cs-modal--chat" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="cs-modal-header">
          <span className="cs-modal-title">⚡ {actor.name} — Chat</span>
          <button className="cs-modal-close" onClick={closeChatModal} title="Close">✕</button>
        </div>

        {/* Chat body */}
        <div className="cs-chat-body" ref={scrollRef}>
          {messages.length === 0 ? (
            <p className="cs-chat-empty">No chat yet — start the actor and send a prompt.</p>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`cs-chat-row cs-chat-row--${msg.kind}`}>
                {msg.kind === 'user' ? (
                  <div className="cs-chat-msg-wrap cs-chat-msg-wrap--user">
                    {msg.ts && <span className="cs-msg-ts cs-msg-ts--user">{msg.ts}</span>}
                    <button
                      className="cs-chat-bubble cs-chat-bubble--user"
                      onClick={() => handlePromptClick(msg.text)}
                      title="Click to edit and resend"
                    >
                      {msg.text}
                    </button>
                  </div>
                ) : (
                  <div className="cs-chat-msg-wrap">
                    {msg.ts && <span className="cs-msg-ts">{msg.ts}</span>}
                    <span className={`cs-chat-bubble cs-chat-bubble--${msg.kind}`}>
                      {msg.text}
                    </span>
                  </div>
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
            placeholder={!running ? 'Start the actor first' : promptLocked ? 'Resolving model…' : 'Send a prompt… (Enter to send)'}
            value={promptText}
            disabled={!running || promptLocked}
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
            disabled={!running || promptLocked}
            title={promptLocked ? 'Model is resolving — prompts are disabled until it is ready' : 'Send prompt'}
          >Send</button>
        </div>
      </div>
    </div>
  );
}
