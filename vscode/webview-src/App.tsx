import React, { useCallback, useEffect, useState } from 'react';
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
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ActorNode } from './components/ActorNode';
import { ActorEdge, type ActorEdgeData } from './components/ActorEdge';
import { GraphToolbar } from './components/GraphToolbar';
import { ContextMenu } from './components/ContextMenu';
import { PromptModal } from './components/PromptModal';
import { EventsModal } from './components/EventsModal';
import { CronModal } from './components/CronModal';
import { ProviderMenu } from './components/ProviderMenu';
import { ActorMenu } from './components/ActorMenu';
import { PropertiesModal } from './components/PropertiesModal';
import { ResourcesModal } from './components/ResourcesModal';
import { useStore } from './store';
import type { ActorEdgeDef, IncomingMessage } from './types';
import { vscode } from './vscode';

const NODE_TYPES = { actorNode: ActorNode };
const EDGE_TYPES = { actorEdge: ActorEdge };

type CtxState = { type: 'actor' | 'edge'; id: string; x: number; y: number } | null;
type ModalState = { fromActorId: string; preselectedToId?: string; existingEdgeId?: string } | null;

// ── Canvas ────────────────────────────────────────────────────────────────────

interface CanvasProps {
  onCtxMenu: (s: CtxState) => void;
  onEdgeOpen: (edgeId: string) => void;
  onConnectRequest: (fromId: string, toId: string) => void;
}

function Canvas({ onCtxMenu, onEdgeOpen, onConnectRequest }: CanvasProps) {
  const store = useStore();
  const { minimapVisible, toggleMinimap } = store;
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Sync actors → nodes, preserving drag positions
  useEffect(() => {
    setNodes(prev => {
      const prevPos = new Map(prev.map(n => [n.id, n.position]));
      return store.graph.actors.map(actor => ({
        id: actor.id,
        type: 'actorNode' as const,
        position: prevPos.get(actor.id) ?? actor.position,
        data: { actor },
        selected: actor.id === store.selectedActorId,
      }));
    });
  }, [store.graph.actors, store.selectedActorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync edges from store
  useEffect(() => {
    setEdges(
      store.graph.edges.map(e => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'actorEdge' as const,
        data: { edge: e },
        selected: e.id === store.selectedEdgeId,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.targetEvent ? '#a78bfa' : '#7c3aed',
        },
      }))
    );
  }, [store.graph.edges, store.selectedEdgeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write drag result back to store
  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    store.updateActorPosition(node.id, node.position as { x: number; y: number });
  }, [store]);

  // Delete key via ReactFlow
  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const n of deleted) store.removeActor(n.id);
  }, [store]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) store.removeEdge(e.id);
  }, [store]);

  const onConnect = useCallback((conn: Connection) => {
    if (conn.source && conn.target) {
      onConnectRequest(conn.source, conn.target);
    }
  }, [onConnectRequest]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    store.selectActor(node.id);
  }, [store]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    store.selectEdge(edge.id);
    onEdgeOpen(edge.id);
  }, [store, onEdgeOpen]);

  const onPaneClick = useCallback(() => {
    store.selectActor(null);
    store.selectEdge(null);
    onCtxMenu(null);
  }, [store, onCtxMenu]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    onCtxMenu({ type: 'actor', id: node.id, x: e.clientX, y: e.clientY });
  }, [onCtxMenu]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    onCtxMenu({ type: 'edge', id: edge.id, x: e.clientX, y: e.clientY });
  }, [onCtxMenu]);

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
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
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
      {/* Toggle button — sits at top-right of minimap when visible, drops to corner when hidden.
          124 = minimap CSS height, 15 = ReactFlow panel bottom offset, 20 = button height, 4 = inner gap */}
      <Panel
        position="bottom-right"
        style={{ bottom: minimapVisible ? (15 + 124 - 20 - 4) : 10, transition: 'bottom .2s ease' }}
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
          <p style={{ fontSize: 11, opacity: 0.6 }}>Right-click an actor to connect it to another</p>
        </div>
      )}
    </ReactFlow>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  const store = useStore();
  const [ctxMenu, setCtxMenu] = useState<CtxState>(null);
  const [promptModal, setPromptModal] = useState<ModalState>(null);

  // Auto-save: any graph mutation → debounced write to .jsonld
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useStore.subscribe((state, prev) => {
      if (state.graph !== prev.graph) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          vscode.postMessage({ type: 'saveGraph', graph: useStore.getState().graph });
        }, 400);
      }
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Message handler from extension
  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadGraph':      store.setGraph(msg.graph); break;
        case 'updatePrompts':  store.setPrompts(msg.prompts); break;
        case 'updateSettings': store.setSettings(msg.settings); break;
        case 'actorStatus':    store.setRunning(msg.name, msg.running); break;
        case 'actorOutput':
          store.setOutput(msg.name, msg.output);
          store.setRunning(msg.name, false);
          break;
        case 'error':          console.error('[Cantica Studio]', msg.message); break;
        case 'deleteSelected':
          if (store.selectedActorId) store.removeActor(store.selectedActorId);
          else if (store.selectedEdgeId) store.removeEdge(store.selectedEdgeId);
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

  // Gear menu "Send Prompt To" → open PromptModal
  const sendPromptActorId = useStore(s => s.sendPromptActorId);
  const clearSendPrompt = useStore(s => s.clearSendPrompt);
  useEffect(() => {
    if (sendPromptActorId) {
      setPromptModal({ fromActorId: sendPromptActorId });
      clearSendPrompt();
    }
  }, [sendPromptActorId, clearSendPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCtxAction = useCallback((action: 'connect' | 'editEdge' | 'deleteEdge', id: string) => {
    if (action === 'connect') {
      setPromptModal({ fromActorId: id });
    } else if (action === 'editEdge') {
      const edge = store.graph.edges.find(e => e.id === id);
      if (edge) setPromptModal({ fromActorId: edge.from, existingEdgeId: id });
    } else if (action === 'deleteEdge') {
      store.removeEdge(id);
    }
  }, [store]);

  const handleEdgeOpen = useCallback((edgeId: string) => {
    const edge = store.graph.edges.find(e => e.id === edgeId);
    if (edge) setPromptModal({ fromActorId: edge.from, existingEdgeId: edgeId });
  }, [store]);

  const handleConnectRequest = useCallback((fromId: string, toId: string) => {
    setPromptModal({ fromActorId: fromId, preselectedToId: toId });
  }, []);

  return (
    <div className="cs-root">
      <GraphToolbar />
      <div className="cs-workspace">
        <main className="cs-canvas-root">
          <ReactFlowProvider>
            <Canvas
              onCtxMenu={setCtxMenu}
              onEdgeOpen={handleEdgeOpen}
              onConnectRequest={handleConnectRequest}
            />
          </ReactFlowProvider>
        </main>
      </div>

      {ctxMenu && (
        <ContextMenu
          type={ctxMenu.type}
          id={ctxMenu.id}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onAction={handleCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {promptModal && (
        <PromptModal
          fromActorId={promptModal.fromActorId}
          {...(promptModal.preselectedToId ? { preselectedToId: promptModal.preselectedToId } : {})}
          {...(promptModal.existingEdgeId ? { existingEdgeId: promptModal.existingEdgeId } : {})}
          onClose={() => setPromptModal(null)}
        />
      )}

      {store.eventsModalActorId && <EventsModal />}
      {store.cronsModalActorId && <CronModal />}
      {store.propertiesModalActorId && <PropertiesModal />}
      {store.resourcesModalActorId && <ResourcesModal />}
      <ProviderMenu />
      <ActorMenu />
    </div>
  );
}
