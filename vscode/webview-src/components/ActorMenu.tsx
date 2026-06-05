import React from 'react';
import { useStore } from '../store';

export function ActorMenu() {
  const {
    graph, actorMenuState, closeActorMenu,
    openEventsModal, openCronsModal, openPropertiesModal,
    toggleChat, actorChatVisible, openChatModal,
    openResourcesModal,
  } = useStore();

  if (!actorMenuState) return null;

  const { actorId, x, y } = actorMenuState;
  const chatOn = actorChatVisible[actorId] ?? false;
  const actor = graph.actors.find(a => a.id === actorId);
  const isCode = actor?.actorType === 'python' || actor?.actorType === 'typescript';

  function run(fn: () => void) { fn(); closeActorMenu(); }

  return (
    <>
      <div
        className="cs-provider-overlay"
        onPointerDown={e => { e.stopPropagation(); closeActorMenu(); }}
      />
      <div className="cs-ctx-menu" style={{ left: x, top: y }}>
        {!isCode && (
          <>
            <button className="cs-ctx-item" onClick={() => run(() => openEventsModal(actorId))}>
              <span className="cs-ctx-icon">⚡</span> Events
            </button>
            <button className="cs-ctx-item" onClick={() => run(() => openCronsModal(actorId))}>
              <span className="cs-ctx-icon">⏱</span> Cron Jobs
            </button>
          </>
        )}
        <button className="cs-ctx-item" onClick={() => run(() => toggleChat(actorId))}>
          <span className="cs-ctx-icon">📋</span> {chatOn ? 'Hide Chat' : 'Activities'}
        </button>
        <button className="cs-ctx-item" onClick={() => run(() => openChatModal(actorId))}>
          <span className="cs-ctx-icon">⤢</span> Expand Chat
        </button>
        <div className="cs-ctx-sep" />
        <button className="cs-ctx-item" onClick={() => run(() => openResourcesModal(actorId))}>
          <span className="cs-ctx-icon">📦</span> Resources
        </button>
        <div className="cs-ctx-sep" />
        <button className="cs-ctx-item" onClick={() => run(() => openPropertiesModal(actorId))}>
          <span className="cs-ctx-icon">⚙</span> Properties
        </button>
      </div>
    </>
  );
}
