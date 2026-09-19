import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { eventLabel, eventDetails } from '../utils/activityLabels';
import { getWorkStatus, WORK_STATUS } from '../utils/workStatus';
import {
  Plus, Search, Upload, Sparkles, X, FileText, Trash2, ChevronDown,
  MoreHorizontal, MessageSquare, User,
} from 'lucide-react';
import './ClaimsPage.css';

const EMPTY_FORM = {
  claim_number: '', title: '', description: '', assigned_to: '', claim_photo_url: '',
  customer_name: '', customer_phone: '', job_address: '',
  date_of_service: '', type_brand: '', model_number: '', serial_number: '',
};

const ROWS_PER_PAGE = 25;

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

const TABS = [
  { key: 'all', label: 'All jobs' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'ready_to_invoice', label: 'Ready to invoice' },
];

export default function ClaimsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const photoInputRef = useRef(null);
  const templateInputRef = useRef(null);
  const newJobMenuRef = useRef(null);

  const [tab, setTab] = useState('claims');
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [activity, setActivity] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [searchParams] = useSearchParams();
  const [workerFilter, setWorkerFilter] = useState(searchParams.get('worker') || '');
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusTab, setStatusTab] = useState(searchParams.get('status') || 'all');
  const [reassigningId, setReassigningId] = useState(null);
  const [page, setPage] = useState(1);
  const [newJobMenuOpen, setNewJobMenuOpen] = useState(false);
  const [generatingInvoiceFor, setGeneratingInvoiceFor] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const [templateForm, setTemplateForm] = useState({ name: '', description: '' });
  const [templateUploading, setTemplateUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const isWorker = user.role === 'worker';

  useEffect(() => {
    api.get('/claims').then((r) => setClaims(r.data)).finally(() => setLoading(false));
    api.get('/invoices').then((r) => setInvoices(r.data)).catch(() => {});
    if (!isWorker) {
      api.get('/users/technicians').then((r) => setTechnicians(r.data));
      api.get('/upload/claim-templates').then((r) => setTemplates(r.data));
      api.get('/audit-log?limit=5').then((r) => setActivity(r.data)).catch(() => {});
    }
  }, [isWorker]);

  // Dashboard quick-create tiles ("From photo" / "Enter manually") link
  // here with ?new=1&mode=photo|manual — both just open this same combined
  // form; "from photo" additionally focuses the photo picker, since the
  // photo upload has always been an optional accelerator on this one form,
  // not a separate flow.
  useEffect(() => {
    if (searchParams.get('new') !== '1' || isWorker) return;
    setShowForm(true);
    if (searchParams.get('mode') === 'photo') {
      requestAnimationFrame(() => photoInputRef.current?.click());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (newJobMenuRef.current && !newJobMenuRef.current.contains(e.target)) setNewJobMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const invoicesByClaim = useMemo(() => {
    const map = {};
    for (const inv of invoices) {
      (map[inv.claim_id] = map[inv.claim_id] || []).push(inv);
    }
    return map;
  }, [invoices]);

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
      toast.success('Job created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create job');
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

  const handleReassign = async (claimId, newWorkerId) => {
    setReassigningId(claimId);
    try {
      const res = await api.patch(`/claims/${claimId}`, { assigned_to: newWorkerId || null });
      const assigned_to_name = newWorkerId
        ? technicians.find((t) => t.id === newWorkerId)?.name
        : null;
      setClaims((cs) => cs.map((c) => (c.id === claimId ? { ...c, ...res.data, assigned_to_name } : c)));
      toast.success(newWorkerId ? 'Job reassigned' : 'Job unassigned');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update assignment');
    } finally {
      setReassigningId(null);
    }
  };

  const handleGenerateInvoice = async (claim) => {
    setGeneratingInvoiceFor(claim.id);
    try {
      const res = await api.post('/invoices', { claim_id: claim.id });
      setInvoices((inv) => [res.data, ...inv]);
      toast.success('Invoice started');
      navigate(`/invoices/${res.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start invoice');
      setGeneratingInvoiceFor(null);
    }
  };

  const serviceOptions = useMemo(
    () => [...new Set(claims.map((c) => c.type_brand).filter(Boolean))].sort(),
    [claims]
  );

  const enriched = useMemo(
    () => claims.map((c) => ({ ...c, workStatus: getWorkStatus(c, invoicesByClaim[c.id] || []) })),
    [claims, invoicesByClaim]
  );

  const tabCounts = useMemo(() => {
    const counts = { all: enriched.length };
    for (const key of Object.keys(WORK_STATUS)) counts[key] = 0;
    for (const c of enriched) counts[c.workStatus] = (counts[c.workStatus] || 0) + 1;
    return counts;
  }, [enriched]);

  const filtered = enriched
    .filter((c) =>
      c.claim_number.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.customer_name || '').toLowerCase().includes(search.toLowerCase())
    )
    .filter((c) => {
      if (statusTab === 'all') return true;
      if (statusTab === 'in_progress') return c.workStatus === 'in_progress' || c.workStatus === 'scheduled';
      return c.workStatus === statusTab;
    })
    .filter((c) => {
      if (!workerFilter) return true;
      if (workerFilter === 'unassigned') return !c.assigned_to;
      return c.assigned_to === workerFilter;
    })
    .filter((c) => !serviceFilter || c.type_brand === serviceFilter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageClamped - 1) * ROWS_PER_PAGE, pageClamped * ROWS_PER_PAGE);

  const actionFor = (claim) => {
    switch (claim.workStatus) {
      case 'unassigned':
        return { label: 'Assign', variant: 'btn-secondary', onClick: () => setReassigningId(claim.id) };
      case 'needs_review':
        // The review experience (approve/request changes, parts & labor,
        // photos) now lives on the job detail page itself, not the raw
        // invoice page.
        return { label: 'Review work', variant: 'btn-primary', to: `/claims/${claim.id}` };
      case 'ready_to_invoice':
        return { label: generatingInvoiceFor === claim.id ? 'Starting...' : 'Generate invoice', variant: 'btn-primary', onClick: () => handleGenerateInvoice(claim), disabled: generatingInvoiceFor === claim.id };
      default:
        return { label: 'Open job', variant: 'btn-secondary', to: `/claims/${claim.id}` };
    }
  };

  return (
    <div className="claims-page">
      <div className="page-header">
        <div>
          <h1>{isWorker ? 'My Jobs' : 'Jobs'}</h1>
          {!isWorker && <p className="jobs-subtitle">Assign work, review updates and prepare invoices.</p>}
        </div>
        <div className="page-header-actions">
          {user.role === 'owner' && (
            <div className="tab-toggle">
              <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>Jobs</button>
              <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
                <FileText size={14} /> Templates
              </button>
            </div>
          )}
          {!isWorker && tab === 'claims' && (
            <div className="new-job-menu" ref={newJobMenuRef}>
              <button className="btn btn-primary" onClick={() => setNewJobMenuOpen((o) => !o)}>
                <Plus size={16} /> New job <ChevronDown size={14} />
              </button>
              {newJobMenuOpen && (
                <div className="new-job-dropdown">
                  <button onClick={() => { setNewJobMenuOpen(false); setShowForm(true); requestAnimationFrame(() => photoInputRef.current?.click()); }}>
                    <FileText size={15} /> From insurance document
                  </button>
                  <button onClick={() => { setNewJobMenuOpen(false); setShowForm(true); }}>
                    <Plus size={15} /> Enter manually
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Templates tab */}
      {tab === 'templates' && user.role === 'owner' && (
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

      {/* Jobs tab */}
      {tab === 'claims' && (
        <>
          {showForm && (
            <form className="create-form" onSubmit={handleCreate}>
              <h2>New Job</h2>

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
                    <img src={photoPreview} alt="Job" className="claim-photo-preview" />
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
                    <span>Upload Insurance Document or Service Form</span>
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

              <div className="form-section-label">Job Details</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Job #</label>
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
                <button type="submit" className="btn btn-primary" disabled={photoLoading}>Create Job</button>
              </div>
            </form>
          )}

          <div className="search-bar">
            <Search size={16} />
            <input placeholder="Search job, customer or claim #..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>

          {!isWorker && (
            <div className="jobs-status-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={statusTab === t.key ? 'active' : ''}
                  onClick={() => { setStatusTab(t.key); setPage(1); }}
                >
                  {t.label} <span className="jobs-status-tab-count">{tabCounts[t.key] || 0}</span>
                </button>
              ))}
            </div>
          )}

          <div className="claims-filter-bar">
            {!isWorker && (
              <select value={workerFilter} onChange={(e) => { setWorkerFilter(e.target.value); setPage(1); }}>
                <option value="">All workers</option>
                <option value="unassigned">Unassigned only</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {serviceOptions.length > 0 && (
              <select value={serviceFilter} onChange={(e) => { setServiceFilter(e.target.value); setPage(1); }}>
                <option value="">Service type</option>
                {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {(workerFilter || serviceFilter || statusTab !== 'all') && (
              <button
                type="button"
                className="claims-filter-clear"
                onClick={() => { setWorkerFilter(''); setServiceFilter(''); setStatusTab('all'); setPage(1); }}
              >
                Clear filters
              </button>
            )}
          </div>

          {loading ? <p>Loading...</p> : (
            <div className="claims-table-wrap">
              <table className="claims-table jobs-table">
                <thead>
                  <tr>
                    <th>Job / customer</th>
                    <th>Service</th>
                    {!isWorker && <th>Assigned to</th>}
                    <th>Appointment</th>
                    <th>Work status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c) => {
                    const status = WORK_STATUS[c.workStatus];
                    const action = actionFor(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/claims/${c.id}`} className="claim-num-link">{c.claim_number}</Link>
                          <div className="jobs-customer-sub">{c.customer_name || c.title}</div>
                        </td>
                        <td>{c.type_brand || <span className="unassigned">—</span>}</td>
                        {!isWorker && (
                          <td>
                            {reassigningId === c.id ? (
                              <select
                                className="reassign-select"
                                value={c.assigned_to || ''}
                                autoFocus
                                onBlur={() => setReassigningId(null)}
                                onChange={(e) => handleReassign(c.id, e.target.value)}
                              >
                                <option value="">Unassigned</option>
                                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            ) : (
                              <button type="button" className="jobs-assignee" onClick={() => setReassigningId(c.id)}>
                                {c.assigned_to_name ? (
                                  <span className="jobs-avatar">{initials(c.assigned_to_name)}</span>
                                ) : (
                                  <span className="jobs-avatar jobs-avatar-empty"><User size={13} /></span>
                                )}
                                {c.assigned_to_name || <span className="unassigned">Unassigned</span>}
                              </button>
                            )}
                          </td>
                        )}
                        <td>{c.date_of_service ? new Date(c.date_of_service).toLocaleDateString() : new Date(c.created_at).toLocaleDateString()}</td>
                        <td><span className={`work-status-badge work-status-${status.tone}`}>{status.label}</span></td>
                        <td>
                          <div className="jobs-action-cell">
                            {action.to ? (
                              <Link to={action.to} className={`btn btn-sm ${action.variant}`}>{action.label}</Link>
                            ) : (
                              <button className={`btn btn-sm ${action.variant}`} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>
                            )}
                            <Link to={`/claims/${c.id}`} className="btn-icon jobs-more-btn" title="Open job" aria-label="Open job">
                              <MoreHorizontal size={16} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pageItems.length === 0 && (
                    <tr><td colSpan={isWorker ? 5 : 6} className="empty-cell">No jobs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="jobs-pagination">
              <span className="jobs-pagination-count">
                {(pageClamped - 1) * ROWS_PER_PAGE + 1}–{Math.min(pageClamped * ROWS_PER_PAGE, filtered.length)} of {filtered.length} jobs
              </span>
              <div className="jobs-pagination-controls">
                <button className="btn btn-sm btn-secondary" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}>Previous</button>
                <span className="jobs-pagination-page">{pageClamped} / {totalPages}</span>
                <button className="btn btn-sm btn-secondary" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}>Next</button>
              </div>
            </div>
          )}

          {!isWorker && (
            <section className="jobs-activity-card">
              <div className="jobs-activity-header">
                <span><MessageSquare size={16} /> Latest worker updates</span>
              </div>
              {activity.length === 0 ? (
                <p className="empty-msg">No recent activity.</p>
              ) : (
                <div className="jobs-activity-list">
                  {activity.map((entry) => (
                    <div key={entry.id} className="jobs-activity-row">
                      <span className="jobs-avatar">{initials(entry.performed_by_name)}</span>
                      <span className="jobs-activity-text">
                        <strong>{entry.performed_by_name || 'Someone'}</strong> {eventLabel(entry).toLowerCase()}
                        {eventDetails(entry) && <span className="jobs-activity-detail"> — {eventDetails(entry)}</span>}
                      </span>
                      <span className="jobs-activity-time">{new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
