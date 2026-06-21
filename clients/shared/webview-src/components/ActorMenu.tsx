import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from './ConfirmModal';

export function ActorMenu() {
  const {
    graph, actorMenuState, closeActorMenu,
    openEventsModal, openCronsModal, openPropertiesModal,
    toggleChat, actorChatVisible, openChatModal,
    openResourcesModal, removeActor, runningActors,
  } = useStore();

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Reset confirm state whenever the menu is opened for a different actor or reopened.
  useEffect(() => { setDeleteConfirm(false); }, [actorMenuState]);

  if (!actorMenuState) return null;

  const { actorId, x, y } = actorMenuState;
  const chatOn = actorChatVisible[actorId] ?? false;
  const actor = graph.actors.find(a => a.id === actorId);
  const isCode = actor?.actorType === 'python' || actor?.actorType === 'typescript';
  const isRunning = actor ? runningActors.has(actor.name) : false;

  function run(fn: () => void) { fn(); closeActorMenu(); }

  function handleDeleteClick() {
    setDeleteConfirm(true);
  }

  function confirmDelete() {
    setDeleteConfirm(false);
    removeActor(actorId);
    closeActorMenu();
  }

  return (
    <>
      {deleteConfirm && (
        <ConfirmModal
          title="Delete actor"
          message={
            isRunning
              ? `"${actor?.name}" is currently running. Delete it anyway?`
              : `Delete "${actor?.name}"? This cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => { setDeleteConfirm(false); closeActorMenu(); }}
        />
      )}
      {!deleteConfirm && (
        <div
          className="cs-provider-overlay"
          onPointerDown={e => { e.stopPropagation(); closeActorMenu(); }}
        />
      )}
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
          <span className="cs-ctx-icon">📋</span> {chatOn ? 'Hide Chat' : 'Chat'}
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
        <div className="cs-ctx-sep" />
        <button className="cs-ctx-item cs-ctx-item--danger" onClick={handleDeleteClick} title="Delete this actor">
          <span className="cs-ctx-icon">✕</span> Delete
        </button>
      </div>
    </>
  );
}
