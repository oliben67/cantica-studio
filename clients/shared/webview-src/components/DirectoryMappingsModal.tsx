import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { vscode } from '../vscode';

/**
 * Directory group → role mapping screen (spec REGISTRATION B.pre.2).
 *
 * Maps external directory groups (AD DNs, OIDC groups-claim values) to Studio
 * roles; directory logins assign users the roles their groups map to.
 */
export function DirectoryMappingsModal() {
  const { adminData, closeDirectoryMappingsModal } = useStore();

  const [group, setGroup] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    vscode.postMessage({ type: 'requestAdminData' });
  }, []);

  const mappings = adminData?.mappings ?? [];
  const roles = adminData?.roles ?? [];
  const effectiveRole = role || roles[0] || '';

  function add() {
    if (!group.trim() || !effectiveRole) return;
    vscode.postMessage({ type: 'addDirectoryMapping', externalGroup: group.trim(), roleName: effectiveRole });
    setGroup('');
  }

  function remove(mappingId: string) {
    vscode.postMessage({ type: 'removeDirectoryMapping', mappingId });
  }

  return (
    <div className="cs-modal-overlay" onMouseDown={closeDirectoryMappingsModal}>
      <div className="cs-modal cs-modal--wide" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-modal-header">
          <span className="cs-modal-title">🗂 Directory group → role mappings</span>
          <button className="cs-modal-close" onClick={closeDirectoryMappingsModal}>✕</button>
        </div>

        <div className="cs-modal-body">
          <p className="cs-modal-hint">
            Users signing in through the enterprise directory (LDAP / OIDC) receive the
            roles their groups map to. A group may map to several roles; users whose
            groups map to nothing get the default roles and a newbie flag for review.
          </p>

          {mappings.length === 0 && (
            <p className="cs-modal-empty">No mappings yet — directory users will land in limbo.</p>
          )}

          {mappings.map(m => (
            <div key={m.id} className="cs-modal-event-item">
              <div className="cs-modal-event-header">
                <span className="cs-modal-event-name" style={{ flex: 1 }}>{m.external_group}</span>
                <span className="cs-actor-badge" style={{ background: '#6b7280' }}>{m.role}</span>
                <button className="cs-modal-remove-btn" title="Remove mapping" onClick={() => remove(m.id)}>✕</button>
              </div>
            </div>
          ))}

          <div className="cs-modal-event-item">
            <div className="cs-modal-event-header">
              <span className="cs-modal-event-section">New mapping</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                className="cs-prop-input"
                style={{ flex: 1 }}
                placeholder="cn=studio-operators,dc=corp,dc=example  /  groups-claim value"
                value={group}
                onChange={e => setGroup(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); }}
              />
              <select className="cs-prop-select" value={effectiveRole} onChange={e => setRole(e.target.value)}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                className="cs-modal-btn cs-modal-btn--primary"
                onClick={add}
                disabled={!group.trim() || !effectiveRole}
              >Add</button>
            </div>
          </div>
        </div>

        <div className="cs-modal-footer">
          <button className="cs-modal-btn cs-modal-btn--primary" onClick={closeDirectoryMappingsModal}>Done</button>
        </div>
      </div>
    </div>
  );
}
