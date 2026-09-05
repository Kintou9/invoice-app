import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import PartsSection from '../components/parts/PartsSection';
import { Camera, Sparkles, Send, CheckCircle, XCircle, Upload, User, MapPin, Wrench } from 'lucide-react';
import './InvoiceDetailPage.css';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const photoInputRef = useRef(null);

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPartsLoading, setAiPartsLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [managerNotes, setManagerNotes] = useState('');
  const [techNotes, setTechNotes] = useState('');
  const [form, setForm] = useState({ model_number: '', serial_number: '', issue_description: '' });
  const [suggestedParts, setSuggestedParts] = useState([]);

  const isTech = user.role === 'technician';
  const isManager = user.role === 'manager' || user.role === 'admin';
  const isEditable = invoice?.status === 'draft' || invoice?.status === 'rejected';

  const load = () =>
    api.get(`/invoices/${id}`).then((r) => {
      setInvoice(r.data);
      setForm({
        model_number: r.data.model_number || r.data.type_brand || '',
        serial_number: r.data.serial_number || '',
        issue_description: r.data.issue_description || r.data.ai_generated_description || '',
      });
    }).finally(() => setLoading(false));

  // `load` is a new function every render; adding it as a dep would re-fetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const res = await api.post(`/upload/photo/${id}`, data);
      const { extracted } = res.data;

      let updatedForm = form;
      if (extracted.model_number || extracted.serial_number) {
        updatedForm = {
          ...form,
          model_number: extracted.model_number || form.model_number,
          serial_number: extracted.serial_number || form.serial_number,
        };
        setForm(updatedForm);
        await api.patch(`/invoices/${id}`, updatedForm);
      }

      toast.success(`Photo uploaded — model: ${extracted.model_number || 'N/A'}, SN: ${extracted.serial_number || 'N/A'}`);
      load();

      // Auto-suggest parts if there's a description to work from
      const description = updatedForm.issue_description;
      if (description?.trim()) {
        setAiPartsLoading(true);
        try {
          const partsRes = await api.post(`/invoices/${id}/ai/parts`);
          setSuggestedParts(partsRes.data.parts || []);
          if (partsRes.data.parts?.length) {
            toast.success(`AI suggested ${partsRes.data.parts.length} parts`);
          }
        } catch {
          // silently skip — user can still click AI Suggest Parts manually
        } finally {
          setAiPartsLoading(false);
        }
      }
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
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiParts = async () => {
    const description = form.issue_description || techNotes;
    if (!description.trim()) { toast.error('Add an issue description first'); return; }
    setAiPartsLoading(true);
    try {
      await api.patch(`/invoices/${id}`, form);
      const res = await api.post(`/invoices/${id}/ai/parts`);
      setSuggestedParts(res.data.parts || []);
      if (res.data.parts?.length) {
        toast.success(`AI suggested ${res.data.parts.length} parts`);
      } else {
        toast.info('No parts suggested — try adding more detail to the issue description');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Parts suggestion failed');
    } finally {
      setAiPartsLoading(false);
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

        {/* Customer & Job Info from claim */}
        {(invoice.customer_name || invoice.job_address || invoice.type_brand) && (
          <section className="card claim-info-card">
            <h2>Service Call Info</h2>
            <div className="claim-info-grid">
              {invoice.customer_name && (
                <div className="claim-info-item">
                  <User size={15} />
                  <div>
                    <span className="claim-info-label">Customer</span>
                    <span className="claim-info-value">{invoice.customer_name}</span>
                    {invoice.customer_phone && <span className="claim-info-sub">{invoice.customer_phone}</span>}
                  </div>
                </div>
              )}
              {invoice.job_address && (
                <div className="claim-info-item">
                  <MapPin size={15} />
                  <div>
                    <span className="claim-info-label">Job Address</span>
                    <span className="claim-info-value">{invoice.job_address}</span>
                  </div>
                </div>
              )}
              {invoice.type_brand && (
                <div className="claim-info-item">
                  <Wrench size={15} />
                  <div>
                    <span className="claim-info-label">Appliance</span>
                    <span className="claim-info-value">{invoice.type_brand}</span>
                    {invoice.date_of_service && (
                      <span className="claim-info-sub">Service date: {new Date(invoice.date_of_service).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Equipment Info */}
        <section className="card">
          <h2>Equipment Info</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Model Number</label>
              <input
                value={form.model_number}
                onChange={(e) => setForm({ ...form, model_number: e.target.value })}
                disabled={!isEditable}
                placeholder="Model number"
              />
            </div>
            <div className="form-group">
              <label>Serial Number</label>
              <input
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                disabled={!isEditable}
                placeholder="Serial number"
              />
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
              <label>Technician Notes (for AI)</label>
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
          <div className="parts-header">
            <h2>Parts</h2>
            {isEditable && (
              <button className="btn btn-ai btn-sm" onClick={handleAiParts} disabled={aiPartsLoading}>
                <Sparkles size={14} />
                {aiPartsLoading ? 'Searching...' : 'AI Suggest Parts'}
              </button>
            )}
          </div>

          {suggestedParts.length > 0 && (
            <div className="suggested-parts">
              <p className="suggested-label">AI Suggestions — search or add to invoice:</p>
              {suggestedParts.map((p, i) => {
                const q = encodeURIComponent(`${p.name}${p.part_number ? ' ' + p.part_number : ''}`);
                const searches = [
                  { label: 'Google', url: `https://www.google.com/search?q=${q}&tbm=shop` },
                  { label: 'Amazon', url: `https://www.amazon.com/s?k=${q}` },
                  { label: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
                  { label: 'RepairClinic', url: `https://www.repairclinic.com/Search?q=${q}` },
                ];
                return (
                <div key={i} className="suggested-part-item">
                  <div className="suggested-part-info">
                    <strong>{p.name}</strong>
                    {p.part_number && <span className="part-num">#{p.part_number}</span>}
                    <span className="part-qty">Qty: {p.quantity}</span>
                    {p.notes && <span className="part-notes">{p.notes}</span>}
                    <div className="part-search-links">
                      {searches.map((s) => (
                        <a key={s.label} href={s.url} target="_blank" rel="noreferrer" className="part-search-link">
                          {s.label}
                        </a>
                      ))}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={async () => {
                      try {
                        await api.post(`/invoices/${id}/parts`, {
                          name: p.name,
                          part_number: p.part_number,
                          quantity: p.quantity,
                          notes: p.notes,
                        });
                        setSuggestedParts((s) => s.filter((_, idx) => idx !== i));
                        load();
                        toast.success('Part added');
                      } catch { toast.error('Failed to add part'); }
                    }}
                  >
                    Add
                  </button>
                </div>
                );
              })}
            </div>
          )}

          <PartsSection invoiceId={id} parts={invoice.parts || []} isEditable={isEditable} onUpdate={load} />
        </section>

        {/* Submit */}
        {isTech && isEditable && (
          <div className="action-bar">
            <button className="btn btn-primary" onClick={handleSubmit}>
              <Send size={16} /> Submit for Manager Review
            </button>
          </div>
        )}

        {/* Manager Review */}
        {isManager && invoice.status === 'submitted' && (
          <section className="card review-section">
            <h2>Manager Review</h2>
            <div className="form-group">
              <label>Notes (required for rejection)</label>
              <textarea rows={3} value={managerNotes} onChange={(e) => setManagerNotes(e.target.value)} placeholder="Add notes for the technician..." />
            </div>
            <div className="review-actions">
              <button className="btn btn-danger" onClick={handleReject}><XCircle size={16} /> Reject</button>
              <button className="btn btn-success" onClick={handleApprove}><CheckCircle size={16} /> Approve</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
