import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Plus, Search, Upload, Sparkles, X, FileText, Trash2 } from 'lucide-react';
import './ClaimsPage.css';

const EMPTY_FORM = {
  claim_number: '', title: '', description: '', assigned_to: '', claim_photo_url: '',
  customer_name: '', customer_phone: '', job_address: '',
  date_of_service: '', type_brand: '', model_number: '', serial_number: '',
};

export default function ClaimsPage() {
  const { user } = useAuth();
  const photoInputRef = useRef(null);
  const templateInputRef = useRef(null);

  const [tab, setTab] = useState('claims');
  const [claims, setClaims] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const [templateForm, setTemplateForm] = useState({ name: '', description: '' });
  const [templateUploading, setTemplateUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/claims').then((r) => setClaims(r.data)).finally(() => setLoading(false));
    if (user.role !== 'technician') {
      api.get('/users/technicians').then((r) => setTechnicians(r.data));
      api.get('/upload/claim-templates').then((r) => setTemplates(r.data));
    }
  }, [user.role]);

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoLoading(true);
    setPhotoPreview(URL.createObjectURL(file));

    try {
      const data = new FormData();
      data.append('photo', file);
      if (selectedTemplateId) data.append('template_id', selectedTemplateId);

      const res = await api.post('/upload/claim-photo', data);
      const { extracted, blob_url } = res.data;

      // Auto-generate fallbacks so required fields are never empty
      const today = new Date();
      const autoNumber = `SVC-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${Math.floor(100+Math.random()*900)}`;
      const autoTitle = [extracted.type_brand, extracted.customer_name].filter(Boolean).join(' — ') || 'Service Call';

      setForm((f) => ({
        ...f,
        claim_photo_url: blob_url,
        claim_number: extracted.claim_number || f.claim_number || autoNumber,
        title: extracted.title || f.title || autoTitle,
        description: extracted.description || f.description,
        customer_name: extracted.customer_name || f.customer_name,
        customer_phone: extracted.customer_phone || f.customer_phone,
        job_address: extracted.job_address || f.job_address,
        date_of_service: extracted.date_of_service || f.date_of_service,
        type_brand: extracted.type_brand || f.type_brand,
        model_number: extracted.model_number || f.model_number,
        serial_number: extracted.serial_number || f.serial_number,
      }));

      const filled = Object.values(extracted).filter(v => v && v !== 'low').length;
      toast.success(filled > 2 ? `Photo uploaded — AI filled ${filled} fields` : 'Photo uploaded — review fields below');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
      setPhotoPreview(null);
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setForm((f) => ({ ...f, claim_photo_url: '' }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/claims', form);
      setClaims([res.data, ...claims]);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setPhotoPreview(null);
      setSelectedTemplateId('');
      toast.success('Claim created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create claim');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setPhotoPreview(null);
    setSelectedTemplateId('');
  };

  const handleTemplateUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!templateForm.name.trim()) { toast.error('Enter a template name first'); e.target.value = ''; return; }
    setTemplateUploading(true);
    try {
      const data = new FormData();
      data.append('template', file);
      data.append('name', templateForm.name.trim());
      if (templateForm.description) data.append('description', templateForm.description);
      const res = await api.post('/upload/claim-template', data);
      setTemplates((t) => [res.data, ...t]);
      setTemplateForm({ name: '', description: '' });
      toast.success('Template uploaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setTemplateUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteTemplate = async (id) => {
    try {
      await api.delete(`/upload/claim-template/${id}`);
      setTemplates((t) => t.filter((x) => x.id !== id));
      if (selectedTemplateId === id) setSelectedTemplateId('');
      toast.success('Template removed');
    } catch { toast.error('Failed to remove template'); }
  };

  const filtered = claims.filter((c) =>
    c.claim_number.toLowerCase().includes(search.toLowerCase()) ||
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    (c.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="claims-page">
      <div className="page-header">
        <h1>{user.role === 'technician' ? 'My Claims' : 'All Claims'}</h1>
        <div className="page-header-actions">
          {user.role === 'admin' && (
            <div className="tab-toggle">
              <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>Claims</button>
              <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
                <FileText size={14} /> Templates
              </button>
            </div>
          )}
          {user.role !== 'technician' && tab === 'claims' && (
            <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
              <Plus size={16} /> New Claim
            </button>
          )}
        </div>
      </div>

      {/* Templates tab */}
      {tab === 'templates' && user.role === 'admin' && (
        <div className="templates-section">
          <div className="template-upload-form create-form">
            <h2>Upload Service Form Template</h2>
            <p className="template-hint">
              Upload a blank copy of your service form (e.g. Alpha Appliances Repair form).
              Claude will use it as a reference to extract fields from filled-in photos.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Template Name</label>
                <input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="e.g. Alpha Appliances Service Form" />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} placeholder="e.g. Standard repair service order" />
              </div>
            </div>
            <input ref={templateInputRef} type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleTemplateUpload} style={{ display: 'none' }} />
            <button type="button" className="photo-upload-btn" onClick={() => templateInputRef.current.click()} disabled={templateUploading}>
              <Upload size={18} />
              <span>{templateUploading ? 'Uploading...' : 'Choose Template File'}</span>
              <small>JPEG, PNG, or PDF</small>
            </button>
          </div>
          <h3 className="templates-list-title">Saved Templates</h3>
          {templates.length === 0 ? <p className="empty-templates">No templates yet.</p> : (
            <div className="templates-list">
              {templates.map((t) => (
                <div key={t.id} className="template-card">
                  <div className="template-card-info">
                    <FileText size={20} />
                    <div>
                      <strong>{t.name}</strong>
                      {t.description && <p>{t.description}</p>}
                      <small>Added {new Date(t.created_at).toLocaleDateString()}</small>
                    </div>
                  </div>
                  <button className="remove-photo-btn" onClick={() => handleDeleteTemplate(t.id)}><Trash2 size={14} /> Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Claims tab */}
      {tab === 'claims' && (
        <>
          {showForm && (
            <form className="create-form" onSubmit={handleCreate}>
              <h2>New Service Claim</h2>

              {/* Template selector */}
              {templates.length > 0 && (
                <div className="form-group">
                  <label>Service Form Template <span className="label-hint">(helps AI extract fields accurately)</span></label>
                  <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                    <option value="">No template</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              {/* Photo upload */}
              <div className="claim-photo-upload">
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                {photoPreview ? (
                  <div className="photo-preview-wrap">
                    <img src={photoPreview} alt="Claim" className="claim-photo-preview" />
                    <div className="photo-preview-info">
                      <div className="photo-preview-label">
                        <Sparkles size={14} />
                        {photoLoading ? 'Extracting fields with AI...' : 'AI extracted fields below — review and edit as needed'}
                      </div>
                      <button type="button" className="remove-photo-btn" onClick={handleRemovePhoto}><X size={14} /> Remove photo</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="photo-upload-btn" onClick={() => photoInputRef.current.click()} disabled={photoLoading}>
                    <Upload size={18} />
                    <span>Take Photo or Upload Service Form</span>
                    <small>{selectedTemplateId ? `Using: ${templates.find(t => t.id === selectedTemplateId)?.name}` : 'AI will extract all fields automatically'}</small>
                  </button>
                )}
              </div>

              <div className="form-section-label">Customer Info</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Customer Name</label>
                  <input value={form.customer_name} onChange={setField('customer_name')} placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input value={form.customer_phone} onChange={setField('customer_phone')} placeholder="Home or cell" />
                </div>
              </div>
              <div className="form-group">
                <label>Job Address</label>
                <input value={form.job_address} onChange={setField('job_address')} placeholder="Service location address" />
              </div>

              <div className="form-section-label">Appliance Info</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Type & Brand</label>
                  <input value={form.type_brand} onChange={setField('type_brand')} placeholder="e.g. Samsung Refrigerator" />
                </div>
                <div className="form-group">
                  <label>Date of Service</label>
                  <input type="date" value={form.date_of_service} onChange={setField('date_of_service')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Model #</label>
                  <input value={form.model_number} onChange={setField('model_number')} placeholder="Model number" />
                </div>
                <div className="form-group">
                  <label>Serial #</label>
                  <input value={form.serial_number} onChange={setField('serial_number')} placeholder="Serial number" />
                </div>
              </div>

              <div className="form-section-label">Service Details</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Invoice #</label>
                  <input value={form.claim_number} onChange={setField('claim_number')} placeholder="Auto-generated from photo" />
                </div>
                <div className="form-group">
                  <label>Assign Technician</label>
                  <select value={form.assigned_to} onChange={setField('assigned_to')}>
                    <option value="">Unassigned</option>
                    {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Title</label>
                <input value={form.title} onChange={setField('title')} placeholder="Auto-generated from photo" />
              </div>
              <div className="form-group">
                <label>Nature of Service</label>
                <textarea rows={3} value={form.description} onChange={setField('description')} placeholder="Describe the issue or service requested" />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={photoLoading}>Create Claim</button>
              </div>
            </form>
          )}

          <div className="search-bar">
            <Search size={16} />
            <input placeholder="Search by invoice #, title, or customer name..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {loading ? <p>Loading...</p> : (
            <div className="claims-table-wrap">
              <table className="claims-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Appliance</th>
                    <th>Assigned To</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td><span className="claim-num-link">{c.claim_number}</span></td>
                      <td>{c.customer_name || c.title}</td>
                      <td>{c.type_brand || <span className="unassigned">—</span>}</td>
                      <td>{c.assigned_to_name || <span className="unassigned">Unassigned</span>}</td>
                      <td><span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span></td>
                      <td>{c.date_of_service ? new Date(c.date_of_service).toLocaleDateString() : new Date(c.created_at).toLocaleDateString()}</td>
                      <td><Link to={`/claims/${c.id}`} className="btn btn-sm btn-secondary">View</Link></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="empty-cell">No claims found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
