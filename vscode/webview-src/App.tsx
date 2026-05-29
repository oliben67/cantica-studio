import React, { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ActorNode, type ActorNodeType } from './components/ActorNode';
import { ActorEdge, type ActorEdgeData } from './components/ActorEdge';
import { ActorPropertiesPanel } from './components/ActorPropertiesPanel';
import { GraphToolbar } from './components/GraphToolbar';
import { useStore } from './store';
import type { AIActorDef, ActorEdgeDef, IncomingMessage, VscodeApi } from './types';

declare function acquireVsCodeApi(): VscodeApi;
const vscode = acquireVsCodeApi();

const NODE_TYPES = { actorNode: ActorNode };
const EDGE_TYPES = { actorEdge: ActorEdge };

// ── Canvas ────────────────────────────────────────────────────────────────────

function Canvas() {
  const store = useStore();
  const { screenToFlowPosition } = useReactFlow();

  // Sync ReactFlow state from the zustand store
  const rfNodes: Node[] = store.graph.actors.map((a) => ({
    id: a.id,
    type: 'actorNode',
    position: a.position,
    data: { actor: a },
    selected: a.id === store.selectedActorId,
  }));

  const rfEdges: Edge[] = store.graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'actorEdge',
    data: { edge: e },
    selected: e.id === store.selectedEdgeId,
  }));

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Keep ReactFlow nodes in sync when store changes
  useEffect(() => {
    // Sync node positions back to store on drag
    for (const n of nodes) {
      const actor = store.graph.actors.find((a) => a.id === n.id);
      if (actor && (actor.position.x !== n.position.x || actor.position.y !== n.position.y)) {
        store.updateActorPosition(n.id, n.position);
      }
    }
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => addEdge({ ...conn, type: 'actorEdge' }, eds));
      store.addEdge({
        from: conn.source ?? '',
        to: conn.target ?? '',
        prompt: {},
        label: 'message',
      });
    },
    [setEdges, store],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => store.selectActor(node.id),
    [store],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => store.selectEdge(edge.id),
    [store],
  );

  const onPaneClick = useCallback(() => {
    store.selectActor(null);
    store.selectEdge(null);
  }, [store]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      store.addActor(pos);
    },
    [screenToFlowPosition, store],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      colorMode="dark"
      deleteKeyCode="Delete"
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="cs-rf-bg" />
      <Controls className="cs-rf-controls" />
      <MiniMap className="cs-rf-minimap" nodeColor="#7c3aed" maskColor="rgba(9,9,11,0.65)" />

      {rfNodes.length === 0 && (
        <div className="cs-canvas-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
            <path d="M20 8h2M2 8h2M20 16l1.5 1.5M2 16l-1.5 1.5"/>
          </svg>
          <p>Click <strong>+ Actor</strong> or drop from the explorer to add an AI actor</p>
        </div>
      )}
    </ReactFlow>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  const store = useStore();

  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadGraph':
          store.setGraph(msg.graph);
          break;
        case 'updatePrompts':
          store.setPrompts(msg.prompts);
          break;
        case 'updateSettings':
          store.setSettings(msg.settings);
          break;
        case 'actorStatus':
          store.setRunning(msg.name, msg.running);
          break;
        case 'actorOutput':
          store.setOutput(msg.name, msg.output);
          store.setRunning(msg.name, false);
          break;
        case 'error':
          console.error('[Cantica Studio]', msg.message);
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

  const side = store.explorerSide;

  const promptBrowser = (
    <aside className="cs-explorer">
      <div className="cs-explorer-header">Prompts</div>
      <ul className="cs-prompt-list">
        {store.prompts.map((p) => (
          <li
            key={`${p._server}/${p.namespace}/${p.name}`}
            className="cs-prompt-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                'application/cantica-prompt',
                JSON.stringify({ uri: `cantica://${p.namespace}/${p.name}` }),
              );
            }}
            title={p.description}
          >
            <span className="cs-prompt-slug">{p.namespace}/{p.name}</span>
            {p.description && <span className="cs-prompt-desc">{p.description}</span>}
          </li>
        ))}
        {store.prompts.length === 0 && (
          <li className="cs-prompt-empty">No prompts loaded. Configure a Cantica server.</li>
        )}
      </ul>
    </aside>
  );

  return (
    <div className="cs-root">
      <GraphToolbar />
      <div className="cs-workspace">
        {side === 'left' && promptBrowser}
        <main className="cs-canvas-root">
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </main>
        <ActorPropertiesPanel />
        {side === 'right' && promptBrowser}
      </div>
    </div>
  );
}
