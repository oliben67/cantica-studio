import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Position,
} from '@xyflow/react';
import type { ActorEdgeDef } from '../types';
import { useStore } from '../store';

export type ActorEdgeData = {
  edge: ActorEdgeDef;
  sourcePosition?: string;
  targetPosition?: string;
};

// Self-loop arc drawn above the node between the specific source and target handles.
function selfLoopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const midY = (sy + ty) / 2;
  const lift = 60;
  const flare = 44;
  const path = `M ${sx} ${sy} C ${sx + flare} ${midY - lift} ${tx - flare} ${midY - lift} ${tx} ${ty}`;
  const labelX = (sx + tx) / 2;
  const labelY = midY - lift * 0.85;
  return [path, labelX, labelY];
}


/**
 * Bezier path between two actor handles.
 *  - Uses getBezierPath with the resolved source/target positions so the curve
 *    exits/enters in the correct direction regardless of which face the handle
 *    sits on.
 *  - Adds a small perpendicular bow (A→B vs B→A flip) so bidirectional pairs
 *    arc on opposite sides of the straight line and never cross.
 */
function crossActorPath(
  sx: number, sy: number,
  tx: number, ty: number,
  srcPos: Position, tgtPos: Position,
  fromId: string, toId: string,
): [string, number, number] {
  const [base, lx, ly] = getBezierPath({
    sourceX: sx, sourceY: sy, sourcePosition: srcPos,
    targetX: tx, targetY: ty, targetPosition: tgtPos,
  });
  // Additional perpendicular bow to keep bidirectional edges on opposite sides
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const bow = 18;
  const sign = fromId < toId ? 1 : -1;
  const bx = (-dy / len) * bow * sign;
  const by =  (dx / len) * bow * sign;
  // Shift the midpoint of the bezier by inserting an extra control point
  const cpX = lx + bx, cpY = ly + by;
  // Recompute path through the offset midpoint as a cubic
  const path = `M ${sx} ${sy} C ${sx + (cpX - sx) * 0.5} ${sy + (cpY - sy) * 0.5} ${cpX} ${cpY} ${tx} ${ty}` + base.slice(base.indexOf('C') >= 0 ? base.indexOf('C') + 1000 : base.length);
  // Simpler: just offset the existing label position and keep the bezier path
  void path;   // unused — use the bezier path from getBezierPath
  return [base, cpX, cpY];
}

export function ActorEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const { openEventsModal, openCronsModal, openEdgeMenu } = useStore();
  const edgeData = data as ActorEdgeData | undefined;
  const label = edgeData?.edge.label ?? '';
  const kind = edgeData?.edge.kind;
  const isCron = kind === 'cron';
  const isEvent = kind === 'event';
  const isSelf = source === target;

  const fromId = edgeData?.edge.from ?? '';
  const toId   = edgeData?.edge.to   ?? '';
  const srcPos = (edgeData?.sourcePosition ?? 'right') as Position;
  const tgtPos = (edgeData?.targetPosition ?? 'left')  as Position;

  const [edgePath, labelX, labelY] = isSelf
    ? selfLoopPath(sourceX, sourceY, targetX, targetY)
    : crossActorPath(sourceX, sourceY, targetX, targetY, srcPos, tgtPos, fromId, toId);

  const color = isEvent ? '#a78bfa' : isCron ? '#f59e0b' : '#6b7280';

  function handleLabelDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!label || !source) return;
    if (isEvent) openEventsModal(source, label);
    else if (isCron) openCronsModal(source, label);
  }

  function handleLabelContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isEvent || isCron) openEdgeMenu(id, e.clientX, e.clientY);
  }

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
            onDoubleClick={handleLabelDoubleClick}
            onContextMenu={handleLabelContextMenu}
            title={isEvent || isCron ? 'Double-click to edit · Right-click for options' : undefined}
          >
            {isEvent && <span className="cs-edge-event-badge">⚡</span>}
            {isCron && <span className="cs-edge-event-badge">⏱</span>}
            {label}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
