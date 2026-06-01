import React, { useEffect, useRef } from 'react';

interface Props {
  type: 'actor' | 'edge';
  id: string;
  x: number;
  y: number;
  onAction: (action: 'connect' | 'editEdge' | 'deleteEdge', id: string) => void;
  onClose: () => void;
}

export function ContextMenu({ type, id, x, y, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="cs-ctx-menu" style={{ left: x, top: y }}>
      {type === 'actor' && (
        <button className="cs-ctx-item" onClick={() => { onAction('connect', id); onClose(); }}>
          → Send Prompt To…
        </button>
      )}
      {type === 'edge' && (
        <>
          <button className="cs-ctx-item" onClick={() => { onAction('editEdge', id); onClose(); }}>
            Edit Prompt…
          </button>
          <div className="cs-ctx-sep" />
          <button className="cs-ctx-item cs-ctx-item--danger" onClick={() => { onAction('deleteEdge', id); onClose(); }}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}
