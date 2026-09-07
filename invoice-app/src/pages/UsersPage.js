import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Plus, UserCog } from 'lucide-react';
import './ClaimsPage.css';
import './UsersPage.css';

const EMPTY_FORM = { name: '', email: '', password: '', role: 'technician' };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    api.get('/users').then((r) => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/users', form);
      setUsers((u) => [{ ...res.data, is_active: true }, ...u]);
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast.success('User created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setCreating(false);
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

  const handleToggleActive = async (id, isActive) => {
    setUpdatingId(id);
    try {
      const res = await api.patch(`/users/${id}`, { is_active: !isActive });
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, is_active: res.data.is_active } : x)));
      toast.success(res.data.is_active ? 'User activated' : 'User deactivated');
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
          <Plus size={16} /> Add User
        </button>
      </div>

      {showForm && (
        <form className="create-form" onSubmit={handleCreate}>
          <h2>New User</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={setField('name')} placeholder="Full name" required autoFocus />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={setField('email')} placeholder="you@company.com" required />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={form.password} onChange={setField('password')} placeholder="At least 8 characters" minLength={8} required />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select value={form.role} onChange={setField('role')}>
                <option value="technician">Technician</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create User'}</button>
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
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.name}
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
                        <option value="technician">Technician</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`status-badge status-toggle ${u.is_active ? 'status-approved' : 'status-rejected'}`}
                        disabled={isSelf || updatingId === u.id}
                        onClick={() => handleToggleActive(u.id, u.is_active)}
                        title={isSelf ? "You can't deactivate your own account" : 'Click to toggle'}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
