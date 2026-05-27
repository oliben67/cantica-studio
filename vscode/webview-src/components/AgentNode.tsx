import React, { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  namespace: string;
  name: string;
  description?: string;
}

export type AgentNodeType = Node<AgentNodeData, 'agentNode'>;

export const AgentNode = memo(function AgentNode({
  data,
  selected,
}: NodeProps<AgentNodeType>) {
  return (
    <div className={`cs-node ${selected ? 'cs-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="cs-node-handle cs-node-handle--in"
        aria-label="Input"
      />

      <div className="cs-node-header">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span className="cs-node-ns">{data.namespace}</span>
      </div>

      <div className="cs-node-name">{data.name}</div>

      {data.description && (
        <div className="cs-node-desc">{data.description}</div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="cs-node-handle cs-node-handle--out"
        aria-label="Output"
      />
    </div>
  );
});
