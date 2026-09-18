import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import './AppLayout.css';

export default function AppLayout({ children }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="app-top-strip">
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
