import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import Avatar from '../shared/Avatar';
import {
  LayoutDashboard, ClipboardList, FileText, Users, Folder, Store, Palette, Files,
  Building2, ChevronDown, ChevronsLeft, ChevronsRight, Check, LogOut, UserCircle,
} from 'lucide-react';
import './Sidebar.css';

const navItems = {
  owner: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'Jobs' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
    { to: '/team', icon: Users, label: 'Team' },
    { to: '/manager-folder', icon: Folder, label: 'Manager Folder' },
    { to: '/suppliers', icon: Store, label: 'Suppliers' },
    { to: '/settings/document-templates', icon: Palette, label: 'Document Templates' },
  ],
  manager: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'Jobs' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
    { to: '/team', icon: Users, label: 'Team' },
    { to: '/manager-folder', icon: Folder, label: 'Manager Folder' },
    { to: '/settings/document-templates', icon: Palette, label: 'Document Templates' },
  ],
  worker: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'My dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'My jobs' },
    { to: '/invoices', icon: FileText, label: 'My invoices' },
    { to: '/documents', icon: Files, label: 'My documents' },
  ],
  viewer: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'Jobs' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
  ],
};

export default function Sidebar({ mobileOpen, onCloseMobile }) {
  const { user, logout, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const items = navItems[user?.role] || [];

  const [organizations, setOrganizations] = useState([]);
  const [orgOpen, setOrgOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const orgRef = useRef(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
    } catch {
      // Private browsing / storage blocked — collapse state just won't persist across reloads.
    }
  }, [collapsed]);

  // Fetched once — org membership changing mid-session is rare enough that
  // requiring a fresh load to see a new one is fine (same posture as the
  // Navbar this replaces).
  useEffect(() => {
    api.get('/auth/organizations').then((r) => setOrganizations(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (orgRef.current && !orgRef.current.contains(e.target)) setOrgOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSwitchOrg = async (organizationId) => {
    setOrgOpen(false);
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand-row">
        <Link to="/dashboard" className="sidebar-brand" title="Trackly">
          <FileText size={22} />
          <span>Trackly</span>
        </Link>
        <button
          className="sidebar-collapse-btn"
          onClick={() => { setCollapsed((c) => !c); setOrgOpen(false); }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      {organizations.length > 1 ? (
        <div className="sidebar-org" ref={orgRef}>
          <button
            className="sidebar-org-btn"
            onClick={() => { if (collapsed) { setCollapsed(false); } else { setOrgOpen((o) => !o); } }}
            disabled={switching}
            title={user?.organizationName || 'Switch organization'}
          >
            <Building2 size={15} />
            <span className="sidebar-org-name">{user?.organizationName}</span>
            <ChevronDown size={14} className="sidebar-org-chevron" />
          </button>
          {orgOpen && !collapsed && (
            <div className="sidebar-dropdown sidebar-org-dropdown">
              {organizations.map((org) => (
                <button key={org.organizationId} className="sidebar-dropdown-item" onClick={() => handleSwitchOrg(org.organizationId)}>
                  <span>
                    {org.organizationName}
                    <span className="sidebar-org-role">{org.role}</span>
                  </span>
                  {org.organizationId === user.organizationId && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="sidebar-org sidebar-org-static" title={user?.organizationName}>
          <Building2 size={15} />
          <span className="sidebar-org-name">{user?.organizationName}</span>
        </div>
      )}

      <nav className="sidebar-nav">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/dashboard'} onClick={onCloseMobile} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`} title={label}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-user" ref={userMenuRef}>
        {userMenuOpen && !collapsed && (
          <div className="sidebar-dropdown sidebar-user-dropdown">
            <button className="sidebar-dropdown-item" onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}>
              <UserCircle size={15} /> My Profile
            </button>
            {organizations.length > 1 && (
              <button
                className="sidebar-dropdown-item"
                onClick={() => { setUserMenuOpen(false); setOrgOpen(true); }}
              >
                <Building2 size={15} /> Switch Workspace
              </button>
            )}
            <button className="sidebar-dropdown-item" onClick={handleLogout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
        <button
          className="sidebar-user-btn"
          onClick={() => { if (collapsed) { setCollapsed(false); } else { setUserMenuOpen((o) => !o); } }}
          title={user?.name}
          aria-expanded={userMenuOpen}
          aria-haspopup="menu"
        >
          <Avatar src={user?.avatarUrl} name={user?.name} size="sm" variant="solid" className="sidebar-avatar" />
          <span className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.name}</span>
            <span className="sidebar-user-role">{user?.role}</span>
          </span>
          <ChevronDown size={14} className="sidebar-user-chevron" />
        </button>
      </div>
      </aside>
    </>
  );
}
