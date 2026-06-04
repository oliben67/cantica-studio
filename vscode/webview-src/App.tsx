import React, { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ActorNode } from './components/ActorNode';
import { ActorEdge, type ActorEdgeData } from './components/ActorEdge';
import { GraphToolbar } from './components/GraphToolbar';
import { EventsModal } from './components/EventsModal';
import { CronModal } from './components/CronModal';
import { ProviderMenu } from './components/ProviderMenu';
import { ActorMenu } from './components/ActorMenu';
import { EdgeMenu } from './components/EdgeMenu';
import { PropertiesModal } from './components/PropertiesModal';
import { ResourcesModal } from './components/ResourcesModal';
import { ActivityModal } from './components/ActivityModal';
import { useStore } from './store';
import type { ActorEdgeDef, EdgeHandleInfo, HandleSide, IncomingMessage } from './types';
import { vscode } from './vscode';

const NODE_TYPES = { actorNode: ActorNode };
const EDGE_TYPES = { actorEdge: ActorEdge };

// Given the vector from one actor to another, pick the best side to exit/enter.
const OPP: Record<HandleSide, HandleSide> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
function getBestSide(fx: number, fy: number, tx: number, ty: number): HandleSide {
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// ── Canvas ────────────────────────────────────────────────────────────────────

function Canvas() {
  const store = useStore();
  const { minimapVisible, toggleMinimap } = store;
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Sync actors → nodes.  Each node gets per-side handle info derived from its
  // edges so handles appear on whichever face is closest to the remote actor.
  useEffect(() => {
    // Position lookup
    const pos = new Map(store.graph.actors.map(a => [a.id, a.position]));
    const posOf = (id: string) => pos.get(id) ?? { x: 0, y: 0 };

    // Map edge → sides (source side for the from-node, target side for the to-node)
    const edgeSide = new Map<string, { src: HandleSide; tgt: HandleSide }>();
    for (const e of store.graph.edges) {
      if (e.from === e.to) continue;
      const fp = posOf(e.from), tp = posOf(e.to);
      const src = getBestSide(fp.x, fp.y, tp.x, tp.y);
      edgeSide.set(e.id, { src, tgt: OPP[src] });
    }

    const outMap = new Map<string, ActorEdgeDef[]>();
    const inMap  = new Map<string, ActorEdgeDef[]>();
    for (const a of store.graph.actors) { outMap.set(a.id, []); inMap.set(a.id, []); }
    for (const e of store.graph.edges) {
      if (e.from === e.to) continue;
      outMap.get(e.from)?.push(e);
      inMap.get(e.to)?.push(e);
    }

    // Sort each side group by coordinate on the far actor so handles match their
    // counterparts and edges don't need to cross.
    function sortForSide(arr: ActorEdgeDef[], remoteKey: 'from' | 'to', side: HandleSide) {
      const useX = side === 'top' || side === 'bottom';
      return arr.sort((a, b) => {
        const pa = posOf(a[remoteKey]), pb = posOf(b[remoteKey]);
        return (useX ? pa.x - pb.x : pa.y - pb.y) || a.label.localeCompare(b.label);
      });
    }

    function buildHandles(arr: ActorEdgeDef[], dir: 'out' | 'in'): EdgeHandleInfo[] {
      const key = dir === 'out' ? 'to' : 'from';
      const sideKey = dir === 'out' ? 'src' : 'tgt';
      // Group by side
      const groups = new Map<HandleSide, ActorEdgeDef[]>();
      for (const e of arr) {
        const side = edgeSide.get(e.id)?.[sideKey] ?? 'right';
        const g = groups.get(side) ?? [];
        g.push(e);
        groups.set(side, g);
      }
      const result: EdgeHandleInfo[] = [];
      for (const [side, group] of groups) {
        sortForSide(group, key, side);
        for (const e of group) {
          result.push({
            id: e.id, label: e.label, isSelf: false, side,
            ...(e.kind ? { kind: e.kind } : {}),
          });
        }
      }
      return result;
    }

    setNodes(prev => {
      const prevPos = new Map(prev.map(n => [n.id, n.position]));
      return store.graph.actors.map(actor => ({
        id: actor.id,
        type: 'actorNode' as const,
        position: prevPos.get(actor.id) ?? actor.position,
        data: {
          actor,
          outEdges: buildHandles(outMap.get(actor.id) ?? [], 'out'),
          inEdges:  buildHandles(inMap.get(actor.id)  ?? [], 'in'),
        },
        selected: actor.id === store.selectedActorId,
      }));
    });
  }, [store.graph.actors, store.graph.edges, store.selectedActorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync edges — skip self-loops; pass resolved sourcePosition/targetPosition
  useEffect(() => {
    const pos = new Map(store.graph.actors.map(a => [a.id, a.position]));
    const posOf = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
    setEdges(
      store.graph.edges.filter(e => e.from !== e.to).map(e => {
        const fp = posOf(e.from), tp = posOf(e.to);
        const srcPos = getBestSide(fp.x, fp.y, tp.x, tp.y);
        const tgtPos = OPP[srcPos];
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: `out-${e.id}`,
          targetHandle: `in-${e.id}`,
          type: 'actorEdge' as const,
          data: { edge: e, sourcePosition: srcPos, targetPosition: tgtPos } as ActorEdgeData,
          selected: e.id === store.selectedEdgeId,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: e.kind === 'event' ? '#a78bfa' : e.kind === 'cron' ? '#f59e0b' : '#6b7280',
          },
        };
      })
    );
  }, [store.graph.edges, store.selectedEdgeId, store.graph.actors]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    store.updateActorPosition(node.id, node.position as { x: number; y: number });
  }, [store]);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const n of deleted) store.removeActor(n.id);
  }, [store]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    store.selectActor(node.id);
  }, [store]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    store.selectEdge(edge.id);
  }, [store]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    store.openEdgeMenu(edge.id, e.clientX, e.clientY);
  }, [store]);

  const onPaneClick = useCallback(() => {
    store.selectActor(null);
    store.selectEdge(null);
  }, [store]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    store.addActor(pos);
  }, [screenToFlowPosition, store]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneClick={onPaneClick}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={onNodesDelete}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      colorMode="dark"
      deleteKeyCode="Delete"
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={8} size={0.6} className="cs-rf-bg" />
      <Controls className="cs-rf-controls" />
      {minimapVisible && (
        <MiniMap className="cs-rf-minimap" nodeColor="#7c3aed" maskColor="rgba(9,9,11,0.65)" />
      )}
      <Panel
        position="bottom-right"
        style={{
          bottom: minimapVisible ? (5 + 124 - 20 + 8) : 10,
          right:  minimapVisible ? -8 : 0,
          transition: 'bottom .2s ease, right .2s ease',
        }}
      >
        <button
          className="cs-minimap-toggle"
          onClick={toggleMinimap}
          title={minimapVisible ? 'Hide minimap' : 'Show minimap'}
        >
          {minimapVisible ? '⊟' : '⊞'}
        </button>
      </Panel>

      {nodes.length === 0 && (
        <div className="cs-canvas-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
            <path d="M20 8h2M2 8h2M20 16l1.5 1.5M2 16l-1.5 1.5"/>
          </svg>
          <p>Click <strong>+ Actor</strong> or drop from the explorer to add an AI actor</p>
          <p style={{ fontSize: 11, opacity: 0.6 }}>Use ⚡ Events or ⏱ Cron Jobs on an actor to create connections</p>
        </div>
      )}
    </ReactFlow>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  const store = useStore();

  // Auto-save: user-initiated graph mutations → debounced write to .jsonld.
  // Remote loads (loadGraph messages) set remoteLoad=true to suppress this.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useStore.subscribe((state, prev) => {
      if (state.graph !== prev.graph && !state.remoteLoad) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          vscode.postMessage({ type: 'saveGraph', graph: useStore.getState().graph });
        }, 400);
      }
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  // Message handler from extension
  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadGraph':      store.loadGraphFromRemote(msg.graph); break;
        case 'updatePrompts':  store.setPrompts(msg.prompts); break;
        case 'updateSettings': store.setSettings(msg.settings); break;
        case 'actorStatus':    store.setRunning(msg.name, msg.running); break;
        case 'actorOutput':
          store.appendOutput(msg.name, msg.output);
          break;
        case 'error':
          console.error('[Cantica Studio]', msg.message);
          break;
        case 'deleteSelected':
          if (store.selectedActorId) store.removeActor(store.selectedActorId);
          break;
        case 'resetGraph':     store.resetGraph(); break;
        case 'triggerSave':
          vscode.postMessage({ type: 'saveGraph', graph: useStore.getState().graph });
          break;
        default: {
          const _x: never = msg;
          void _x;
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cs-root">
      <GraphToolbar />
      <div className="cs-workspace">
        <main className="cs-canvas-root">
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </main>
      </div>

      {store.eventsModalActorId && <EventsModal />}
      {store.cronsModalActorId && <CronModal />}
      {store.propertiesModalActorId && <PropertiesModal />}
      {store.resourcesModalActorId && <ResourcesModal />}
      {store.activityModalActorId && <ActivityModal />}
      <ProviderMenu />
      <ActorMenu />
      <EdgeMenu />
    </div>
  );
}
