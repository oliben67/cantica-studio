import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { ActorEdgeDef } from '../types';
import { useStore } from '../store';

export type ActorEdgeData = { edge: ActorEdgeDef };

// Returns [pathD, labelX, labelY] for a self-loop arc above the node.
// Label is placed at the apex so it visually crosses the arc.
function selfLoopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const lift = 80;   // how far above the handles the loop rises
  const flare = 50;  // horizontal spread of the control points
  const path = `M ${sx} ${sy} C ${sx + flare} ${sy - lift} ${tx - flare} ${ty - lift} ${tx} ${ty}`;
  const labelX = (sx + tx) / 2;
  // Bezier apex sits at sy - 0.75*lift; place label 16px above that.
  const labelY = sy - lift * 0.75;
  return [path, labelX, labelY];
}

export function ActorEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const removeEdge = useStore(s => s.removeEdge);

  const edgeData = data as ActorEdgeData | undefined;
  const label = edgeData?.edge.label ?? '';
  const isEvent = !!edgeData?.edge.targetEvent;
  const isSelf = source === target;

  const [edgePath, labelX, labelY] = isSelf
    ? selfLoopPath(sourceX, sourceY, targetX, targetY)
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const color = isEvent ? '#a78bfa' : '#7c3aed';

  // Delete button sits above the label (or at midpoint when no label).
  const deleteY = label ? labelY - 18 : labelY;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isEvent ? '6 3' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {label && (
          <div
            className="cs-edge-label nodrag nopan"
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {isEvent && <span className="cs-edge-event-badge">⚡{edgeData?.edge.targetEvent}</span>}
            {label}
          </div>
        )}
        {selected && (
          <button
            className="cs-edge-delete nodrag nopan"
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${deleteY}px)` }}
            onClick={e => { e.stopPropagation(); removeEdge(id); }}
            title="Delete connection"
          >
            ×
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
