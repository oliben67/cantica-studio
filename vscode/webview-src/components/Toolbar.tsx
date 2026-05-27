import React from 'react';

interface ToolbarProps {
  explorerSide: 'left' | 'right';
  serverUrl: string;
  onToggleSide: () => void;
  onRefresh: () => void;
}

export function Toolbar({ explorerSide, serverUrl, onToggleSide, onRefresh }: ToolbarProps) {
  const displayUrl = serverUrl.replace(/^https?:\/\//, '');

  return (
    <header className="cs-toolbar">
      <div className="cs-toolbar-brand">
        {/* BookOpen icon – matches Cantica frontend */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="cs-accent-icon"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <span>Cantica Scores</span>
      </div>

      <div className="cs-toolbar-server" title={serverUrl}>
        {displayUrl}
      </div>

      <div className="cs-toolbar-actions">
        <button
          className="cs-icon-btn"
          onClick={onRefresh}
          title="Refresh AI actors from Cantica server"
          aria-label="Refresh actors"
        >
          {/* Refresh icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>

        <button
          className="cs-icon-btn"
          onClick={onToggleSide}
          title={`Move explorer to the ${explorerSide === 'left' ? 'right' : 'left'}`}
          aria-label="Toggle explorer side"
        >
          {explorerSide === 'left' ? (
            /* Panel-right icon */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
            </svg>
          ) : (
            /* Panel-left icon */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
