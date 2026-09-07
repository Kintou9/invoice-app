import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Navbar from './Navbar';
import { LayoutDashboard, ClipboardList, FileText, Users, Folder, Store } from 'lucide-react';
import './AppLayout.css';

const navItems = {
  owner: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'Claims' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
    { to: '/users', icon: Users, label: 'Users' },
    { to: '/manager-folder', icon: Folder, label: 'Manager Folder' },
    { to: '/suppliers', icon: Store, label: 'Suppliers' },
  ],
  manager: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'Claims' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
    { to: '/manager-folder', icon: Folder, label: 'Manager Folder' },
  ],
  worker: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/claims', icon: ClipboardList, label: 'My Claims' },
    { to: '/invoices', icon: FileText, label: 'My Invoices' },
  ],
};

export default function AppLayout({ children }) {
  const { user } = useAuth();
  const items = navItems[user?.role] || [];

  return (
    <div className="app-shell">
      <Navbar />
      <div className="app-body">
        <aside className="sidebar">
          <nav>
            {items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
