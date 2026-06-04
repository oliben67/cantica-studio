import React from 'react';
import { useStore } from '../store';

export function ActorMenu() {
  const {
    graph, actorMenuState, closeActorMenu,
    openEventsModal, openCronsModal, openPropertiesModal,
    toggleActivities, actorActivitiesVisible, openActivityModal,
    openResourcesModal,
  } = useStore();

  if (!actorMenuState) return null;

  const { actorId, x, y } = actorMenuState;
  const activitiesOn = actorActivitiesVisible[actorId] ?? false;
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
        <button className="cs-ctx-item" onClick={() => run(() => toggleActivities(actorId))}>
          <span className="cs-ctx-icon">📋</span> {activitiesOn ? 'Hide Activities' : 'Activities'}
        </button>
        <button className="cs-ctx-item" onClick={() => run(() => openActivityModal(actorId))}>
          <span className="cs-ctx-icon">⤢</span> Expand Activities
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
