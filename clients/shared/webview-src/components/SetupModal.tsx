import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';
import type { SetupState } from '../types';

const DEFAULTS: SetupState = {
  mode: 'local',
  runMode: 'container',
  remoteUrl: '',
  setupDone: false,
  keys: { anthropicApiKey: 'none', openaiApiKey: 'none', geminiApiKey: 'none', githubToken: 'none' },
};

/**
 * First-time / reconfiguration setup form.
 *
 * Replaces the native QuickPick wizard: Studio mode (local/remote), run mode
 * (native CLI / Docker container), remote URL. Saving posts `saveSetup` to the
 * host, which persists settings and (re)starts the local studio when needed.
 * The host answers with a fresh `setupState`.
 */
function Inner({ initial }: { initial: SetupState }) {
  const { closeSetupModal, openProviderKeysModal } = useStore();

  const [mode, setMode] = useState<'local' | 'remote'>(initial.mode);
  const [runMode, setRunMode] = useState<'native' | 'container'>(initial.runMode);
  const [remoteUrl, setRemoteUrl] = useState(initial.remoteUrl);

  const remoteInvalid = mode === 'remote' && !/^https?:\/\/\S+$/.test(remoteUrl.trim());

  function save() {
    vscode.postMessage({
      type: 'saveSetup',
      mode,
      runMode,
      ...(mode === 'remote' ? { remoteUrl: remoteUrl.trim() } : {}),
    });
    closeSetupModal();
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeSetupModal}>
      <div className="cs-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">⚙️ Studio Setup</span>
          <button className="cs-modal-close" onClick={closeSetupModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          <label className="cs-prop-label">
            Studio mode
            <span className="cs-modal-hint"> — where the Studio API runs</span>
            <select
              className="cs-prop-select"
              value={mode}
              onChange={e => setMode(e.target.value as 'local' | 'remote')}
            >
              <option value="local">Local — this machine manages the server</option>
              <option value="remote">Remote — connect to an existing server</option>
            </select>
          </label>

          {mode === 'local' && (
            <label className="cs-prop-label">
              Run mode
              <span className="cs-modal-hint"> — how the local server starts</span>
              <select
                className="cs-prop-select"
                value={runMode}
                onChange={e => setRunMode(e.target.value as 'native' | 'container')}
              >
                <option value="native">Native — studio CLI (pip install cantica-studio-api)</option>
                <option value="container">Container — Docker Desktop</option>
              </select>
            </label>
          )}

          {mode === 'remote' && (
            <label className="cs-prop-label">
              Server URL
              <input
                className="cs-prop-input"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                placeholder="https://studio.example.com:8043"
                autoFocus
              />
            </label>
          )}

          {mode === 'local' && (
            <p className="cs-modal-hint" style={{ marginTop: 8 }}>
              Provider API keys are managed separately —{' '}
              <a
                href="#"
                onClick={e => { e.preventDefault(); closeSetupModal(); openProviderKeysModal(); }}
              >
                configure provider keys
              </a>.
            </p>
          )}
        </div>

        <div className="cs-modal-footer">
          <button
            className="cs-modal-btn cs-modal-btn--primary"
            onClick={save}
            disabled={remoteInvalid}
            title={remoteInvalid ? 'Enter a valid http(s) server URL' : undefined}
          >
            Save
          </button>
          <button className="cs-modal-btn" onClick={closeSetupModal}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function SetupModal() {
  const { setupState, setupModalOpen } = useStore();

  // Ask the host for fresh state on open; the response remounts Inner (keyed
  // below) so the form re-seeds without setState-in-effect.
  useEffect(() => {
    if (setupModalOpen) vscode.postMessage({ type: 'requestSetupState' });
  }, [setupModalOpen]);

  if (!setupModalOpen) return null;
  const state = setupState ?? DEFAULTS;
  return <Inner key={JSON.stringify(state)} initial={state} />;
}
