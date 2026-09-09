import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, FileText, Bell } from 'lucide-react';
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const fetchNotifications = () => {
    api.get('/notifications').then((r) => setNotifications(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Close the dropdown on an outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
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

  return (
    <header className="navbar">
      <Link to="/dashboard" className="navbar-brand">
        <FileText size={22} />
        <span>Invoice Manager</span>
      </Link>
      <div className="navbar-right">
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
