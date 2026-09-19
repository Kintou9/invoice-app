import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { ShieldAlert } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Ownership is the single most sensitive action in this app, so this is
// deliberately its own protected flow: pick an active manager/worker,
// re-confirm the caller's own password, and type the workspace name to
// confirm before anything happens.
export default function TransferOwnershipModal({ organizationName, candidates, onClose, onTransferred }) {
  const { user, switchOrganization } = useAuth();
  const [targetId, setTargetId] = useState(candidates[0]?.id || '');
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const selectRef = useRef(null);

  useEffect(() => { selectRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting]);

  const confirmed = confirmText.trim().toLowerCase() === organizationName.trim().toLowerCase();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!targetId) { toast.error('Choose who should become the new owner'); return; }
    if (!password) { toast.error('Your current password is required'); return; }
    if (!confirmed) { toast.error(`Type "${organizationName}" to confirm`); return; }

    setSubmitting(true);
    try {
      await api.post(`/users/${targetId}/transfer-ownership`, { password });
      toast.success('Ownership transferred — your role is now Manager');
      await switchOrganization(user.organizationId);
      onTransferred();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to transfer ownership');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="team-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <form className="team-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title" onSubmit={handleSubmit}>
        <div className="team-modal-header">
          <h3 id="transfer-title"><ShieldAlert size={17} /> Transfer ownership</h3>
          <button type="button" className="team-modal-close" onClick={onClose} disabled={submitting} aria-label="Close">×</button>
        </div>
        <p className="team-modal-subtitle">
          You'll become a Manager and lose owner-only access (billing, workspace settings). This can't be undone from here — the new owner would need to transfer it back.
        </p>

        {candidates.length === 0 ? (
          <p className="empty-msg">No active manager or worker is eligible yet — invite and activate someone first.</p>
        ) : (
          <>
            <label className="team-field" htmlFor="transfer-target">
              <span>New owner</span>
              <select id="transfer-target" ref={selectRef} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.role}</option>)}
              </select>
            </label>

            <label className="team-field" htmlFor="transfer-password">
              <span>Your current password</span>
              <input id="transfer-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>

            <label className="team-field" htmlFor="transfer-confirm">
              <span>Type <strong>{organizationName}</strong> to confirm</span>
              <input id="transfer-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} required />
            </label>
          </>
        )}

        <div className="team-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={submitting || candidates.length === 0}>
            {submitting ? 'Transferring...' : 'Transfer ownership'}
          </button>
        </div>
      </form>
    </div>
  );
}
