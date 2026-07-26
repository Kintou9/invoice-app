import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import PartsSection from '../components/parts/PartsSection';
import { Camera, Sparkles, Send, CheckCircle, XCircle, Upload } from 'lucide-react';
import './InvoiceDetailPage.css';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const photoInputRef = useRef(null);

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [managerNotes, setManagerNotes] = useState('');
  const [techNotes, setTechNotes] = useState('');
  const [form, setForm] = useState({ model_number: '', serial_number: '', issue_description: '' });

  const isTech = user.role === 'technician';
  const isManager = user.role === 'manager' || user.role === 'admin';
  const isEditable = invoice?.status === 'draft' || invoice?.status === 'rejected';

  const load = () =>
    api.get(`/invoices/${id}`).then((r) => {
      setInvoice(r.data);
      setForm({
        model_number: r.data.model_number || '',
        serial_number: r.data.serial_number || '',
        issue_description: r.data.issue_description || r.data.ai_generated_description || '',
      });
    }).finally(() => setLoading(false));

  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/invoices/${id}`, form);
      toast.success('Saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const data = new FormData();
      data.append('photo', file);
      const res = await api.post(`/upload/photo/${id}`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`Photo uploaded — AI extracted: model ${res.data.extracted.model_number || 'N/A'}, serial ${res.data.extracted.serial_number || 'N/A'}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  };

  const handleAiDescribe = async () => {
    if (!techNotes.trim()) { toast.error('Enter your notes first'); return; }
    setAiLoading(true);
    try {
      const res = await api.post(`/invoices/${id}/ai/describe`, { techNotes });
      setForm((f) => ({ ...f, issue_description: res.data.description }));
      toast.success('AI description generated');
    } catch {
      toast.error('AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      await api.patch(`/invoices/${id}`, form);
      await api.post(`/invoices/${id}/submit`);
      toast.success('Invoice submitted for review');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Submit failed');
    }
  };

  const handleApprove = async () => {
    try {
      await api.post(`/invoices/${id}/approve`, { manager_notes: managerNotes });
      toast.success('Invoice approved');
      load();
    } catch { toast.error('Approval failed'); }
  };

  const handleReject = async () => {
    if (!managerNotes.trim()) { toast.error('Please add notes explaining the rejection'); return; }
    try {
      await api.post(`/invoices/${id}/reject`, { manager_notes: managerNotes });
      toast.success('Invoice returned to technician');
      load();
    } catch { toast.error('Rejection failed'); }
  };

  if (loading) return <p>Loading...</p>;
  if (!invoice) return <p>Invoice not found.</p>;

  return (
    <div className="invoice-detail">
      <div className="invoice-header">
        <div>
          <h1>Invoice — {invoice.claim_number}</h1>
          <p className="invoice-subtitle">{invoice.claim_title} · {invoice.technician_name}</p>
        </div>
        <span className={`status-badge status-${invoice.status}`}>{invoice.status.replace('_', ' ')}</span>
      </div>

      {invoice.manager_notes && (
        <div className={`manager-notes-banner ${invoice.status === 'rejected' ? 'rejected' : ''}`}>
          <strong>Manager notes:</strong> {invoice.manager_notes}
        </div>
      )}

      <div className="invoice-body">
        {/* Equipment Info */}
        <section className="card">
          <h2>Equipment Info</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Model Number</label>
              <input value={form.model_number} onChange={(e) => setForm({ ...form, model_number: e.target.value })} disabled={!isEditable} />
            </div>
            <div className="form-group">
              <label>Serial Number</label>
              <input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} disabled={!isEditable} />
            </div>
          </div>

          {isEditable && (
            <div className="photo-upload-area">
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" onChange={handlePhotoUpload} style={{ display: 'none' }} />
              <button className="btn btn-secondary" onClick={() => photoInputRef.current.click()} disabled={photoLoading}>
                <Camera size={16} />
                {photoLoading ? 'Uploading & Extracting...' : 'Upload Equipment Photo (AI Extracts Model/SN)'}
              </button>
            </div>
          )}

          {invoice.photos?.length > 0 && (
            <div className="photo-grid">
              {invoice.photos.map((p) => (
                <div key={p.id} className="photo-thumb">
                  <img src={p.sas_url || p.blob_url} alt="Equipment" />
                  <div className="photo-info">
                    {p.extracted_model && <span>Model: {p.extracted_model}</span>}
                    {p.extracted_serial && <span>SN: {p.extracted_serial}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Issue Description */}
        <section className="card">
          <h2>Issue Description</h2>
          {isEditable && (
            <div className="form-group">
              <label>Your Notes (for AI)</label>
              <textarea
                rows={3}
                placeholder="Describe what you observed, symptoms, what you checked..."
                value={techNotes}
                onChange={(e) => setTechNotes(e.target.value)}
              />
              <button className="btn btn-ai" onClick={handleAiDescribe} disabled={aiLoading}>
                <Sparkles size={16} />
                {aiLoading ? 'Generating...' : 'Generate Professional Description with AI'}
              </button>
            </div>
          )}
          <div className="form-group">
            <label>Final Description</label>
            <textarea
              rows={6}
              value={form.issue_description}
              onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
              disabled={!isEditable}
              placeholder="Issue description will appear here..."
            />
          </div>
          {isEditable && (
            <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
              <Upload size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </section>

        {/* Parts */}
        <section className="card">
          <h2>Parts</h2>
          <PartsSection invoiceId={id} parts={invoice.parts || []} isEditable={isEditable} onUpdate={load} />
        </section>

        {/* Actions */}
        {isTech && isEditable && (
          <div className="action-bar">
            <button className="btn btn-primary" onClick={handleSubmit}>
              <Send size={16} /> Submit for Manager Review
            </button>
          </div>
        )}

        {isManager && invoice.status === 'submitted' && (
          <section className="card review-section">
            <h2>Manager Review</h2>
            <div className="form-group">
              <label>Notes (required for rejection)</label>
              <textarea rows={3} value={managerNotes} onChange={(e) => setManagerNotes(e.target.value)} placeholder="Add notes for the technician..." />
            </div>
            <div className="review-actions">
              <button className="btn btn-danger" onClick={handleReject}>
                <XCircle size={16} /> Reject
              </button>
              <button className="btn btn-success" onClick={handleApprove}>
                <CheckCircle size={16} /> Approve
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
