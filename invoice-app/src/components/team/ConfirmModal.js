import { useEffect, useRef } from 'react';

// Small shared confirmation modal for destructive Team actions (suspend,
// remove, cancel invite) — styled to match the Invite/Transfer modals
// rather than a bare window.confirm, with focus sent to itself on open so
// keyboard users land somewhere sensible.
export default function ConfirmModal({ title, body, confirmLabel, danger, busy, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="team-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="team-modal team-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1} ref={dialogRef}>
        <h3 id="confirm-title">{title}</h3>
        <p>{body}</p>
        <div className="team-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
