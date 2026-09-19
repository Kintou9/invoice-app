import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { X, ArrowLeft, ExternalLink, ShieldAlert, PauseCircle, PlayCircle, UserMinus } from 'lucide-react';
import api from '../../services/api';
import Avatar from '../shared/Avatar';
import { eventLabel, eventDetails } from '../../utils/activityLabels';
import { formatWorkload } from '../../utils/teamWorkload';
import { ROLE_PERMISSIONS, ASSIGNABLE_ROLES } from '../../utils/rolePermissions';
import ConfirmModal from './ConfirmModal';

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function MemberDrawer({ member, claims, currentUser, onClose, onChanged, onOpenTransfer }) {
  const [tab, setTab] = useState('overview');
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const [roleValue, setRoleValue] = useState(member.role);
  const [savingRole, setSavingRole] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    setTab('overview');
    setEditingRole(false);
    setRoleValue(member.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  useEffect(() => {
    if (tab !== 'activity') return;
    setActivityLoading(true);
    api.get(`/audit-log?entity_type=organization_member&entity_id=${member.membership_id}&limit=25`)
      .then((r) => setActivity(r.data))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false));
  }, [tab, member.membership_id]);

  const isSelf = member.id === currentUser.id;
  const isOwnerRow = member.role === 'owner';
  const memberJobs = member.role === 'worker' ? claims.filter((c) => c.assigned_to === member.membership_id) : [];
  const permissions = ROLE_PERMISSIONS[member.role];

  const handleSaveRole = async () => {
    if (roleValue === member.role) { setEditingRole(false); return; }
    setSavingRole(true);
    try {
      await api.patch(`/users/${member.id}`, { role: roleValue });
      toast.success('Role updated');
      setEditingRole(false);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update role');
      setRoleValue(member.role);
    } finally {
      setSavingRole(false);
    }
  };

  const runAction = async (action) => {
    setActionBusy(true);
    try {
      if (action === 'suspend') await api.post(`/users/${member.id}/suspend`);
      if (action === 'reactivate') await api.post(`/users/${member.id}/reactivate`);
      if (action === 'remove') await api.delete(`/users/${member.id}`);
      toast.success(
        action === 'suspend' ? 'Member suspended' : action === 'reactivate' ? 'Member reactivated' : 'Member removed'
      );
      setConfirmAction(null);
      onChanged();
      if (action === 'remove') onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="team-drawer">
      <div className="team-drawer-header">
        <button className="team-drawer-back" onClick={onClose}><ArrowLeft size={16} /> Back</button>
        <div className="team-drawer-identity">
          <Avatar src={member.avatar_url} name={member.name || member.email} size="lg" className="team-avatar" />
          <div>
            <strong>{member.name || 'Pending'}</strong>
            <span className={`team-status-dot team-status-${member.status}`} />
            <span className="team-drawer-status-label">{member.status === 'active' ? 'Active' : member.status === 'disabled' ? 'Suspended' : member.status === 'invited' ? 'Invited' : 'Removed'}</span>
          </div>
            <span className="team-drawer-email">{member.email}</span>
        </div>
        {!isOwnerRow && !isSelf && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditingRole((v) => !v)}>Edit access</button>
        )}
        {isOwnerRow && isSelf && (
          <button className="btn btn-secondary btn-sm" onClick={onOpenTransfer}><ShieldAlert size={13} /> Ownership settings</button>
        )}
        <button className="team-drawer-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="team-drawer-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        {member.role === 'worker' && (
          <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>Assigned jobs ({memberJobs.length})</button>
        )}
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>

      {tab === 'overview' && (
        <div className="team-drawer-body">
          <section className="team-drawer-card">
            <h4><permissions.icon size={14} /> Access</h4>
            {editingRole ? (
              <div className="team-inline-edit">
                <select value={roleValue} onChange={(e) => setRoleValue(e.target.value)} disabled={savingRole}>
                  {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_PERMISSIONS[r].label}</option>)}
                </select>
                <button className="btn btn-sm btn-secondary" onClick={() => { setEditingRole(false); setRoleValue(member.role); }} disabled={savingRole}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={handleSaveRole} disabled={savingRole}>{savingRole ? 'Saving...' : 'Save'}</button>
              </div>
            ) : (
              <div className="team-role-row">Role <span className={`role-badge role-${member.role}`}>{permissions.label}</span></div>
            )}
            <ul className="team-permission-list">
              {permissions.can.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {permissions.cannot.map((line) => <p key={line} className="team-permission-cannot">{line}</p>)}
          </section>

          <section className="team-drawer-card">
            <h4>Details</h4>
            <div className="team-detail-row"><span>Workspace status</span><strong>{member.status === 'active' ? 'Active' : member.status === 'disabled' ? 'Suspended' : 'Invited'}</strong></div>
            <div className="team-detail-row"><span>Joined</span><strong>{member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}</strong></div>
            <div className="team-detail-row"><span>Last active</span><strong>{member.last_active_at ? timeAgo(member.last_active_at) : 'Never signed in'}</strong></div>
          </section>

          {member.role !== 'owner' && (
            <section className="team-drawer-card">
              <h4>Current workload</h4>
              <p className="team-workload-line">{formatWorkload(member)}</p>
              {member.role === 'worker' && memberJobs.length > 0 && (
                <button className="team-link-btn" onClick={() => setTab('jobs')}>View assigned jobs →</button>
              )}
            </section>
          )}

          {!isSelf && !isOwnerRow && (
            <section className="team-drawer-card team-drawer-danger-card">
              <h4>Administrative actions</h4>
              <button className="team-danger-action" onClick={() => setConfirmAction('suspend')} disabled={member.status !== 'active'}>
                <PauseCircle size={15} />
                <span><strong>Suspend access</strong><small>Temporarily remove access to this workspace.</small></span>
              </button>
              {member.status === 'disabled' && (
                <button className="team-danger-action" onClick={() => runAction('reactivate')} disabled={actionBusy}>
                  <PlayCircle size={15} />
                  <span><strong>Reactivate</strong><small>Restore this member's access.</small></span>
                </button>
              )}
              <button className="team-danger-action" onClick={() => setConfirmAction('remove')}>
                <UserMinus size={15} />
                <span><strong>Remove from workspace</strong><small>Permanently remove this member from this workspace.</small></span>
              </button>
            </section>
          )}
        </div>
      )}

      {tab === 'jobs' && (
        <div className="team-drawer-body">
          {memberJobs.length === 0 ? <p className="empty-msg">No jobs assigned.</p> : (
            <div className="team-job-list">
              {memberJobs.map((c) => (
                <Link key={c.id} to={`/claims/${c.id}`} className="team-job-row">
                  <div>
                    <strong>{c.customer_name || c.title}</strong>
                    <span>{c.claim_number}</span>
                  </div>
                  <span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span>
                  <ExternalLink size={13} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="team-drawer-body">
          {activityLoading ? <p className="team-drawer-loading">Loading...</p> : activity.length === 0 ? (
            <p className="empty-msg">No activity recorded yet.</p>
          ) : (
            <div className="team-activity-list">
              {activity.map((entry) => (
                <div key={entry.id} className="team-activity-row">
                  <div>
                    <strong>{eventLabel(entry)}</strong>
                    {eventDetails(entry) && <span>{eventDetails(entry)}</span>}
                  </div>
                  <span className="team-activity-time">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmAction === 'suspend' && (
        <ConfirmModal
          title="Suspend access?"
          body={`${member.name || member.email} will immediately lose access to this workspace. You can reactivate them at any time.`}
          confirmLabel="Suspend access"
          danger
          busy={actionBusy}
          onConfirm={() => runAction('suspend')}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'remove' && (
        <ConfirmModal
          title="Remove from workspace?"
          body={`${member.name || member.email} will be permanently removed from this workspace. Their past jobs and invoices stay on record.`}
          confirmLabel="Remove member"
          danger
          busy={actionBusy}
          onConfirm={() => runAction('remove')}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
