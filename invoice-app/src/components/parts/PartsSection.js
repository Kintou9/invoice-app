import { useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { Plus, Trash2, Link, Sparkles } from 'lucide-react';
import './PartsSection.css';

export default function PartsSection({ invoiceId, parts, isEditable, onUpdate }) {
  const [newPart, setNewPart] = useState({ name: '', part_number: '', quantity: 1, notes: '' });
  const [aiLoading, setAiLoading] = useState(false);
  const [addingLink, setAddingLink] = useState(null); // part id
  const [linkForm, setLinkForm] = useState({ supplier_name: '', url: '', price_note: '' });

  const handleAddPart = async (e) => {
    e.preventDefault();
    try {
      await api.post('/parts', { invoice_id: invoiceId, ...newPart });
      setNewPart({ name: '', part_number: '', quantity: 1, notes: '' });
      onUpdate();
      toast.success('Part added');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add part');
    }
  };

  const handleDeletePart = async (partId) => {
    try {
      await api.delete(`/parts/${partId}`);
      onUpdate();
    } catch {
      toast.error('Delete failed');
    }
  };

  const handleAiSuggest = async () => {
    setAiLoading(true);
    try {
      const res = await api.post(`/invoices/${invoiceId}/ai/parts`);
      if (!res.data.parts?.length) { toast.info('No parts suggested'); return; }
      await api.post('/parts/bulk', { invoice_id: invoiceId, parts: res.data.parts });
      onUpdate();
      toast.success(`${res.data.parts.length} parts suggested by AI`);
    } catch {
      toast.error('AI suggestion failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddLink = async (partId) => {
    if (!linkForm.url) { toast.error('URL is required'); return; }
    try {
      await api.post(`/parts/${partId}/links`, linkForm);
      setAddingLink(null);
      setLinkForm({ supplier_name: '', url: '', price_note: '' });
      onUpdate();
      toast.success('Link added');
    } catch {
      toast.error('Failed to add link');
    }
  };

  const handleDeleteLink = async (linkId) => {
    try {
      await api.delete(`/parts/links/${linkId}`);
      onUpdate();
    } catch {
      toast.error('Failed to remove link');
    }
  };

  return (
    <div className="parts-section">
      {isEditable && (
        <div className="parts-actions">
          <button className="btn btn-ai" onClick={handleAiSuggest} disabled={aiLoading}>
            <Sparkles size={14} />
            {aiLoading ? 'Suggesting...' : 'AI Suggest Parts'}
          </button>
        </div>
      )}

      {parts.length === 0 && <p className="empty-parts">No parts added yet.</p>}

      <div className="parts-list">
        {parts.map((part) => (
          <div key={part.id} className="part-card">
            <div className="part-main">
              <div className="part-info">
                <span className="part-name">{part.name}</span>
                {part.part_number && <span className="part-num">P/N: {part.part_number}</span>}
                <span className="part-qty">Qty: {part.quantity}</span>
                {part.notes && <span className="part-notes">{part.notes}</span>}
              </div>
              {isEditable && (
                <button className="btn-icon-danger" onClick={() => handleDeletePart(part.id)} title="Remove part">
                  <Trash2 size={15} />
                </button>
              )}
            </div>

            <div className="part-links">
              {part.supplier_links?.map((link) => (
                <div key={link.id} className="supplier-link">
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <Link size={12} /> {link.supplier_name || link.url}
                  </a>
                  {link.price_note && <span className="price-note">{link.price_note}</span>}
                  {isEditable && (
                    <button className="link-delete" onClick={() => handleDeleteLink(link.id)}>×</button>
                  )}
                </div>
              ))}

              {isEditable && (
                addingLink === part.id ? (
                  <div className="add-link-form">
                    <input placeholder="Supplier name" value={linkForm.supplier_name} onChange={(e) => setLinkForm({ ...linkForm, supplier_name: e.target.value })} />
                    <input placeholder="URL *" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} required />
                    <input placeholder="Price note" value={linkForm.price_note} onChange={(e) => setLinkForm({ ...linkForm, price_note: e.target.value })} />
                    <div className="add-link-btns">
                      <button className="btn btn-sm btn-secondary" onClick={() => setAddingLink(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => handleAddLink(part.id)}>Add</button>
                    </div>
                  </div>
                ) : (
                  <button className="add-link-btn" onClick={() => { setAddingLink(part.id); setLinkForm({ supplier_name: '', url: '', price_note: '' }); }}>
                    <Link size={12} /> Add supplier link
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {isEditable && (
        <form className="add-part-form" onSubmit={handleAddPart}>
          <h3>Add Part</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Part Name *</label>
              <input value={newPart.name} onChange={(e) => setNewPart({ ...newPart, name: e.target.value })} required placeholder="e.g. Capacitor 40/5 MFD" />
            </div>
            <div className="form-group">
              <label>Part Number</label>
              <input value={newPart.part_number} onChange={(e) => setNewPart({ ...newPart, part_number: e.target.value })} placeholder="Optional" />
            </div>
            <div className="form-group" style={{ maxWidth: 80 }}>
              <label>Qty</label>
              <input type="number" min={1} value={newPart.quantity} onChange={(e) => setNewPart({ ...newPart, quantity: parseInt(e.target.value) })} />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input value={newPart.notes} onChange={(e) => setNewPart({ ...newPart, notes: e.target.value })} placeholder="Why this part is needed" />
          </div>
          <button type="submit" className="btn btn-secondary">
            <Plus size={14} /> Add Part
          </button>
        </form>
      )}
    </div>
  );
}
