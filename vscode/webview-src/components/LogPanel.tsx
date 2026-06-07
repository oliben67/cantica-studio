import React, { useRef, useEffect } from 'react';
import { useStore } from '../store';

function statusColor(status: number): string {
  if (status >= 500) return 'var(--cs-danger, #ef4444)';
  if (status >= 400) return '#f59e0b';
  if (status >= 200 && status < 300) return '#22c55e';
  return 'var(--cs-text-muted, #888)';
}

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function LogPanel() {
  const { logEntries, clearLog } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logEntries.length]);

  return (
    <div className="cs-log-panel">
      <div className="cs-log-header">
        <span className="cs-actor-section-label" style={{ fontSize: 11 }}>API Log</span>
        <span style={{ fontSize: 10, color: 'var(--cs-text-muted)', marginLeft: 6 }}>
          {logEntries.length} calls
        </span>
        <button
          className="cs-actor-expand-btn"
          onClick={clearLog}
          title="Clear log"
          style={{ marginLeft: 'auto', fontSize: 10 }}
        >
          ✕ Clear
        </button>
      </div>
      <div className="cs-log-entries">
        {logEntries.length === 0 ? (
          <span className="cs-log-empty">No API calls yet — start an actor or load the graph to see activity</span>
        ) : (
          logEntries.map((e, i) => (
            <div key={i} className="cs-log-row">
              <span className="cs-log-time">{hhmm(e.ts)}</span>
              <span className="cs-log-method">{e.method}</span>
              <span className="cs-log-url" title={e.url}>{e.url}</span>
              <span className="cs-log-status" style={{ color: statusColor(e.status) }}>{e.status}</span>
              <span className="cs-log-dur">{fmt(e.durationMs)}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
