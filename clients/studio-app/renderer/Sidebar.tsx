import React, { useEffect, useState } from 'react';
import type { SongbookEntry, SongbookFileEntry, SongbookFolderEntry } from '../../shared/types/index.js';
import { vscode } from './vscode-electron.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StudioStatus {
  health: 'healthy' | 'starting' | 'down';
  url: string;
  version?: string;
  uptimeSeconds?: number;
  workspace?: string;
  containerized?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(s)}s`;
}

function shortenPath(p: string): string {
  const m = p.match(/^\/home\/[^/]+\/(.+)$/);
  if (m) return `~/${m[1] ?? ''}`;
  return p.length > 36 ? `…${p.slice(-33)}` : p;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconPlay = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
    <path d="M3.5 2.5l9 5.5-9 5.5V2.5z"/>
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
    <rect x="3" y="3" width="10" height="10" rx="1"/>
  </svg>
);

const IconRestart = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
    <path d="M8 2a6 6 0 1 0 5.657 8H12.1A4.5 4.5 0 1 1 8 3.5V2z"/>
    <path d="M8 0v4l3-2-3-2z"/>
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
    <path d="M13.451 5.609c-.506-1.335-1.506-2.509-2.85-3.147a6.007 6.007 0 0 0-5.738.267A6.073 6.073 0 0 0 2.35 5.623L1 5.2v4.103l3.537-2.042-.87-.5A4.478 4.478 0 0 1 5.6 4.028a4.505 4.505 0 0 1 4.3-.2 4.533 4.533 0 0 1 2.16 2.382l1.391-.601zM15 6.696l-3.537 2.042.87.5A4.478 4.478 0 0 1 10.4 11.972a4.505 4.505 0 0 1-4.3.2 4.533 4.533 0 0 1-2.16-2.382l-1.39.6c.506 1.336 1.506 2.51 2.85 3.148a6.007 6.007 0 0 0 5.737-.267 6.073 6.073 0 0 0 2.713-2.894L15 10.8V6.696z"/>
  </svg>
);

// ── Songbook tree items ───────────────────────────────────────────────────────

function SongbookFile({ entry, activeFile }: { entry: SongbookFileEntry; activeFile: string | null }) {
  const isActive = entry.path === activeFile;
  return (
    <button
      className={`cs-sb-file${isActive ? ' cs-sb-file--active' : ''}`}
      onClick={() => vscode.postMessage({ type: 'openSongbook', path: entry.path })}
      title={entry.path}
    >
      <span className="cs-sb-dot">{isActive ? '●' : '○'}</span>
      <span className="cs-sb-name">{entry.name}</span>
    </button>
  );
}

function SongbookFolder({ entry, activeFile, depth }: { entry: SongbookFolderEntry; activeFile: string | null; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  return (
    <div>
      <button className="cs-sb-folder" onClick={() => setOpen(o => !o)}>
        <span className={`cs-chevron${open ? ' cs-chevron--open' : ''}`}>▶</span>
        <span className="cs-sb-name">{entry.name}</span>
      </button>
      {open && (
        <div className="cs-sb-children">
          {entry.children.map(child =>
            child.type === 'folder'
              ? <SongbookFolder key={child.path} entry={child} activeFile={activeFile} depth={depth + 1} />
              : <SongbookFile key={child.path} entry={child} activeFile={activeFile} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const [songbooks, setSongbooks] = useState<SongbookEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioStatus | null>(null);
  const [studioMode, setStudioMode] = useState<'native' | 'container'>('container');

  useEffect(() => {
    const handler = (e: MessageEvent<Record<string, unknown>>) => {
      const msg = e.data;
      if (msg['type'] === 'updateSongbooks') {
        setSongbooks(msg['entries'] as SongbookEntry[]);
        setActiveFile(msg['activeFile'] as string | null);
      } else if (msg['type'] === 'studioStatus') {
        setStudio({
          health: msg['health'] as StudioStatus['health'],
          url: msg['url'] as string,
          version: msg['version'] as string | undefined,
          uptimeSeconds: msg['uptimeSeconds'] as number | undefined,
          workspace: msg['workspace'] as string | undefined,
          containerized: msg['containerized'] as boolean | undefined,
        });
      } else if (msg['type'] === 'studioMode') {
        setStudioMode(msg['mode'] as 'native' | 'container');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const isDown = studio == null || studio.health === 'down';
  const isRunning = studio != null && studio.health !== 'down';

  return (
    <aside className="cs-explorer">

      {/* ── Songbooks ── */}
      <div className="cs-sb-section">
        <div className="cs-sb-header">
          <span className="cs-sb-title">Songbooks</span>
          <button
            className="cs-sb-icon-btn"
            title="Refresh"
            onClick={() => vscode.postMessage({ type: 'refreshSongbooks' })}
          >
            <IconRefresh />
          </button>
        </div>
        <div className="cs-sb-tree">
          {songbooks.length === 0 ? (
            <p className="cs-tree-empty">No songbooks found</p>
          ) : (
            songbooks.map(entry =>
              entry.type === 'folder'
                ? <SongbookFolder key={entry.path} entry={entry} activeFile={activeFile} depth={0} />
                : <SongbookFile key={entry.path} entry={entry} activeFile={activeFile} />
            )
          )}
        </div>
      </div>

      {/* ── Studio ── */}
      <div className="cs-sb-studio-section">
        <div className="cs-sb-header">
          <span className="cs-sb-title">Studio</span>
          <div className="cs-sb-icon-row">
            <button
              className={`cs-sb-mode-btn${studioMode === 'native' ? ' cs-sb-mode-btn--active' : ''}`}
              title={studioMode === 'native' ? 'Switch to container mode' : 'Switch to native mode'}
              onClick={() => vscode.postMessage({ type: 'setStudioMode', mode: studioMode === 'native' ? 'container' : 'native' })}
            >{studioMode === 'native' ? 'N' : 'C'}</button>
            <button
              className="cs-sb-icon-btn"
              title="Start Studio API"
              disabled={!isDown}
              onClick={() => vscode.postMessage({ type: 'startLocalStudio' })}
            >
              <IconPlay />
            </button>
            <button
              className="cs-sb-icon-btn"
              title="Restart Studio API"
              disabled={!isRunning}
              onClick={() => { vscode.postMessage({ type: 'stopLocalStudio' }); setTimeout(() => vscode.postMessage({ type: 'startLocalStudio' }), 1500); }}
            >
              <IconRestart />
            </button>
            <button
              className="cs-sb-icon-btn"
              title="Stop Studio API"
              disabled={!isRunning}
              onClick={() => vscode.postMessage({ type: 'stopLocalStudio' })}
            >
              <IconStop />
            </button>
          </div>
        </div>

        <div className="cs-sb-studio-body">
          {studio == null ? (
            <span className="cs-sb-studio-connecting">Connecting…</span>
          ) : (
            <>
              <div className="cs-sb-studio-row">
                <span className={`cs-sb-dot-status cs-sb-dot-status--${studio.health}`} />
                <span className="cs-sb-studio-name">
                  {studio.health === 'healthy' ? 'Running' : studio.health === 'starting' ? 'Starting…' : 'Stopped'}
                </span>
              </div>
              {studio.health === 'healthy' && (
                <div className="cs-sb-studio-details">
                  <span className="cs-sb-studio-detail" title={studio.url}>{studio.url}</span>
                  <span className="cs-sb-studio-detail cs-sb-studio-detail--muted">
                    {[
                      studio.version !== undefined ? `v${studio.version}` : null,
                      studio.uptimeSeconds !== undefined ? `up ${formatUptime(studio.uptimeSeconds)}` : null,
                    ].filter(Boolean).join('  ·  ')}
                  </span>
                  {studio.workspace !== undefined && (
                    <span className="cs-sb-studio-detail cs-sb-studio-detail--muted" title={studio.workspace}>
                      {shortenPath(studio.workspace)}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </aside>
  );
}
