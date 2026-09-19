import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getBillingStatus, BILLING_STATUS, isOverdue } from '../utils/billingStatus';
import { PAYMENT_METHOD_LABELS } from '../components/invoices/LineItemsSection';
import { eventLabel, eventDetails } from '../utils/activityLabels';
import {
  Search, Filter, Download, ChevronDown, FileText, Clock, CheckCircle2,
  ArrowUpDown, ArrowLeft, X, ExternalLink, RefreshCw,
} from 'lucide-react';
import './InvoicesPage.css';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'needs_approval', label: 'Needs approval' },
  { key: 'ready_to_send', label: 'Ready to send' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid', label: 'Paid' },
];

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

const SORTERS = {
  total: (inv) => Number(inv.invoice_total) || 0,
  balance_due: (inv) => (Number(inv.invoice_total) || 0) - (Number(inv.amount_paid) || 0),
  status: (inv) => getBillingStatus(inv),
  due: (inv) => (inv.due_date ? new Date(inv.due_date).getTime() : Infinity),
};

function fmtMoney(n) { return `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }

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

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const newMenuRef = useRef(null);
  const filtersRef = useRef(null);
  const isManager = user.role !== 'worker';

  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({ outstanding: 0, overdue: 0, paid_this_month: 0 });
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [sortBy, setSortBy] = useState('due');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [panelTab, setPanelTab] = useState('pdf');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'card', notes: '' });
  const [savingPayment, setSavingPayment] = useState(false);

  const load = () => {
    const calls = [api.get('/invoices')];
    if (isManager) calls.push(api.get('/invoices/stats'));
    Promise.all(calls).then(([invRes, statsRes]) => {
      setInvoices(invRes.data);
      if (statsRes) setStats(statsRes.data);
    }).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target)) setNewMenuOpen(false);
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadSelected = (id) => {
    setSelectedLoading(true);
    api.get(`/invoices/${id}`).then((r) => setSelected(r.data)).finally(() => setSelectedLoading(false));
  };

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    loadSelected(selectedId);
    setPanelTab('pdf');
    setPdfUrl(null);
    setRecordingPayment(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (panelTab === 'activity' && selectedId) {
      setActivityLoading(true);
      api.get(`/audit-log?entity_type=invoice&entity_id=${selectedId}&limit=20`)
        .then((r) => setActivity(r.data))
        .catch(() => setActivity([]))
        .finally(() => setActivityLoading(false));
    }
    if (panelTab === 'pdf' && selected?.pdf_blob_url && !pdfUrl) {
      setPdfLoading(true);
      api.get(`/invoices/${selectedId}/pdf`).then((r) => setPdfUrl(r.data.pdf_url)).finally(() => setPdfLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelTab, selected]);

  // ---- derived data ----
  const withStatus = useMemo(() => invoices.map((inv) => ({ ...inv, billingStatus: getBillingStatus(inv) })), [invoices]);

  const counts = useMemo(() => {
    const c = { all: withStatus.length, draft: 0, needs_approval: 0, ready_to_send: 0, unpaid: 0, paid: 0 };
    withStatus.forEach((inv) => { c[BILLING_STATUS[inv.billingStatus].tab]++; });
    return c;
  }, [withStatus]);

  const filtered = useMemo(() => {
    let list = withStatus;
    if (tab !== 'all') list = list.filter((inv) => BILLING_STATUS[inv.billingStatus].tab === tab);
    if (overdueOnly) list = list.filter((inv) => isOverdue(inv));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((inv) => inv.claim_number?.toLowerCase().includes(q) || inv.customer_name?.toLowerCase().includes(q));
    }
    const sorter = SORTERS[sortBy];
    const sorted = [...list].sort((a, b) => {
      const av = sorter(a), bv = sorter(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [withStatus, tab, overdueOnly, search, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageClamped = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageClamped - 1) * perPage, pageClamped * perPage);

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  };

  const handleExport = () => {
    const header = ['Invoice', 'Customer', 'Total', 'Balance due', 'Status', 'Due'];
    const rows = filtered.map((inv) => [
      inv.claim_number, inv.customer_name || '',
      (Number(inv.invoice_total) || 0).toFixed(2),
      ((Number(inv.invoice_total) || 0) - (Number(inv.amount_paid) || 0)).toFixed(2),
      BILLING_STATUS[inv.billingStatus].label,
      inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '',
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGeneratePdf = async () => {
    setPdfLoading(true);
    try {
      const res = await api.post(`/invoices/${selectedId}/generate-pdf`);
      setPdfUrl(res.data.pdf_url);
      loadSelected(selectedId);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleRecordPayment = async () => {
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    setSavingPayment(true);
    try {
      await api.post(`/invoices/${selectedId}/payments`, {
        amount, method: paymentForm.method, notes: paymentForm.notes || undefined,
      });
      toast.success('Payment recorded');
      setPaymentForm({ amount: '', method: 'card', notes: '' });
      setRecordingPayment(false);
      loadSelected(selectedId);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not record payment');
    } finally {
      setSavingPayment(false);
    }
  };

  const closePanel = () => setSelectedId(null);

  if (loading) return <p>Loading...</p>;

  const balanceDue = selected ? (Number(selected.invoice_total) || 0) - (Number(selected.amount_paid) || 0) : 0;
  const selectedStatus = selected ? getBillingStatus(selected) : null;

  return (
    <div className="inv-page">
      <div className="inv-header">
        <div>
          <h1>Invoices</h1>
          <p className="inv-subtitle">Review, send and track payment.</p>
        </div>
        <div className="inv-header-actions">
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={15} /> Export
          </button>
          {isManager && (
            <div className="inv-new-menu" ref={newMenuRef}>
              <button className="btn btn-primary" onClick={() => setNewMenuOpen((o) => !o)}>
                + New invoice <ChevronDown size={14} />
              </button>
              {newMenuOpen && (
                <div className="inv-new-menu-dropdown">
                  <button onClick={() => navigate('/claims?new=1&mode=photo')}>From a photo</button>
                  <button onClick={() => navigate('/claims?new=1&mode=manual')}>Enter manually</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isManager && (
        <div className="inv-stats-row">
          <div className="inv-stat-card">
            <span className="inv-stat-icon"><FileText size={18} /></span>
            <div>
              <span className="inv-stat-label">Outstanding</span>
              <strong className="inv-stat-value">{fmtMoney(stats.outstanding)}</strong>
            </div>
          </div>
          <div className="inv-stat-card">
            <span className="inv-stat-icon inv-stat-icon-warn"><Clock size={18} /></span>
            <div>
              <span className="inv-stat-label">Overdue</span>
              <strong className="inv-stat-value">{fmtMoney(stats.overdue)}</strong>
              <span className="inv-stat-sub">Included in outstanding</span>
            </div>
          </div>
          <div className="inv-stat-card">
            <span className="inv-stat-icon inv-stat-icon-ok"><CheckCircle2 size={18} /></span>
            <div>
              <span className="inv-stat-label">Paid this month</span>
              <strong className="inv-stat-value">{fmtMoney(stats.paid_this_month)}</strong>
            </div>
          </div>
        </div>
      )}

      <div className={`inv-body ${selectedId ? 'inv-body-split' : ''}`}>
        <div className="inv-list-col">
          <div className="inv-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); setPage(1); }}>
                {t.label} ({counts[t.key]})
              </button>
            ))}
          </div>

          <div className="inv-toolbar">
            <div className="inv-search">
              <Search size={15} />
              <input placeholder="Search invoice or customer..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="inv-filters-wrap" ref={filtersRef}>
              <button className="btn btn-secondary" onClick={() => setFiltersOpen((o) => !o)}>
                <Filter size={14} /> Filters
              </button>
              {filtersOpen && (
                <div className="inv-filters-pop">
                  <label className="inv-filter-checkbox">
                    <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }} />
                    Overdue only
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Invoice / bill to</th>
                  <th className="sortable" onClick={() => toggleSort('total')}>Total <ArrowUpDown size={12} /></th>
                  <th className="sortable" onClick={() => toggleSort('balance_due')}>Balance due <ArrowUpDown size={12} /></th>
                  <th className="sortable" onClick={() => toggleSort('status')}>Status <ArrowUpDown size={12} /></th>
                  <th className="sortable" onClick={() => toggleSort('due')}>Due <ArrowUpDown size={12} /></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((inv) => {
                  const meta = BILLING_STATUS[inv.billingStatus];
                  const bal = (Number(inv.invoice_total) || 0) - (Number(inv.amount_paid) || 0);
                  return (
                    <tr key={inv.id} className={inv.id === selectedId ? 'inv-row-active' : ''} onClick={() => setSelectedId(inv.id)}>
                      <td>
                        <strong>{inv.claim_number}</strong>
                        <div className="inv-row-sub">{inv.customer_name || '—'}</div>
                      </td>
                      <td>{fmtMoney(inv.invoice_total)}</td>
                      <td>{fmtMoney(bal)}</td>
                      <td><span className={`status-badge status-${inv.billingStatus}`}>{meta.label}</span></td>
                      <td>{fmtDate(inv.due_date)}</td>
                    </tr>
                  );
                })}
                {pageItems.length === 0 && (
                  <tr><td colSpan={5} className="empty-cell">No invoices found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="inv-pagination">
            <span className="inv-pagination-count">{filtered.length} invoice{filtered.length === 1 ? '' : 's'}</span>
            <div className="inv-pagination-pages">
              <button className="btn btn-sm btn-secondary" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}>Previous</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                <button key={p} className={`inv-page-btn ${p === pageClamped ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn btn-sm btn-secondary" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}>Next</button>
            </div>
            <select className="inv-per-page" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
          </div>
        </div>

        {selectedId && (
          <div className="inv-panel">
            <div className="inv-panel-header">
              <button className="inv-back-btn" onClick={closePanel}><ArrowLeft size={16} /> Back</button>
              <strong className="inv-panel-title">{selected?.claim_number || '...'}</strong>
              {selected && (
                <Link className="inv-open-full" to={`/claims/${selected.claim_id}`}>
                  Open full view <ExternalLink size={13} />
                </Link>
              )}
              <button className="inv-close-btn" onClick={closePanel} aria-label="Close"><X size={18} /></button>
            </div>

            {selectedLoading || !selected ? <p className="inv-panel-loading">Loading...</p> : (
              <>
                <div className="inv-panel-customer">
                  <div>
                    <span className="inv-panel-label">Customer</span>
                    <strong>{selected.customer_name || '—'}</strong>
                    <Link className="inv-panel-claim-link" to={`/claims/${selected.claim_id}`}>{selected.claim_number}</Link>
                  </div>
                  <span className="inv-panel-due">{selected.due_date ? `Due ${fmtDate(selected.due_date)}` : 'Not yet issued'}</span>
                </div>

                <div className="inv-panel-totals">
                  <div><span>Invoice total</span><strong>{fmtMoney(selected.invoice_total)}</strong></div>
                  <div><span>Paid</span><strong>{fmtMoney(selected.amount_paid)}</strong></div>
                  <div><span>Balance due</span><strong>{fmtMoney(balanceDue)}</strong></div>
                </div>

                <div className="inv-panel-tabs">
                  <button className={panelTab === 'pdf' ? 'active' : ''} onClick={() => setPanelTab('pdf')}>PDF preview</button>
                  <button className={panelTab === 'payments' ? 'active' : ''} onClick={() => setPanelTab('payments')}>
                    Payments ({selected.payments?.length || 0})
                  </button>
                  <button className={panelTab === 'activity' ? 'active' : ''} onClick={() => setPanelTab('activity')}>Activity</button>
                </div>

                {panelTab === 'pdf' && (
                  <div className="inv-panel-pdf">
                    {selected.pdf_blob_url ? (
                      pdfLoading || !pdfUrl ? <p className="inv-panel-loading">Loading preview...</p> : (
                        <iframe title="Invoice PDF" src={pdfUrl} className="inv-pdf-frame" />
                      )
                    ) : selectedStatus === 'ready_to_send' ? (
                      <div className="inv-pdf-empty">
                        <FileText size={32} />
                        <strong>Not generated yet</strong>
                        <p>Generate the PDF to issue this invoice and start the payment clock.</p>
                        <button className="btn btn-primary" onClick={handleGeneratePdf} disabled={pdfLoading}>
                          {pdfLoading ? 'Generating...' : 'Generate PDF'}
                        </button>
                      </div>
                    ) : (
                      <div className="inv-pdf-empty">
                        <FileText size={32} />
                        <strong>Not available yet</strong>
                        <p>{selectedStatus === 'draft' || selectedStatus === 'rejected' ? 'The technician still needs to submit this invoice for approval.' : 'This invoice needs manager approval first.'}</p>
                      </div>
                    )}
                  </div>
                )}

                {panelTab === 'payments' && (
                  <div className="inv-panel-payments">
                    {(selected.payments || []).length === 0 && <p className="empty-msg">No payments recorded yet.</p>}
                    {(selected.payments || []).map((p) => (
                      <div key={p.id} className="inv-payment-row">
                        <div>
                          <strong>{fmtMoney(p.amount)}</strong>
                          <span className="inv-payment-meta">{PAYMENT_METHOD_LABELS[p.method] || 'Other'} · {p.recorded_by_name || 'Team member'}</span>
                        </div>
                        <span className="inv-payment-date">{fmtDate(p.recorded_at)}</span>
                      </div>
                    ))}

                    {isManager && selected.status === 'approved' && balanceDue > 0.005 && (
                      recordingPayment ? (
                        <div className="inv-payment-form">
                          <div className="inv-payment-form-row">
                            <label>
                              Amount
                              <input type="number" min="0.01" step="0.01" max={balanceDue} value={paymentForm.amount}
                                onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} placeholder={balanceDue.toFixed(2)} />
                            </label>
                            <label>
                              Method
                              <select value={paymentForm.method} onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                                <option value="check">Check</option>
                                <option value="other">Other</option>
                              </select>
                            </label>
                          </div>
                          <input className="inv-payment-notes" placeholder="Notes (optional)" value={paymentForm.notes}
                            onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
                          <div className="inv-payment-form-actions">
                            <button className="btn btn-secondary" onClick={() => setRecordingPayment(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleRecordPayment} disabled={savingPayment}>
                              {savingPayment ? 'Saving...' : 'Save payment'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-primary inv-record-payment-btn" onClick={() => { setRecordingPayment(true); setPaymentForm((f) => ({ ...f, amount: balanceDue.toFixed(2) })); }}>
                          Record payment
                        </button>
                      )
                    )}
                  </div>
                )}

                {panelTab === 'activity' && (
                  <div className="inv-panel-activity">
                    {activityLoading ? <p className="inv-panel-loading">Loading...</p> : activity.length === 0 ? (
                      <p className="empty-msg">No activity recorded yet.</p>
                    ) : activity.map((entry) => (
                      <div key={entry.id} className="inv-activity-row">
                        <div>
                          <strong>{eventLabel(entry)}</strong>
                          {eventDetails(entry) && <span className="inv-activity-details">{eventDetails(entry)}</span>}
                        </div>
                        <span className="inv-activity-time">{timeAgo(entry.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="inv-panel-footer">
                  {selected.pdf_blob_url && (
                    <a className="btn btn-secondary" href={pdfUrl || '#'} target="_blank" rel="noreferrer" onClick={(e) => !pdfUrl && e.preventDefault()}>
                      {pdfUrl ? 'Download PDF' : <RefreshCw size={14} className="spin" />}
                    </a>
                  )}
                  {isManager && selected.status === 'approved' && balanceDue > 0.005 && !recordingPayment && panelTab !== 'payments' && (
                    <button className="btn btn-primary" onClick={() => { setPanelTab('payments'); setRecordingPayment(true); setPaymentForm((f) => ({ ...f, amount: balanceDue.toFixed(2) })); }}>
                      Record payment
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
