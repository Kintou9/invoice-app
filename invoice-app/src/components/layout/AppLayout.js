import { useState } from 'react';
import { Sun, Moon, Menu } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import './AppLayout.css';

export default function AppLayout({ children }) {
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="app-main">
        <div className="app-top-strip">
          <button className="btn-icon mobile-nav-toggle" onClick={() => setMobileNavOpen(true)} title="Open menu">
            <Menu size={20} />
          </button>
          <div className="app-top-strip-spacer" />
          <NotificationBell />
          <button className="btn-icon theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
