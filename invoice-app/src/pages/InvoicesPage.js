import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import './ClaimsPage.css';

export default function InvoicesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const statusFilter = searchParams.get('status');
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/invoices').then((r) => setInvoices(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter ? invoices.filter((i) => i.status === statusFilter) : invoices;

  return (
    <div className="claims-page">
      <div className="page-header">
        <h1>{user.role === 'technician' ? 'My Invoices' : 'All Invoices'}</h1>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="claims-table-wrap">
          <table className="claims-table">
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Claim Title</th>
                <th>Technician</th>
                <th>Model</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td><span className="claim-num-link">{inv.claim_number}</span></td>
                  <td>{inv.claim_title}</td>
                  <td>{inv.technician_name}</td>
                  <td>{inv.model_number || <span className="unassigned">—</span>}</td>
                  <td><span className={`status-badge status-${inv.status}`}>{inv.status}</span></td>
                  <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/invoices/${inv.id}`} className="btn btn-sm btn-secondary">Open</Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No invoices found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
