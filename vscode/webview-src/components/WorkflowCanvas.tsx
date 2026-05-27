import React, { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode, type AgentNodeData, type AgentNodeType } from './AgentNode';
import type { CanticaNamespace, CanticaPrompt } from '../types';
import type { DragAgentData } from './AgentTree';

const NODE_TYPES = { agentNode: AgentNode };

let _idSeq = 0;
const nextId = () => `actor-${(++_idSeq).toString()}`;

interface WorkflowCanvasInnerProps {
  onSave: (workflow: unknown) => void;
}

/** Inner component – has access to ReactFlowProvider context. */
function WorkflowCanvasInner({ onSave }: WorkflowCanvasInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { screenToFlowPosition, toObject } = useReactFlow();

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/cantica-agent');
      if (!raw) return;

      let payload: DragAgentData;
      try {
        payload = JSON.parse(raw) as DragAgentData;
      } catch {
        return;
      }

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const data: AgentNodeData = {
        label: payload.name,
        namespace: payload.namespace,
        name: payload.name,
        ...(payload.description !== undefined ? { description: payload.description } : {}),
      };

      setNodes((nds) => [
        ...nds,
        { id: nextId(), type: 'agentNode', position, data },
      ]);
    },
    [screenToFlowPosition, setNodes],
  );

  const handleSave = useCallback(() => {
    onSave(toObject());
  }, [onSave, toObject]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={NODE_TYPES}
      fitView
      colorMode="dark"
      deleteKeyCode="Delete"
      proOptions={{ hideAttribution: false }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        className="cs-rf-bg"
      />
      <Controls className="cs-rf-controls" />
      <MiniMap
        className="cs-rf-minimap"
        nodeColor="#7c3aed"
        maskColor="rgba(9,9,11,0.65)"
      />

      {/* Top-right panel: Save button */}
      <Panel position="top-right">
        <button className="cs-save-btn" onClick={handleSave}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
            <path d="M7 3v4a1 1 0 0 0 1 1h7" />
          </svg>
          Save
        </button>
      </Panel>

      {/* Centre hint when canvas is empty */}
      {nodes.length === 0 && (
        <Panel position="top-center" className="cs-canvas-hint-panel">
          <div className="cs-canvas-hint">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <p>Drag AI actors from the explorer onto the canvas</p>
            <p className="cs-canvas-hint-sub">Connect actors to build a workflow</p>
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}

interface WorkflowCanvasProps {
  namespaces: CanticaNamespace[];
  prompts: CanticaPrompt[];
  onSave: (workflow: unknown) => void;
}

export function WorkflowCanvas({ onSave }: WorkflowCanvasProps) {
  return (
    <div className="cs-canvas-root">
      <WorkflowCanvasInner onSave={onSave} />
    </div>
  );
}
