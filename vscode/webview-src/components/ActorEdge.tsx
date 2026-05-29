import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { ActorEdgeDef } from '../types';

export type ActorEdgeData = { edge: ActorEdgeDef };

export function ActorEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as ActorEdgeData | undefined;
  const label = edgeData?.edge.label ?? '';
  const isEvent = !!edgeData?.edge.targetEvent;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isEvent ? '#a78bfa' : '#7c3aed',
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isEvent ? '6 3' : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="cs-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {isEvent && <span className="cs-edge-event-badge">⚡{edgeData?.edge.targetEvent}</span>}
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
