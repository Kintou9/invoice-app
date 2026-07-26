import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { FileText } from 'lucide-react';
import './ClaimsPage.css';

export default function ManagerFolderPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/upload/manager-folder').then((r) => setInvoices(r.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="claims-page">
      <div className="page-header">
        <h1>Manager Folder</h1>
        <p style={{ color: '#718096', fontSize: '0.9rem', margin: 0 }}>All approved invoices</p>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="claims-table-wrap">
          <table className="claims-table">
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Claim Title</th>
                <th>Technician</th>
                <th>Approved</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><span className="claim-num-link">{inv.claim_number}</span></td>
                  <td>{inv.claim_title}</td>
                  <td>{inv.technician_name}</td>
                  <td>{inv.reviewed_at ? new Date(inv.reviewed_at).toLocaleDateString() : '—'}</td>
                  <td style={{ maxWidth: 200, fontSize: '0.8rem', color: '#718096' }}>{inv.manager_notes || '—'}</td>
                  <td>
                    <Link to={`/invoices/${inv.id}`} className="btn btn-sm btn-secondary">
                      <FileText size={13} /> View
                    </Link>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="empty-cell">No approved invoices yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
