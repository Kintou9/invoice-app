import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, FileText, Bell, Building2, ChevronDown, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import './Navbar.css';

const POLL_INTERVAL_MS = 30000;

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Navbar() {
  const { user, logout, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const [organizations, setOrganizations] = useState([]);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const orgPanelRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const fetchNotifications = () => {
    api.get('/notifications').then((r) => setNotifications(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Fetched once on mount, not polled — org membership changing mid-session
  // is rare enough that requiring a fresh load to see a new one is fine.
  useEffect(() => {
    api.get('/auth/organizations').then((r) => setOrganizations(r.data)).catch(() => {});
  }, []);

  // Close either dropdown on an outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
      if (orgPanelRef.current && !orgPanelRef.current.contains(e.target)) setOrgSwitcherOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleNotificationClick = (n) => {
    setOpen(false);
    if (!n.read_at) {
      api.patch(`/notifications/${n.id}`).catch(() => {});
      setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    if (n.link) navigate(n.link);
  };

  const handleMarkAllRead = () => {
    api.post('/notifications/read-all').catch(() => {});
    setNotifications((ns) => ns.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSwitchOrg = async (organizationId) => {
    setOrgSwitcherOpen(false);
    if (organizationId === user.organizationId) return;
    setSwitching(true);
    try {
      await switchOrganization(organizationId);
      // Hard reload rather than client-side navigate: every page's data is
      // org-scoped, and there's no global refetch-everything mechanism to
      // invalidate it cleanly after the token changes underneath it.
      window.location.href = '/dashboard';
    } catch {
      setSwitching(false);
    }
  };

  return (
    <header className="navbar">
      <Link to="/dashboard" className="navbar-brand">
        <FileText size={22} />
        <span>Invoice Manager</span>
      </Link>
      <div className="navbar-right">
        {organizations.length > 1 && (
          <div className="notification-wrap" ref={orgPanelRef}>
            <button
              className="org-switcher-btn"
              onClick={() => setOrgSwitcherOpen((o) => !o)}
              disabled={switching}
              title="Switch organization"
            >
              <Building2 size={15} />
              <span className="org-switcher-name">{user?.organizationName}</span>
              <ChevronDown size={14} />
            </button>
            {orgSwitcherOpen && (
              <div className="notification-panel org-switcher-panel">
                <div className="notification-panel-header">
                  <span>Switch Organization</span>
                </div>
                <div className="notification-list">
                  {organizations.map((org) => (
                    <button
                      key={org.organizationId}
                      className="notification-item org-switcher-item"
                      onClick={() => handleSwitchOrg(org.organizationId)}
                    >
                      <span className="notification-message">
                        {org.organizationName}
                        <span className="org-switcher-role">{org.role}</span>
                      </span>
                      {org.organizationId === user.organizationId && <Check size={15} className="org-switcher-check" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="notification-wrap" ref={panelRef}>
          <button className="btn-icon notification-bell" onClick={() => setOpen((o) => !o)} title="Notifications">
            <Bell size={18} />
            {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          {open && (
            <div className="notification-panel">
              <div className="notification-panel-header">
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <button className="notification-mark-all" onClick={handleMarkAllRead}>Mark all read</button>
                )}
              </div>
              <div className="notification-list">
                {notifications.length === 0 && (
                  <p className="notification-empty">No notifications yet.</p>
                )}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    className={`notification-item ${n.read_at ? '' : 'notification-unread'}`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <span className="notification-message">{n.message}</span>
                    <span className="notification-time">{timeAgo(n.created_at)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="navbar-user">
          {user?.name}
          <span className="role-badge">{user?.role}</span>
        </span>
        <button onClick={handleLogout} className="btn-icon" title="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
