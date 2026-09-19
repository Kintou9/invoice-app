import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Mail, Check } from 'lucide-react';
import api from '../../services/api';
import { ROLE_PERMISSIONS, ASSIGNABLE_ROLES } from '../../utils/rolePermissions';

const EXPIRY_OPTIONS = [7, 14, 30];

export default function InviteMemberModal({ organizationName, onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('worker');
  const [message, setMessage] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [sending, setSending] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending]);

  const permissions = ROLE_PERMISSIONS[role];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toast.error('An email address is required'); return; }
    setSending(true);
    try {
      const res = await api.post('/users', {
        email: email.trim(), role, message: message.trim() || undefined, expires_in_days: expiresInDays,
      });
      if (res.data.emailError) toast.warning(res.data.emailError);
      else toast.success('Invitation sent');
      onInvited(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="team-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <form className="team-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onSubmit={handleSubmit}>
        <div className="team-modal-header">
          <h3 id="invite-title">Invite member</h3>
          <button type="button" className="team-modal-close" onClick={onClose} disabled={sending} aria-label="Close">×</button>
        </div>
        <p className="team-modal-subtitle">Invite someone to {organizationName}.</p>

        <label className="team-field" htmlFor="invite-email">
          <span>Email address</span>
          <div className="team-input-icon">
            <Mail size={15} />
            <input id="invite-email" ref={emailRef} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
        </label>

        <label className="team-field" htmlFor="invite-role">
          <span>Role</span>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>)}
          </select>
        </label>

        <div className="team-permission-preview">
          <strong><permissions.icon size={14} /> {permissions.label} access</strong>
          <ul>
            {permissions.can.map((line) => <li key={line}><Check size={13} /> {line}</li>)}
          </ul>
          {permissions.cannot.map((line) => <p key={line} className="team-permission-cannot">{line}</p>)}
        </div>

        <label className="team-field" htmlFor="invite-message">
          <span>Optional message</span>
          <textarea id="invite-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a short welcome message..." />
        </label>

        <label className="team-field" htmlFor="invite-expiry">
          <span>Invitation expiry</span>
          <select id="invite-expiry" value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((n) => <option key={n} value={n}>{n} days</option>)}
          </select>
        </label>

        <div className="team-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? 'Sending...' : 'Send invitation'}</button>
        </div>
        <p className="team-modal-footnote">The invitation will be scoped to {organizationName}.</p>
      </form>
    </div>
  );
}
