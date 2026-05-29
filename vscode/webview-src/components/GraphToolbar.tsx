import React from 'react';
import { useStore } from '../store';

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

export function GraphToolbar() {
  const { graph, addActor, explorerSide, setExplorerSide } = useStore();

  function handleSave() {
    vscode.postMessage({ type: 'saveGraph', graph });
  }

  function handleAddActor() {
    addActor({ x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 });
  }

  function handleRefreshPrompts() {
    vscode.postMessage({ type: 'refreshPrompts' });
  }

  function handleToggleSide() {
    const next = explorerSide === 'left' ? 'right' : 'left';
    setExplorerSide(next);
    vscode.postMessage({ type: 'explorerSideChanged', side: next });
  }

  return (
    <div className="cs-toolbar">
      <span className="cs-toolbar-title">{graph.name}</span>

      <div className="cs-toolbar-actions">
        <button className="cs-toolbar-btn" onClick={handleAddActor} title="Add AI Actor">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Actor
        </button>

        <button className="cs-toolbar-btn" onClick={handleSave} title="Save graph to .vscode/actors.jsonld">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>
          Save
        </button>

        <button className="cs-toolbar-btn" onClick={handleRefreshPrompts} title="Refresh prompt list from Cantica servers">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          Refresh
        </button>

        <button className="cs-toolbar-btn cs-toolbar-btn--side" onClick={handleToggleSide} title="Toggle sidebar side">
          {explorerSide === 'left' ? '⇥' : '⇤'}
        </button>
      </div>
    </div>
  );
}
