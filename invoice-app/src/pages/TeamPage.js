import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Avatar from '../components/shared/Avatar';
import { ROLE_PERMISSIONS } from '../utils/rolePermissions';
import { formatWorkload } from '../utils/teamWorkload';
import InviteMemberModal from '../components/team/InviteMemberModal';
import TransferOwnershipModal from '../components/team/TransferOwnershipModal';
import MemberDrawer from '../components/team/MemberDrawer';
import ConfirmModal from '../components/team/ConfirmModal';
import { Search, Plus, Users, Mail, UserCheck, Send, X, Lock } from 'lucide-react';
import './TeamPage.css';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'Now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function TeamPage() {
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [tab, setTab] = useState('members');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [selectedId, setSelectedId] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [pendingBusyId, setPendingBusyId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = () => {
    setError(null);
    Promise.all([api.get('/users'), api.get('/claims')])
      .then(([usersRes, claimsRes]) => {
        setMembers(usersRes.data);
        setClaims(claimsRes.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load the team'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active' || m.status === 'disabled'), [members]);
  const pendingInvites = useMemo(() => members.filter((m) => m.status === 'invited'), [members]);
  const workersAvailable = useMemo(() => members.filter((m) => m.role === 'worker' && m.status === 'active').length, [members]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeMembers.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (q && !(m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeMembers, search, roleFilter, statusFilter]);

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pendingInvites.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (q && !(m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [pendingInvites, search, roleFilter]);

  const selected = members.find((m) => m.id === selectedId) || null;
  const owner = members.find((m) => m.role === 'owner');
  const isOwner = currentUser.role === 'owner';
  const transferCandidates = members.filter((m) => m.status === 'active' && ['manager', 'worker'].includes(m.role));

  const handleResend = async (id) => {
    setPendingBusyId(id);
    try {
      const res = await api.post(`/users/${id}/resend-invite`);
      if (res.data.message === 'Invite resent') toast.success('Invite resent');
      else toast.warning(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to resend invite');
    } finally {
      setPendingBusyId(null);
    }
  };

  const handleCancelInvite = async () => {
    setPendingBusyId(cancelTarget.id);
    try {
      await api.delete(`/users/${cancelTarget.id}`);
      toast.success('Invitation canceled');
      setCancelTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel invitation');
    } finally {
      setPendingBusyId(null);
    }
  };

  if (loading) return <p>Loading team...</p>;
  if (error) return <p className="empty-msg">{error}</p>;

  return (
    <div className="team-page">
      <div className="team-header">
        <div>
          <h1>Team</h1>
          <p className="team-subtitle">Manage members and workspace access.</p>
        </div>
        {isOwner || currentUser.role === 'manager' ? (
          <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>
            <Plus size={16} /> Invite member
          </button>
        ) : null}
      </div>

      <div className="team-stats-row">
        <span><Users size={15} /> {activeMembers.filter((m) => m.status === 'active').length} active</span>
        <span className="team-stats-divider" />
        <span><Mail size={15} /> {pendingInvites.length} pending invite{pendingInvites.length === 1 ? '' : 's'}</span>
        <span className="team-stats-divider" />
        <span><UserCheck size={15} /> {workersAvailable} worker{workersAvailable === 1 ? '' : 's'} available</span>
      </div>

      <div className={`team-body ${selected ? 'team-body-split' : ''}`}>
        <div className="team-list-col">
          <div className="team-tabs">
            <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members ({activeMembers.length})</button>
            <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending invitations ({pendingInvites.length})</button>
          </div>

          <div className="team-toolbar">
            <div className="team-search">
              <Search size={15} />
              <input placeholder="Search team members..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {Object.keys(ROLE_PERMISSIONS).map((r) => <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>)}
            </select>
            {tab === 'members' && (
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Suspended</option>
              </select>
            )}
          </div>

          {tab === 'members' ? (
            <div className="team-table-wrap">
              <table className="team-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Current workload</th>
                    <th>Status</th>
                    <th>Last active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => {
                    const isSelf = m.id === currentUser.id;
                    const isOwnerRow = m.role === 'owner';
                    return (
                      <tr key={m.id} className={m.id === selectedId ? 'team-row-active' : ''} onClick={() => setSelectedId(m.id)}>
                        <td>
                          <div className="team-member-cell">
                            <Avatar src={m.avatar_url} name={m.name || m.email} size="md" className="team-avatar" />
                            <div>
                              <strong>{m.name || 'Pending'}{isSelf && <span className="team-you-badge">You</span>}</strong>
                              <span>{m.email}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className={`role-badge role-${m.role}`}>{ROLE_PERMISSIONS[m.role].label}</span></td>
                        <td>{formatWorkload(m)}</td>
                        <td><span className={`status-badge team-status-badge-${m.status}`}>{m.status === 'active' ? 'Active' : 'Suspended'}</span></td>
                        <td>{timeAgo(m.last_active_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {isOwnerRow ? (
                            isSelf ? <button className="team-link-btn" onClick={() => setTransferOpen(true)}><Lock size={12} /> Ownership settings</button> : <Lock size={14} className="team-owner-lock" />
                          ) : (
                            <button className="team-link-btn" onClick={() => setSelectedId(m.id)}>Manage</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMembers.length === 0 && (
                    <tr><td colSpan={6} className="empty-cell">No team members match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="team-table-wrap">
              <table className="team-table">
                <thead>
                  <tr><th>Email</th><th>Role</th><th>Invited</th><th>Expires</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredPending.map((m) => (
                    <tr key={m.id}>
                      <td><div className="team-member-cell"><Mail size={15} className="team-pending-icon" /><span>{m.email}</span></div></td>
                      <td><span className={`role-badge role-${m.role}`}>{ROLE_PERMISSIONS[m.role].label}</span></td>
                      <td>{new Date(m.joined_at).toLocaleDateString()}</td>
                      <td>{m.invite_expires_at ? new Date(m.invite_expires_at).toLocaleDateString() : '—'}</td>
                      <td className="team-pending-actions">
                        <button className="btn btn-sm btn-secondary" disabled={pendingBusyId === m.id} onClick={() => handleResend(m.id)}>
                          <Send size={12} /> Resend
                        </button>
                        <button className="btn btn-sm btn-secondary" disabled={pendingBusyId === m.id} onClick={() => setCancelTarget(m)}>
                          <X size={12} /> Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredPending.length === 0 && (
                    <tr><td colSpan={5} className="empty-cell">No pending invitations.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected && (
          <MemberDrawer
            member={selected}
            claims={claims}
            currentUser={currentUser}
            onClose={() => setSelectedId(null)}
            onChanged={load}
            onOpenTransfer={() => setTransferOpen(true)}
          />
        )}
      </div>

      {inviteOpen && (
        <InviteMemberModal
          organizationName={currentUser.organizationName}
          onClose={() => setInviteOpen(false)}
          onInvited={() => { setInviteOpen(false); load(); }}
        />
      )}

      {transferOpen && owner && (
        <TransferOwnershipModal
          organizationName={currentUser.organizationName}
          candidates={transferCandidates}
          onClose={() => setTransferOpen(false)}
          onTransferred={() => { setTransferOpen(false); setSelectedId(null); load(); }}
        />
      )}

      {cancelTarget && (
        <ConfirmModal
          title="Cancel this invitation?"
          body={`The invite sent to ${cancelTarget.email} will no longer work.`}
          confirmLabel="Cancel invitation"
          danger
          busy={pendingBusyId === cancelTarget.id}
          onConfirm={handleCancelInvite}
          onCancel={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
