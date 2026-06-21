import React from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmModalProps) {
  return (
    <div className="cs-modal-overlay" onMouseDown={onCancel}>
      <div
        className="cs-modal cs-modal--confirm"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-confirm-title"
      >
        <div className="cs-modal-header">
          <span className="cs-modal-title" id="cs-confirm-title">{title}</span>
        </div>
        <div className="cs-modal-body">
          <p className="cs-confirm-message">{message}</p>
        </div>
        <div className="cs-modal-footer">
          <button className="cs-modal-btn" onClick={onCancel}>Cancel</button>
          <button
            className={`cs-modal-btn${danger ? ' cs-modal-btn--danger' : ' cs-modal-btn--primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
