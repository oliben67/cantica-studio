import type { AIActorDef, ActorEdgeDef } from './types';

/**
 * Compute graph edges for `actor`.
 *
 * Self-targeting events (empty targetActors) and self-targeting crons (no
 * targetActor) do NOT produce edges — the data is stored in the actor's
 * promptEvents/cronJobs and persisted in the .jsonld as-is.  Only connections
 * to OTHER actors create visible edges in the canvas.
 */
export function computeActorEdges(
  actor: AIActorDef,
  allActors: AIActorDef[],
): Omit<ActorEdgeDef, 'id'>[] {
  const edges: Omit<ActorEdgeDef, 'id'>[] = [];

  for (const evt of actor.promptEvents) {
    for (const targetName of evt.targetActors ?? []) {
      const target = allActors.find(a => a.name === targetName);
      if (!target || target.id === actor.id) continue;
      edges.push({ from: actor.id, to: target.id, label: evt.name, prompt: evt.prompt, kind: 'event' });
    }
  }

  for (const cron of actor.cronJobs) {
    if (!cron.targetActor || cron.targetActor === actor.name) continue;
    const target = allActors.find(a => a.name === cron.targetActor);
    if (!target || target.id === actor.id) continue;
    edges.push({
      from: actor.id,
      to: target.id,
      label: cron.name?.trim() || cron.schedule,
      prompt: cron.prompt,
      kind: 'cron',
      ...(cron.targetEvent ? { targetEvent: cron.targetEvent } : {}),
    });
  }

  return edges;
}
