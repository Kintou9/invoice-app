import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getWorkStatus, WORK_STATUS } from '../utils/workStatus';
import { allowsServiceCallFee } from '../utils/serviceCallFee';
import PartPurchasesSection from '../components/purchases/PartPurchasesSection';
import LineItemsSection, { PAYMENT_METHOD_LABELS } from '../components/invoices/LineItemsSection';
import {
  User, Phone, MapPin, Calendar, FileText, RefreshCw, Camera, ExternalLink,
  Navigation, Send, Package, Wrench,
} from 'lucide-react';
import './ClaimDetailPage.css';

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function ClaimDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isWorker = user.role === 'worker';
  const photoInputRef = useRef(null);
  const purchasesRef = useRef(null);

  const [claim, setClaim] = useState(null);
  const [invoiceSummaries, setInvoiceSummaries] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('details');
  const [reassigning, setReassigning] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approving, setApproving] = useState(false);
  const [submittingReject, setSubmittingReject] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  // Worker "Your work" edit state
  const [workForm, setWorkForm] = useState({ issue_description: '', ai_generated_description: '', model_number: '', serial_number: '' });
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingWork, setSubmittingWork] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [customerEditing, setCustomerEditing] = useState(false);
  const [customerForm, setCustomerForm] = useState({ customer_name: '', customer_phone: '', job_address: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);

  const load = () => {
    Promise.all([
      api.get(`/claims/${id}`),
      api.get(`/invoices?claim_id=${id}`),
      !isWorker ? api.get('/users/technicians') : Promise.resolve({ data: [] }),
    ]).then(async ([c, inv, tech]) => {
      setClaim(c.data);
      setInvoiceSummaries(inv.data);
      setTechnicians(tech.data);
      const active = inv.data[0];
      if (active) {
        const full = await api.get(`/invoices/${active.id}`);
        setInvoice(full.data);
      } else {
        setInvoice(null);
      }
    }).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  // Seeds the editable "Your work" form only when the invoice identity
  // changes (first load, or a brand new draft from "Start work") — never on
  // every background reload (e.g. after a photo upload or a line-item add),
  // which would otherwise silently overwrite text the worker typed but
  // hasn't saved yet.
  useEffect(() => {
    if (invoice) {
      setWorkForm({
        issue_description: invoice.issue_description || '',
        ai_generated_description: invoice.ai_generated_description || '',
        model_number: invoice.model_number || '',
        serial_number: invoice.serial_number || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const handleReassign = async (workerId) => {
    try {
      const res = await api.patch(`/claims/${id}`, { assigned_to: workerId || null });
      setClaim((c) => ({ ...c, ...res.data, assigned_to_name: technicians.find((t) => t.id === workerId)?.name || null }));
      toast.success(workerId ? 'Worker reassigned' : 'Job unassigned');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reassign');
    } finally {
      setReassigning(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/invoices/${invoice.id}/approve`);
      toast.success('Work approved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectNotes.trim()) { toast.error('Add a note explaining what needs to change'); return; }
    setSubmittingReject(true);
    try {
      await api.post(`/invoices/${invoice.id}/reject`, { manager_notes: rejectNotes });
      toast.success('Sent back for changes');
      setRejecting(false);
      setRejectNotes('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to request changes');
    } finally {
      setSubmittingReject(false);
    }
  };

  const handleCreateInvoice = async () => {
    setCreatingInvoice(true);
    try {
      const res = await api.post('/invoices', { claim_id: id });
      toast.success(isWorker ? 'Work started' : 'Invoice started');
      setInvoiceSummaries([res.data, ...invoiceSummaries]);
      const full = await api.get(`/invoices/${res.data.id}`);
      setInvoice(full.data);
      setClaim((c) => ({ ...c, status: 'in_progress' }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start invoice');
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleGeneratePdf = async () => {
    setPdfLoading(true);
    try {
      const res = await api.post(`/invoices/${invoice.id}/generate-pdf`);
      window.open(res.data.pdf_url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await api.get(`/invoices/${invoice.id}/pdf`);
      window.open(res.data.pdf_url, '_blank', 'noopener');
    } catch (err) {
      if (err.response?.status === 404) {
        await handleGeneratePdf();
      } else {
        toast.error(err.response?.data?.error || 'Could not load PDF');
      }
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      await api.patch(`/invoices/${invoice.id}`, workForm);
      toast.success('Draft saved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmitWork = async () => {
    setSubmittingWork(true);
    try {
      await api.patch(`/invoices/${invoice.id}`, workForm);
      await api.post(`/invoices/${invoice.id}/submit`);
      toast.success('Submitted for review');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit for review');
    } finally {
      setSubmittingWork(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoUploading(true);
    try {
      const data = new FormData();
      data.append('photo', file);
      await api.post(`/upload/photo/${invoice.id}`, data);
      toast.success('Photo added');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handleStatusChange = async (newStatus) => {
    setStatusSaving(true);
    try {
      const res = await api.patch(`/claims/${id}`, { status: newStatus });
      setClaim((c) => ({ ...c, ...res.data }));
      toast.success('Job status updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update status');
    } finally {
      setStatusSaving(false);
    }
  };

  const toggleCustomerEdit = () => {
    if (!customerEditing) {
      setCustomerForm({
        customer_name: claim.customer_name || '',
        customer_phone: claim.customer_phone || '',
        job_address: claim.job_address || '',
      });
    }
    setCustomerEditing((v) => !v);
  };

  const handleSaveCustomer = async () => {
    setSavingCustomer(true);
    try {
      const res = await api.patch(`/claims/${id}`, customerForm);
      setClaim((c) => ({ ...c, ...res.data }));
      toast.success('Customer info updated');
      setCustomerEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update customer info');
    } finally {
      setSavingCustomer(false);
    }
  };

  const scrollToPurchases = () => purchasesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (loading) return <p>Loading...</p>;
  if (!claim) return <p>Job not found.</p>;

  const workStatus = getWorkStatus(claim, invoiceSummaries);
  const statusMeta = WORK_STATUS[workStatus];
  const needsReview = workStatus === 'needs_review';
  const lineItems = invoice?.line_items || [];
  const subtotal = lineItems.reduce((sum, li) => sum + Number(li.total_price), 0);
  const taxRate = Number(invoice?.tax_rate) || 0;
  const feeAllowed = allowsServiceCallFee(invoice?.field_template_snapshot?.industry_key);
  const serviceCallFee = feeAllowed ? (Number(invoice?.service_call_fee) || 0) : 0;
  const total = subtotal + subtotal * taxRate / 100 + serviceCallFee;
  const workerEditable = !!invoice && (invoice.status === 'draft' || invoice.status === 'rejected');

  return (
    <div className="job-detail">
      <div className="job-breadcrumb">
        <Link to="/claims">{isWorker ? 'My jobs' : 'Jobs'}</Link> / <span>{claim.claim_number}</span>
      </div>

      <div className="job-header">
        <div>
          <div className="job-header-title-row">
            <h1>{claim.customer_name || claim.title}</h1>
            <span className={`work-status-badge work-status-${statusMeta.tone}`}>{statusMeta.label}</span>
          </div>
          <p className="job-header-sub">{claim.type_brand || claim.title} · {claim.claim_number}</p>
        </div>
        {!isWorker && needsReview && (
          <div className="job-header-actions">
            <button className="btn btn-secondary" onClick={() => setRejecting((r) => !r)}>Request changes</button>
            <button className="btn btn-primary" onClick={handleApprove} disabled={approving}>
              {approving ? 'Approving...' : 'Approve work'}
            </button>
          </div>
        )}
        {isWorker && invoice && workerEditable && (
          <div className="job-header-actions">
            <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={savingDraft}>
              {savingDraft ? 'Saving...' : 'Save draft'}
            </button>
            <button className="btn btn-primary" onClick={handleSubmitWork} disabled={submittingWork}>
              <Send size={16} /> {submittingWork ? 'Submitting...' : 'Submit for review'}
            </button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="job-reject-panel">
          <label htmlFor="reject-notes">What needs to change?</label>
          <textarea id="reject-notes" rows={2} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} placeholder="Explain what the technician needs to fix before resubmitting..." />
          <div className="job-reject-actions">
            <button className="btn btn-secondary" onClick={() => setRejecting(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleReject} disabled={submittingReject}>
              {submittingReject ? 'Sending...' : 'Send back for changes'}
            </button>
          </div>
        </div>
      )}

      {isWorker && ['open', 'in_progress'].includes(claim.status) && (
        <section className="card job-card job-status-card">
          <div className="job-status-row">
            <span className="job-field-label">Job status</span>
            <select value={claim.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusSaving}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
        </section>
      )}

      <div className="job-layout">
        <div className="job-main">
          {!isWorker ? (
            <section className="card job-card">
              <h2><User size={16} /> Customer &amp; assignment</h2>
              <div className="job-card-grid">
                <div>
                  <span className="job-field-label"><User size={13} /> Customer</span>
                  <strong className="job-field-value">{claim.customer_name || '—'}</strong>
                  {claim.job_address && <div className="job-field-sub"><MapPin size={12} /> {claim.job_address}</div>}
                  {claim.customer_phone && <div className="job-field-sub"><Phone size={12} /> {claim.customer_phone}</div>}
                </div>
                <div>
                  <span className="job-field-label">Assigned worker</span>
                  {reassigning ? (
                    <select className="reassign-select" autoFocus defaultValue={claim.assigned_to || ''} onBlur={() => setReassigning(false)} onChange={(e) => handleReassign(e.target.value)}>
                      <option value="">Unassigned</option>
                      {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : (
                    <>
                      <strong className="job-field-value">{claim.assigned_to_name || 'Unassigned'}</strong>
                      <button type="button" className="job-change-link" onClick={() => setReassigning(true)}>
                        <RefreshCw size={12} /> Change
                      </button>
                    </>
                  )}
                  <div className="job-field-sub job-appointment"><Calendar size={12} /> Appointment
                    <div className="job-appointment-date">
                      {claim.date_of_service ? new Date(claim.date_of_service).toLocaleDateString() : new Date(claim.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="card job-card">
              <h2><User size={16} /> Customer &amp; appointment</h2>
              <div className="job-card-grid">
                <div>
                  <span className="job-field-label"><User size={13} /> Customer</span>
                  <strong className="job-field-value">{claim.customer_name || '—'}</strong>
                  {claim.job_address && <div className="job-field-sub"><MapPin size={12} /> {claim.job_address}</div>}
                  {claim.customer_phone && <div className="job-field-sub"><Phone size={12} /> {claim.customer_phone}</div>}
                  {claim.job_address && (
                    <a className="job-directions-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(claim.job_address)}`} target="_blank" rel="noreferrer">
                      <Navigation size={12} /> Directions
                    </a>
                  )}
                </div>
                <div className="job-worker-appointment">
                  {claim.customer_phone && (
                    <a className="btn btn-secondary" href={`tel:${claim.customer_phone}`}>
                      <Phone size={14} /> Call customer
                    </a>
                  )}
                  <div className="job-field-sub job-appointment"><Calendar size={12} /> Appointment
                    <div className="job-appointment-date">
                      {claim.date_of_service ? new Date(claim.date_of_service).toLocaleDateString() : new Date(claim.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {invoice ? (
            <section className="card job-card">
              {!isWorker ? (
                <div className="job-submission-header">
                  <h2><User size={16} /> Worker submission</h2>
                  <span className="job-submission-meta">Submitted by {invoice.technician_name || 'technician'} · {timeAgo(invoice.updated_at)}</span>
                </div>
              ) : (
                <h2><Wrench size={16} /> Your work</h2>
              )}

              <div className="job-tabs">
                <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Work details</button>
                <button className={tab === 'parts' ? 'active' : ''} onClick={() => setTab('parts')}>Parts &amp; labor</button>
                <button className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}>Photos ({invoice.photos?.length || 0})</button>
              </div>

              {tab === 'details' && !isWorker && (
                <div className="job-tab-panel">
                  <div className="job-readonly-field">
                    <label>Diagnosis</label>
                    <div className="job-readonly-box">{invoice.issue_description || '—'}</div>
                  </div>
                  <div className="job-readonly-field">
                    <label>Work performed</label>
                    <div className="job-readonly-box">{invoice.ai_generated_description || invoice.issue_description || '—'}</div>
                  </div>
                </div>
              )}

              {tab === 'details' && isWorker && (
                <div className="job-tab-panel">
                  <div className="job-readonly-field">
                    <label>Diagnosis</label>
                    <textarea
                      className="job-edit-box"
                      rows={3}
                      maxLength={1000}
                      value={workForm.issue_description}
                      onChange={(e) => setWorkForm((f) => ({ ...f, issue_description: e.target.value }))}
                      disabled={!workerEditable}
                      placeholder="What did you find?"
                    />
                    <div className="job-char-count">{workForm.issue_description.length}/1000</div>
                  </div>
                  <div className="job-readonly-field">
                    <label>Work performed</label>
                    <textarea
                      className="job-edit-box"
                      rows={3}
                      maxLength={1000}
                      value={workForm.ai_generated_description}
                      onChange={(e) => setWorkForm((f) => ({ ...f, ai_generated_description: e.target.value }))}
                      disabled={!workerEditable}
                      placeholder="What did you do to fix it?"
                    />
                    <div className="job-char-count">{workForm.ai_generated_description.length}/1000</div>
                  </div>
                  <div className="job-equipment-grid">
                    <div className="job-readonly-field">
                      <label>Brand</label>
                      <input className="job-edit-box" value={claim.type_brand || ''} disabled placeholder="—" />
                    </div>
                    <div className="job-readonly-field">
                      <label>Model</label>
                      <input
                        className="job-edit-box"
                        value={workForm.model_number}
                        onChange={(e) => setWorkForm((f) => ({ ...f, model_number: e.target.value }))}
                        disabled={!workerEditable}
                        placeholder="Model number"
                      />
                    </div>
                    <div className="job-readonly-field">
                      <label>Serial number</label>
                      <input
                        className="job-edit-box"
                        value={workForm.serial_number}
                        onChange={(e) => setWorkForm((f) => ({ ...f, serial_number: e.target.value }))}
                        disabled={!workerEditable}
                        placeholder="Add serial number"
                      />
                    </div>
                  </div>
                  <div className="job-readonly-field">
                    <label>Photos ({invoice.photos?.length || 0})</label>
                    <div className="job-photo-grid">
                      {(invoice.photos || []).slice(0, 3).map((p) => (
                        <a key={p.id} href={p.sas_url || p.blob_url} target="_blank" rel="noreferrer" className="job-photo-thumb">
                          <img src={p.sas_url || p.blob_url} alt="Job attachment" />
                        </a>
                      ))}
                      {workerEditable && (
                        <button type="button" className="job-photo-add" onClick={() => photoInputRef.current.click()} disabled={photoUploading}>
                          <Camera size={18} />
                          {photoUploading ? 'Uploading...' : '+ Add photos'}
                        </button>
                      )}
                    </div>
                    {(invoice.photos || []).length > 3 && (
                      <button type="button" className="job-change-link" onClick={() => setTab('photos')}>View all {invoice.photos.length}</button>
                    )}
                    <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                  </div>
                </div>
              )}

              {tab === 'parts' && (
                <div className="job-tab-panel">
                  {isWorker ? (
                    <LineItemsSection
                      invoiceId={invoice.id}
                      lineItems={lineItems}
                      taxRate={invoice.tax_rate || 0}
                      serviceCallFee={invoice.service_call_fee || 0}
                      paymentMethod={invoice.payment_method}
                      allowServiceCallFee={feeAllowed}
                      isEditable={workerEditable}
                      onUpdate={load}
                    />
                  ) : lineItems.length === 0 && !serviceCallFee ? <p className="empty-msg">No parts or labor line items yet.</p> : (
                    <>
                      {lineItems.length > 0 && (
                        <table className="claims-table">
                          <thead><tr><th>Description</th><th>Qty</th><th>Billable amount</th></tr></thead>
                          <tbody>
                            {lineItems.map((li) => (
                              <tr key={li.id}>
                                <td>{li.description}</td>
                                <td>{li.quantity}{li.unit ? ` ${li.unit}` : ''}</td>
                                <td>${Number(li.total_price).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {feeAllowed && (
                        <>
                          <div className="job-invoice-total">
                            <span>Service call fee</span>
                            <span>${serviceCallFee.toFixed(2)}</span>
                          </div>
                          <div className="job-invoice-total">
                            <span>Paid by</span>
                            <span>{PAYMENT_METHOD_LABELS[invoice.payment_method] || '—'}</span>
                          </div>
                        </>
                      )}
                      <div className="job-invoice-total">
                        <span>{invoice.status === 'approved' ? 'Invoice total' : 'Proposed invoice total'}</span>
                        <strong>${total.toFixed(2)}</strong>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'photos' && (
                <div className="job-tab-panel">
                  {isWorker && workerEditable && (
                    <button type="button" className="btn btn-secondary job-add-photo-btn" onClick={() => photoInputRef.current.click()} disabled={photoUploading}>
                      <Camera size={16} /> {photoUploading ? 'Uploading...' : 'Add photos'}
                    </button>
                  )}
                  {(invoice.photos || []).length === 0 ? <p className="empty-msg">No photos uploaded.</p> : (
                    <div className="job-photo-grid">
                      {invoice.photos.map((p) => (
                        <a key={p.id} href={p.sas_url || p.blob_url} target="_blank" rel="noreferrer" className="job-photo-thumb">
                          <img src={p.sas_url || p.blob_url} alt="Job attachment" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isWorker && (
                <div className="job-parts-summary">
                  <div>
                    <strong>Parts &amp; labor</strong>
                    <span>{lineItems.length} item{lineItems.length === 1 ? '' : 's'} · ${total.toFixed(2)} proposed charges</span>
                  </div>
                  <button type="button" className="job-change-link" onClick={() => setTab('parts')}>Edit items</button>
                </div>
              )}
            </section>
          ) : (
            <section className="card job-card">
              <h2><Camera size={16} /> {isWorker ? 'Your work' : 'Worker submission'}</h2>
              {isWorker ? (
                <div className="job-invoice-empty">
                  <Wrench size={32} />
                  <strong>Work not started</strong>
                  <p>Start work to fill in your diagnosis, parts and photos.</p>
                  <button className="btn btn-primary" onClick={handleCreateInvoice} disabled={creatingInvoice}>
                    {creatingInvoice ? 'Starting...' : 'Start work'}
                  </button>
                </div>
              ) : (
                <p className="empty-msg">No work has been submitted for this job yet.</p>
              )}
            </section>
          )}

          <section className="card job-card" ref={purchasesRef}>
            <h2><FileText size={16} /> Parts &amp; Purchases</h2>
            <PartPurchasesSection claimId={id} invoices={invoiceSummaries} />
          </section>
        </div>

        <div className="job-sidebar">
          {!isWorker ? (
            <section className="card job-card">
              <h2><FileText size={16} /> Job details</h2>
              <div className="job-field-label">Reported issue</div>
              <p className="job-readonly-box job-readonly-box-sm">{claim.description || 'No description provided.'}</p>
            </section>
          ) : (
            <section className="card job-card">
              <h2><User size={16} /> Assignment details</h2>
              <div className="job-readonly-field">
                <label>Assigned by</label>
                <span className="job-field-value">{claim.created_by_name || '—'}</span>
              </div>
              <div className="job-readonly-field">
                <label>Reported issue</label>
                <p className="job-readonly-box job-readonly-box-sm">{claim.description || 'No description provided.'}</p>
              </div>
            </section>
          )}

          {claim.claim_photo_sas_url && (
            <section className="card job-card">
              <h2><FileText size={16} /> Uploaded document</h2>
              <div className="job-document-row">
                <div className="job-document-icon"><FileText size={20} /></div>
                <div className="job-document-info">
                  <strong>Original job photo</strong>
                  <span>Uploaded by {claim.created_by_name || 'a team member'} · {new Date(claim.created_at).toLocaleDateString()}</span>
                  <a href={claim.claim_photo_sas_url} target="_blank" rel="noreferrer" className="job-document-link">
                    View document <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </section>
          )}

          {isWorker && (
            <section className="card job-card">
              <h2><Phone size={16} /> Need to follow up?</h2>
              <p className="job-followup-hint">Get in touch with the customer or request additional parts if needed.</p>
              <div className="job-followup-actions">
                <button type="button" className="btn btn-secondary" onClick={toggleCustomerEdit}>
                  <Phone size={14} /> Update customer
                </button>
                <button type="button" className="btn btn-secondary" onClick={scrollToPurchases}>
                  <Package size={14} /> Additional parts
                </button>
              </div>
              {customerEditing && (
                <div className="job-customer-edit">
                  <label>Name</label>
                  <input value={customerForm.customer_name} onChange={(e) => setCustomerForm((f) => ({ ...f, customer_name: e.target.value }))} />
                  <label>Phone</label>
                  <input value={customerForm.customer_phone} onChange={(e) => setCustomerForm((f) => ({ ...f, customer_phone: e.target.value }))} />
                  <label>Address</label>
                  <input value={customerForm.job_address} onChange={(e) => setCustomerForm((f) => ({ ...f, job_address: e.target.value }))} />
                  <div className="job-reject-actions">
                    <button className="btn btn-secondary" onClick={() => setCustomerEditing(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSaveCustomer} disabled={savingCustomer}>{savingCustomer ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {!isWorker && (
            <section className="card job-card">
              <h2><FileText size={16} /> Invoice</h2>
              {!invoice ? (
                <div className="job-invoice-empty">
                  <FileText size={32} />
                  <strong>No invoice created</strong>
                  <p>Create an invoice to start billing this job.</p>
                  <button className="btn btn-primary" onClick={handleCreateInvoice} disabled={creatingInvoice}>
                    {creatingInvoice ? 'Starting...' : 'Generate invoice'}
                  </button>
                </div>
              ) : invoice.status === 'approved' ? (
                <div className="job-invoice-empty">
                  <FileText size={32} />
                  <strong>${total.toFixed(2)}</strong>
                  <p>Work approved — the customer invoice is ready.</p>
                  <button className="btn btn-primary" onClick={handleDownloadPdf} disabled={pdfLoading}>
                    {pdfLoading ? 'Loading...' : invoice.pdf_blob_url ? 'Download PDF' : 'Generate PDF'}
                  </button>
                </div>
              ) : (
                <div className="job-invoice-empty">
                  <FileText size={32} />
                  <strong>Not yet available</strong>
                  <p>Approve the work, then generate the customer invoice.</p>
                  <button className="btn btn-secondary" disabled>Generate invoice</button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {isWorker && invoice && workerEditable && (
        <div className="job-save-status">
          <span>Saved {timeAgo(invoice.updated_at)}</span>
          <span>Submit your work to the manager for review.</span>
        </div>
      )}
    </div>
  );
}
