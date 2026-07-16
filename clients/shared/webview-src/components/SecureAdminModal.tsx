import React, { useMemo, useState } from 'react';
import {
  AdminUsersPanel,
  ApiTokensPanel,
  DirectoryMappingsPanel,
  SecureProvider,
  createBridgeTransport,
  studioTheme,
} from '@cantica/secure-ui';
import '@cantica/secure-ui/styles.css';
import { useStore } from '../store';
import { vscode } from '../vscode';

/**
 * Extraction roadmap Phase E — mounts the shared @cantica/secure-ui admin
 * panels inside the studio webview over a postMessage bridge transport. The
 * bridge relays each request to the extension host / Electron main (via
 * StudioClient.secureRequest), so the bearer token never enters the
 * CSP-restricted webview. The in-repo AdminUsersModal / DirectoryMappingsModal
 * remain in the tree as the non-shim fallback.
 */
type Tab = 'users' | 'directory' | 'tokens';

export function SecureAdminModal() {
  const { closeSecureAdminModal } = useStore();
  const [tab, setTab] = useState<Tab>('users');

  const transport = useMemo(
    () =>
      createBridgeTransport({
        post: (msg: unknown) => vscode.postMessage(msg as never),
        subscribe: (handler: (m: unknown) => void) => {
          const listener = (e: MessageEvent) => handler(e.data);
          window.addEventListener('message', listener);
          return () => window.removeEventListener('message', listener);
        },
      }),
    [],
  );

  return (
    <div className="cs-modal-overlay" onMouseDown={closeSecureAdminModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">🛡 Security</span>
          <button className="cs-modal-close" onClick={closeSecureAdminModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          <div className="cs-secure-tabs">
            {(['users', 'directory', 'tokens'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`cs-secure-tab${tab === t ? ' cs-secure-tab--active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'users' ? 'Users' : t === 'directory' ? 'Directory' : 'API Tokens'}
              </button>
            ))}
          </div>

          <SecureProvider transport={transport} theme={studioTheme}>
            {tab === 'users' && <AdminUsersPanel />}
            {tab === 'directory' && <DirectoryMappingsPanel />}
            {tab === 'tokens' && <ApiTokensPanel />}
          </SecureProvider>
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={closeSecureAdminModal}>Done</button>
        </div>
      </div>
    </div>
  );
}
