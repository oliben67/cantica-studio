import React from 'react';  
import { useStore } from '../store';
import { computeActorEdges } from '../edgeUtils';

export function EdgeMenu() {
  const {
    graph, edgeMenuState, closeEdgeMenu,
    openEventsModal, openCronsModal,
    updateActor, replaceActorEdges,
  } = useStore();

  if (!edgeMenuState) return null;
  const { edgeId, x, y } = edgeMenuState;
  const found = graph.edges.find(e => e.id === edgeId);
  if (!found) return null;
  // Non-nullable alias — closures below capture it without assertions.
  const edge = found;
  const allActors = graph.actors;

  function run(fn: () => void) { fn(); closeEdgeMenu(); }

  function handleEdit() {
    run(() => {
      if (edge.kind === 'event') openEventsModal(edge.from, edge.label);
      else if (edge.kind === 'cron') openCronsModal(edge.from, edge.label);
    });
  }

  function handleDelete() {
    run(() => {
      const actor = allActors.find(a => a.id === edge.from);
      if (!actor) return;
      if (edge.kind === 'event') {
        // Remove the first event whose name matches the edge label
        let removed = false;
        const newEvents = actor.promptEvents.filter(e => {
          if (!removed && e.name === edge.label) { removed = true; return false; }
          return true;
        });
        const updated = { ...actor, promptEvents: newEvents };
        updateActor(actor.id, { promptEvents: newEvents });
        replaceActorEdges(actor.id, computeActorEdges(updated, allActors));
      } else if (edge.kind === 'cron') {
        let removed = false;
        const newCrons = actor.cronJobs.filter(c => {
          if (!removed && c.schedule === edge.label) { removed = true; return false; }
          return true;
        });
        const updated = { ...actor, cronJobs: newCrons };
        updateActor(actor.id, { cronJobs: newCrons });
        replaceActorEdges(actor.id, computeActorEdges(updated, allActors));
      }
    });
  }

  return (
    <>
      <div
        className="cs-provider-overlay"
        onPointerDown={e => { e.stopPropagation(); closeEdgeMenu(); }}
      />
      <div className="cs-ctx-menu" style={{ left: x, top: y }}>
        <button className="cs-ctx-item" onClick={handleEdit}>
          <span className="cs-ctx-icon">✏️</span> Edit
        </button>
        <div className="cs-ctx-sep" />
        <button className="cs-ctx-item cs-ctx-item--danger" onClick={handleDelete}>
          <span className="cs-ctx-icon">✕</span> Delete
        </button>
      </div>
    </>
  );
}
