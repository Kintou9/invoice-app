import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LogOut, FileText } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
