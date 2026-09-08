import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import './LoginPage.css';

export default function AcceptInvitePage() {
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError('No invite token provided.'); return; }
    api.get(`/auth/invite/${token}`)
      .then((r) => setInvite(r.data))
      .catch((err) => setLoadError(err.response?.data?.error || 'This invite link is invalid.'));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!invite.hasPassword && form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvite(token, form.name, form.password);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to accept invite');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">Invite Not Available</h1>
          <p className="login-subtitle">{loadError}</p>
          <p className="login-switch">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-subtitle">Loading invite...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Join {invite.organizationName}</h1>
        <p className="login-subtitle">
          You've been invited as a <strong>{invite.role}</strong> — {invite.email}
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          {!invite.hasPassword && (
            <div className="form-group">
              <label htmlFor="name">Your Name</label>
              <input
                id="name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your name"
                required
                autoFocus
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="password">
              {invite.hasPassword ? 'Password (confirm your existing account)' : 'Choose a Password'}
            </label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={invite.hasPassword ? 'Your existing password' : 'At least 8 characters'}
              minLength={invite.hasPassword ? undefined : 8}
              required
              autoFocus={invite.hasPassword}
            />
          </div>
          {!invite.hasPassword && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Re-enter password"
                minLength={8}
                required
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
            {submitting ? 'Joining...' : `Join ${invite.organizationName}`}
          </button>
        </form>
      </div>
    </div>
  );
}
