import React, { useMemo, useState } from 'react';
import type { CanticaNamespace, CanticaPrompt } from '../types';

interface AgentTreeProps {
  namespaces: CanticaNamespace[];
  prompts: CanticaPrompt[];
  error?: string;
  onOpenPrompt: (namespace: string, name: string) => void;
}

export interface DragAgentData {
  namespace: string;
  name: string;
  description?: string;
}

export function AgentTree({ namespaces, prompts, error, onOpenPrompt }: AgentTreeProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!filter.trim()) return prompts;
    const q = filter.toLowerCase();
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    );
  }, [prompts, filter]);

  const byNamespace = useMemo(() => {
    const map = new Map<string, CanticaPrompt[]>();
    for (const p of filtered) {
      const list = map.get(p.namespace) ?? [];
      list.push(p);
      map.set(p.namespace, list);
    }
    return map;
  }, [filtered]);

  const toggleNs = (ns: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });

  const startDrag = (e: React.DragEvent, data: DragAgentData) => {
    e.dataTransfer.setData('application/cantica-agent', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  };

  if (error) {
    return (
      <div className="cs-tree-error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
        <p className="cs-tree-error-msg">{error}</p>
        <p className="cs-tree-error-hint">
          Check <code>canticaScores.serverUrl</code> in Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="cs-tree">
      {/* Search */}
      <div className="cs-tree-search">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          className="cs-tree-search-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter actors…"
          aria-label="Filter AI actors"
        />
        {filter && (
          <button
            className="cs-tree-search-clear"
            onClick={() => setFilter('')}
            aria-label="Clear filter"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tree */}
      {namespaces.length === 0 ? (
        <div className="cs-tree-empty">
          <p>No AI actors loaded.</p>
          <p>Configure a Cantica server URL in Settings.</p>
        </div>
      ) : (
        <ul className="cs-tree-list" role="tree">
          {namespaces.map((ns) => {
            const items = byNamespace.get(ns.name) ?? [];
            const isOpen = !collapsed.has(ns.name);
            return (
              <li key={ns.name} role="treeitem" aria-expanded={isOpen}>
                <button
                  className="cs-ns-header"
                  onClick={() => toggleNs(ns.name)}
                >
                  {/* Chevron */}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`cs-chevron ${isOpen ? 'cs-chevron--open' : ''}`}
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  {/* Folder icon */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cs-accent-icon" aria-hidden="true">
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                  </svg>
                  <span className="cs-ns-name">{ns.name}</span>
                  <span className="cs-ns-count">{items.length}</span>
                </button>

                {isOpen && (
                  <ul className="cs-agent-list" role="group">
                    {items.length === 0 && filter ? (
                      <li className="cs-agent-empty">No matches</li>
                    ) : (
                      items.map((prompt) => (
                        <li
                          key={prompt.name}
                          className="cs-agent-item"
                          draggable
                          onDragStart={(e) =>
                            startDrag(e, {
                              namespace: prompt.namespace,
                              name: prompt.name,
                            ...(prompt.description !== undefined
                              ? { description: prompt.description }
                              : {}),
                            })
                          }
                          title="Drag onto the canvas to add to workflow"
                          role="treeitem"
                        >
                          <div className="cs-agent-row">
                            {/* Bot/agent icon */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <span className="cs-agent-name">{prompt.name}</span>
                            <button
                              className="cs-agent-link-btn"
                              onClick={() => onOpenPrompt(prompt.namespace, prompt.name)}
                              title="Open prompt in browser"
                              aria-label={`Open ${prompt.name} in browser`}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M15 3h6v6" />
                                <path d="M10 14 21 3" />
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              </svg>
                            </button>
                          </div>
                          {prompt.description && (
                            <p className="cs-agent-desc">{prompt.description}</p>
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
