import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Plus, FileText } from 'lucide-react';
import './InvoiceDetailPage.css';

export default function ClaimDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [claim, setClaim] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/claims/${id}`),
      api.get(`/invoices?claim_id=${id}`),
      api.get('/upload/templates'),
    ]).then(([c, inv, t]) => {
      setClaim(c.data);
      setInvoices(inv.data);
      setTemplates(t.data);
      if (t.data[0]) setSelectedTemplate(t.data[0].id);
    }).finally(() => setLoading(false));
  }, [id]);

  const handleCreateInvoice = async () => {
    setCreating(true);
    try {
      const res = await api.post('/invoices', { claim_id: id, template_id: selectedTemplate || undefined });
      setInvoices([res.data, ...invoices]);
      toast.success('Invoice created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!claim) return <p>Claim not found.</p>;

  const canCreateInvoice = invoices.filter((i) => i.status === 'draft').length === 0;

  return (
    <div className="invoice-detail">
      <div className="invoice-header">
        <div>
          <h1>{claim.claim_number}</h1>
          <p className="invoice-subtitle">{claim.title}</p>
        </div>
        <span className={`status-badge status-${claim.status}`}>{claim.status.replace('_', ' ')}</span>
      </div>

      {claim.description && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>Description</h2>
          <p style={{ margin: 0, color: '#4a5568', fontSize: '0.9rem' }}>{claim.description}</p>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          {canCreateInvoice && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {templates.length > 0 && (
                <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.35rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button className="btn btn-primary" onClick={handleCreateInvoice} disabled={creating}>
                <Plus size={15} /> {creating ? 'Creating...' : 'Start Invoice'}
              </button>
            </div>
          )}
        </div>

        {invoices.length === 0 ? (
          <p className="empty-parts">No invoices yet for this claim.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {invoices.map((inv) => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', background: '#f7fafc', borderRadius: '8px', border: '1px solid #e2e8f0', textDecoration: 'none', color: 'inherit' }}>
                <FileText size={18} style={{ color: '#3182ce' }} />
                <span style={{ flex: 1, fontSize: '0.9rem', color: '#2d3748' }}>
                  Invoice {new Date(inv.created_at).toLocaleDateString()}
                  {inv.model_number && ` · ${inv.model_number}`}
                </span>
                <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
