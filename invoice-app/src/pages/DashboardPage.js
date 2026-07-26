import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { ClipboardList, FileText, CheckCircle, Clock } from 'lucide-react';
import './DashboardPage.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/claims'), api.get('/invoices')])
      .then(([c, i]) => {
        setClaims(c.data);
        setInvoices(i.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  const pendingApproval = invoices.filter((i) => i.status === 'submitted').length;
  const openClaims = claims.filter((c) => c.status === 'open' || c.status === 'in_progress').length;
  const approved = invoices.filter((i) => i.status === 'approved').length;
  const myDrafts = invoices.filter((i) => i.status === 'draft').length;

  return (
    <div className="dashboard">
      <h1>Welcome, {user.name}</h1>
      <p className="dashboard-subtitle">Here's your overview</p>

      <div className="stat-grid">
        <StatCard icon={ClipboardList} label="Open Claims" value={openClaims} color="blue" to="/claims" />
        <StatCard icon={Clock} label="Pending Approval" value={pendingApproval} color="orange" to="/invoices?status=submitted" />
        <StatCard icon={CheckCircle} label="Approved" value={approved} color="green" to="/invoices?status=approved" />
        <StatCard icon={FileText} label="Draft Invoices" value={myDrafts} color="gray" to="/invoices?status=draft" />
      </div>

      <div className="dashboard-sections">
        <section>
          <div className="section-header">
            <h2>Recent Claims</h2>
            <Link to="/claims" className="see-all">See all</Link>
          </div>
          <div className="claim-list">
            {claims.slice(0, 5).map((c) => (
              <Link key={c.id} to={`/claims/${c.id}`} className="claim-row">
                <span className="claim-number">{c.claim_number}</span>
                <span className="claim-title">{c.title}</span>
                <span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span>
                <span className="claim-assignee">{c.assigned_to_name || 'Unassigned'}</span>
              </Link>
            ))}
            {claims.length === 0 && <p className="empty-msg">No claims yet.</p>}
          </div>
        </section>

        {(user.role === 'manager' || user.role === 'admin') && pendingApproval > 0 && (
          <section>
            <div className="section-header">
              <h2>Awaiting Your Review</h2>
              <Link to="/invoices?status=submitted" className="see-all">See all</Link>
            </div>
            <div className="claim-list">
              {invoices
                .filter((i) => i.status === 'submitted')
                .slice(0, 5)
                .map((inv) => (
                  <Link key={inv.id} to={`/invoices/${inv.id}`} className="claim-row">
                    <span className="claim-number">{inv.claim_number}</span>
                    <span className="claim-title">{inv.claim_title}</span>
                    <span className="claim-assignee">{inv.technician_name}</span>
                    <span className="status-badge status-submitted">Needs Review</span>
                  </Link>
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, to }) {
  return (
    <Link to={to} className={`stat-card stat-${color}`}>
      <Icon size={28} />
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </Link>
  );
}
