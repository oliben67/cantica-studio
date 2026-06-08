import React, { useRef, useEffect } from 'react';
import { useStore } from '../store';
import type { LogEntry, McpLogEntry } from '../types';

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

type Row =
  | { kind: 'api'; ts: number; entry: LogEntry }
  | { kind: 'mcp'; ts: number; entry: McpLogEntry };

export function LogPanel() {
  const { logEntries, mcpLogEntries, clearLog } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const rows: Row[] = [
    ...logEntries.map((e): Row => ({ kind: 'api', ts: e.ts, entry: e })),
    ...mcpLogEntries.map((e): Row => ({ kind: 'mcp', ts: e.ts, entry: e })),
  ].sort((a, b) => a.ts - b.ts);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [rows.length]);

  return (
    <div className="cs-log-panel">
      <div className="cs-log-header">
        <span className="cs-actor-section-label" style={{ fontSize: 11 }}>Log</span>
        <span style={{ fontSize: 10, color: 'var(--cs-text-muted)', marginLeft: 6 }}>
          {rows.length} entries
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
        {rows.length === 0 ? (
          <span className="cs-log-empty">No activity yet — start an actor or load the graph to see activity</span>
        ) : (
          rows.map((row, i) => {
            if (row.kind === 'api') {
              const e = row.entry as LogEntry;
              return (
                <div key={i} className="cs-log-row">
                  <span className="cs-log-time">{hhmm(e.ts)}</span>
                  <span className="cs-log-method">{e.method}</span>
                  <span className="cs-log-url" title={e.url}>{e.url}</span>
                  <span className="cs-log-status" style={{ color: statusColor(e.status) }}>{e.status}</span>
                  <span className="cs-log-dur">{fmt(e.durationMs)}</span>
                </div>
              );
            } else {
              const e = row.entry as McpLogEntry;
              const argsStr = Object.entries(e.args).map(([k, v]) => `${k}=${v}`).join(' ');
              return (
                <div key={i} className="cs-log-row">
                  <span className="cs-log-time">{hhmm(e.ts)}</span>
                  <span
                    className="cs-log-method"
                    style={{ color: '#a78bfa', fontSize: 9, letterSpacing: '0.04em' }}
                  >
                    MCP
                  </span>
                  <span className="cs-log-url" title={argsStr || e.tool}>{e.tool}</span>
                  <span
                    className="cs-log-status"
                    style={{ color: e.status === 'ok' ? '#22c55e' : 'var(--cs-danger, #ef4444)' }}
                  >
                    {e.status}
                  </span>
                  <span className="cs-log-dur">{fmt(e.durationMs)}</span>
                </div>
              );
            }
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
