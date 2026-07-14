import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';
import type { AdminUser } from '../types';

/** Flags an admin can apply manually (spec REGISTRATION A.4). */
const ASSIGNABLE_FLAGS = [
  'warning:abuse', 'warning:suspicious', 'warning:none',
  'blocked:abuse', 'blocked:suspicious', 'blocked:none',
  'pending:roles', 'ok',
];

function flagClass(flag: string): string {
  if (flag.startsWith('blocked')) return 'cs-admin-flag--blocked';
  if (flag.startsWith('warning')) return 'cs-admin-flag--warning';
  if (flag === 'newbie') return 'cs-admin-flag--newbie';
  return 'cs-admin-flag--ok';
}

/**
 * User activation & flags screen (spec REGISTRATION C.pre.2 / A.4).
 *
 * The "auto-activated" checkbox mirrors the spec: checked shows everyone;
 * unchecked narrows the list to newbie users awaiting admin activation.
 */
export function AdminUsersModal() {
  const { adminData, closeAdminUsersModal, openDirectoryMappingsModal } = useStore();

  const [showAll, setShowAll] = useState(true);
  const [flagPicker, setFlagPicker] = useState<string | null>(null); // user id
  const [flagChoice, setFlagChoice] = useState(ASSIGNABLE_FLAGS[0] ?? 'ok');
  const [flagComment, setFlagComment] = useState('');

  useEffect(() => {
    vscode.postMessage({ type: 'requestAdminData' });
  }, []);

  const users: AdminUser[] = adminData?.users ?? [];
  const visible = showAll ? users : users.filter(u => u.flags.some(f => f.flag === 'newbie'));

  function activate(userId: string) {
    vscode.postMessage({ type: 'activateUser', userId });
  }

  function addFlag(userId: string) {
    if (!flagChoice) return;
    vscode.postMessage({ type: 'addUserFlag', userId, flag: flagChoice, comment: flagComment.trim() });
    setFlagPicker(null);
    setFlagComment('');
  }

  function removeFlag(userId: string, flagId: string) {
    vscode.postMessage({ type: 'removeUserFlag', userId, flagId });
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeAdminUsersModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">👥 Users — activation &amp; flags</span>
          <button className="cs-modal-close" onClick={closeAdminUsersModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          <label className="cs-prop-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
            />
            Show all users
            <span className="cs-modal-hint"> — uncheck to review new users awaiting activation</span>
          </label>

          {visible.length === 0 && (
            <p className="cs-modal-empty">
              {showAll ? 'No users on this server.' : 'No users awaiting activation.'}
            </p>
          )}

          {visible.map(u => (
            <div key={u.id} className="cs-modal-event-item">
              <div className="cs-modal-event-header">
                <span className="cs-modal-event-name" style={{ flex: 1, fontWeight: 600 }}>
                  {u.email}
                  {(u.first_name || u.last_name) && (
                    <span className="cs-modal-hint"> — {u.first_name} {u.last_name}</span>
                  )}
                </span>
                <span className="cs-modal-hint">{u.roles.join(', ') || 'no roles'}</span>
                {!u.is_active && (
                  <button
                    className="cs-modal-btn cs-modal-btn--primary"
                    style={{ padding: '1px 8px', fontSize: 10 }}
                    onClick={() => activate(u.id)}
                    title="Enable this account and clear its newbie flag"
                  >Enable</button>
                )}
                <button
                  className="cs-modal-btn"
                  style={{ padding: '1px 8px', fontSize: 10 }}
                  onClick={() => { setFlagPicker(flagPicker === u.id ? null : u.id); setFlagComment(''); }}
                >+ Flag</button>
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                <span className={`cs-admin-flag ${u.is_active ? 'cs-admin-flag--ok' : 'cs-admin-flag--blocked'}`}>
                  {u.is_active ? 'active' : 'disabled'}
                </span>
                {u.e_user_id && <span className="cs-admin-flag cs-admin-flag--ok" title="Enterprise user id">🏢 {u.e_user_id}</span>}
                {u.flags.map(f => (
                  <span key={f.id} className={`cs-admin-flag ${flagClass(f.flag)}`} title={f.comment || undefined}>
                    {f.flag}
                    <button
                      className="cs-modal-remove-btn"
                      style={{ marginLeft: 2 }}
                      title="Remove flag"
                      onClick={() => removeFlag(u.id, f.id)}
                    >✕</button>
                  </span>
                ))}
              </div>

              {flagPicker === u.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <select className="cs-prop-select" value={flagChoice} onChange={e => setFlagChoice(e.target.value)}>
                    {ASSIGNABLE_FLAGS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <input
                    className="cs-prop-input"
                    style={{ flex: 1 }}
                    placeholder="Comment (optional)"
                    value={flagComment}
                    onChange={e => setFlagComment(e.target.value)}
                  />
                  <button className="cs-modal-btn cs-modal-btn--primary" onClick={() => addFlag(u.id)}>Add</button>
                  <button className="cs-modal-btn" onClick={() => setFlagPicker(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="cs-modal-footer">
          <button
            className="cs-modal-btn"
            style={{ marginRight: 'auto' }}
            onClick={() => { closeAdminUsersModal(); openDirectoryMappingsModal(); }}
          >Directory mappings…</button>
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={closeAdminUsersModal}>Done</button>
        </div>
      </div>
    </div>
  );
}
