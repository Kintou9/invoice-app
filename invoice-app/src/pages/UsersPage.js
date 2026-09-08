import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Plus, UserCog, Send } from 'lucide-react';
import './ClaimsPage.css';
import './UsersPage.css';

const EMPTY_FORM = { email: '', role: 'worker' };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviting, setInviting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    api.get('/users').then((r) => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await api.post('/users', form);
      setUsers((u) => [res.data, ...u]);
      setShowForm(false);
      setForm(EMPTY_FORM);
      if (res.data.emailError) toast.warning(res.data.emailError);
      else toast.success('Invite sent');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (id) => {
    setUpdatingId(id);
    try {
      const res = await api.post(`/users/${id}/resend-invite`);
      if (res.data.message === 'Invite resent') toast.success(res.data.message);
      else toast.warning(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to resend invite');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRoleChange = async (id, role) => {
    setUpdatingId(id);
    try {
      const res = await api.patch(`/users/${id}`, { role });
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, role: res.data.role } : x)));
      toast.success('Role updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    setUpdatingId(id);
    try {
      const nextStatus = currentStatus === 'active' ? 'disabled' : 'active';
      const res = await api.patch(`/users/${id}`, { status: nextStatus });
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, status: res.data.status } : x)));
      toast.success(res.data.status === 'active' ? 'User activated' : 'User deactivated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update user');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="claims-page">
      <div className="page-header">
        <h1>Users</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> Invite Member
        </button>
      </div>

      {showForm && (
        <form className="create-form" onSubmit={handleInvite}>
          <h2>Invite a Member</h2>
          <p className="template-hint">
            They'll get an email with a link to set up their account. You don't need
            their password — they'll choose their own.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={setField('email')} placeholder="you@company.com" required autoFocus />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select value={form.role} onChange={setField('role')}>
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={inviting}>{inviting ? 'Sending...' : 'Send Invite'}</button>
          </div>
        </form>
      )}

      {loading ? <p>Loading...</p> : (
        <div className="claims-table-wrap">
          <table className="claims-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.name || <span className="unassigned">Pending</span>}
                      {isSelf && <span className="you-badge"><UserCog size={12} /> You</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="reassign-select"
                        value={u.role}
                        disabled={isSelf || updatingId === u.id}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      >
                        <option value="worker">Worker</option>
                        <option value="manager">Manager</option>
                        <option value="owner">Owner</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`status-badge status-toggle ${u.status === 'active' ? 'status-approved' : 'status-rejected'}`}
                        disabled={isSelf || updatingId === u.id}
                        onClick={() => handleToggleStatus(u.id, u.status)}
                        title={isSelf ? "You can't deactivate your own account" : 'Click to toggle'}
                      >
                        {u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invited' : 'Disabled'}
                      </button>
                    </td>
                    <td>{new Date(u.joined_at || u.created_at).toLocaleDateString()}</td>
                    <td>
                      {u.status === 'invited' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={updatingId === u.id}
                          onClick={() => handleResend(u.id)}
                        >
                          <Send size={12} /> Resend
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={6} className="empty-cell">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
