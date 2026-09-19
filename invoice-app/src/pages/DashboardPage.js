import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Avatar from '../components/shared/Avatar';
import { eventLabel, eventDetails } from '../utils/activityLabels';
import {
  ClipboardList, FileText, CheckCircle, Clock, ChevronLeft, ChevronRight, X, Plus,
  AlertCircle, Camera, Edit3, MapPin, Wrench, AlertTriangle, ArrowRight,
} from 'lucide-react';
import './DashboardPage.css';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toLocalDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtMonthDay(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Calendar Modal ──────────────────────────────────────────────────────────
function CalendarModal({ claims, onClose, isManager }) {
  const navigate = useNavigate();
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(null);

  const claimsByDate = useMemo(() => {
    const map = {};
    claims.forEach((c) => {
      const ds = toLocalDate(c.date_of_service) || toLocalDate(c.created_at);
      if (!ds) return;
      const key = ds.toDateString();
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [claims]);

  const calDays = useMemo(() => {
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1; // Mon=0
    const days = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, m, d));
    return days;
  }, [month]);

  const prevMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  const selectedClaims = selected ? (claimsByDate[selected.toDateString()] || []) : [];

  const handleDayClick = (day) => {
    if (!day) return;
    setSelected((prev) => prev?.toDateString() === day.toDateString() ? null : day);
  };

  return (
    <div className="cal-overlay" onClick={onClose}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-header">
          <span className="cal-modal-title">Schedule Calendar</span>
          <button className="cal-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="cal-month-nav">
          <button className="week-nav-btn" onClick={prevMonth}><ChevronLeft size={15} /></button>
          <span className="cal-month-label">{MONTH_NAMES[month.getMonth()]} {month.getFullYear()}</span>
          <button className="week-nav-btn" onClick={nextMonth}><ChevronRight size={15} /></button>
        </div>

        <div className="cal-grid-header">
          {DAY_NAMES.map((d) => <span key={d} className="cal-grid-day-name">{d}</span>)}
        </div>

        <div className="cal-grid">
          {calDays.map((day, i) => {
            if (!day) return <div key={`blank-${i}`} className="cal-cell cal-cell-blank" />;
            const key = day.toDateString();
            const count = claimsByDate[key]?.length || 0;
            const isToday = key === today.toDateString();
            const isSel = selected?.toDateString() === key;
            return (
              <div
                key={key}
                className={`cal-cell${isToday ? ' cal-today' : ''}${isSel ? ' cal-selected' : ''}${count > 0 ? ' cal-has-claims' : ''}`}
                onClick={() => handleDayClick(day)}
              >
                <span className="cal-cell-num">{day.getDate()}</span>
                {count > 0 && (
                  <div className="cal-dots">
                    {Array.from({ length: Math.min(count, 3) }).map((_, di) => (
                      <span key={di} className="cal-dot" />
                    ))}
                    {count > 3 && <span className="cal-dot-more">+{count - 3}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected day panel */}
        {selected && (
          <div className="cal-day-panel">
            <div className="cal-day-panel-header">
              <span className="cal-day-panel-title">
                {selected.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              {isManager && (
                <button
                  className="cal-add-btn"
                  onClick={() => { onClose(); navigate('/claims'); }}
                >
                  <Plus size={13} /> Add Claim
                </button>
              )}
            </div>

            {selectedClaims.length === 0 ? (
              <p className="cal-day-empty">No claims scheduled for this day.</p>
            ) : (
              <div className="cal-day-claims">
                {selectedClaims.map((c) => (
                  <Link key={c.id} to={`/claims/${c.id}`} className="cal-day-claim-row" onClick={onClose}>
                    <span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span>
                    <span className="cal-claim-number">{c.claim_number}</span>
                    <span className="cal-claim-info">
                      {c.type_brand || c.title || 'Service Call'}
                      {c.assigned_to_name ? ` — ${c.assigned_to_name}` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main Dashboard ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const [selectedDayIdx, setSelectedDayIdx] = useState(null);

  const isManager = user.role === 'manager' || user.role === 'owner';

  useEffect(() => {
    const requests = [api.get('/claims'), api.get('/invoices')];
    if (isManager) requests.push(api.get('/audit-log?limit=5'));
    Promise.all(requests)
      .then(([c, i, a]) => {
        setClaims(c.data);
        setInvoices(i.data);
        if (a) setAuditEntries(a.data);
      })
      .finally(() => setLoading(false));
  }, [isManager]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekDays = useMemo(() => {
    const monday = addDays(getMonday(today), weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [today, weekOffset]);

  const claimsByDay = useMemo(() => {
    const map = {};
    weekDays.forEach((d) => { map[d.toDateString()] = []; });
    claims.forEach((c) => {
      const ds = toLocalDate(c.date_of_service) || toLocalDate(c.created_at);
      if (ds) {
        const key = ds.toDateString();
        if (map[key]) map[key].push(c);
      }
    });
    return map;
  }, [claims, weekDays]);

  // Default the "This week" selector to today (or day 0 of the visible
  // week once the user navigates to a different week).
  const activeDayIdx = selectedDayIdx ?? weekDays.findIndex((d) => d.toDateString() === today.toDateString());
  const activeDay = weekDays[activeDayIdx === -1 ? 0 : activeDayIdx];
  const activeDayClaims = claimsByDay[activeDay?.toDateString()] || [];

  if (loading) return <p>Loading...</p>;

  const pendingApproval = invoices.filter((i) => i.status === 'submitted').length;
  const openClaims = claims.filter((c) => c.status === 'open' || c.status === 'in_progress').length;
  const approvedThisMonth = invoices.filter((i) => {
    if (i.status !== 'approved' || !i.reviewed_at) return false;
    const d = new Date(i.reviewed_at);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  }).length;
  const unassignedClaims = claims.filter((c) => !c.assigned_to);
  const needsApprovalInvoices = invoices.filter((i) => i.status === 'submitted');

  if (!isManager) {
    // Worker dashboard — "Ready for your next job?" redesign.
    const activeJob = claims.find((c) => c.status === 'in_progress');
    const upcoming = claims
      .filter((c) => c.id !== activeJob?.id && (c.status === 'open' || c.status === 'in_progress'))
      .sort((a, b) => new Date(a.date_of_service || a.created_at) - new Date(b.date_of_service || b.created_at));
    const nextScheduled = upcoming[0];
    const rejectedInvoices = invoices.filter((i) => i.status === 'rejected');
    const isToday = activeDay?.toDateString() === today.toDateString();
    const awaitingReview = pendingApproval;
    const needsChanges = rejectedInvoices.length;
    const weekMonday = weekDays[0];
    const weekSunday = weekDays[6];
    const weekRange = weekMonday && weekSunday
      ? `${fmtMonthDay(weekMonday)} – ${fmtMonthDay(weekSunday)}, ${weekSunday.getFullYear()}`
      : '';

    return (
      <div className="dashboard worker-dashboard">
        {calOpen && <CalendarModal claims={claims} isManager={false} onClose={() => setCalOpen(false)} />}

        <div className="dashboard-top">
          <div>
            <h1>Ready for your next job?</h1>
            <p className="dashboard-subtitle">{today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        <section className="worker-week-card">
          <div className="worker-week-header">
            <span className="worker-week-title"><strong>This week,</strong> {weekRange}</span>
            <div className="worker-week-header-actions">
              <button className="week-nav-btn" onClick={() => { setWeekOffset((o) => o - 1); setSelectedDayIdx(null); }}><ChevronLeft size={16} /></button>
              <button className="week-nav-btn" onClick={() => { setWeekOffset((o) => o + 1); setSelectedDayIdx(null); }}><ChevronRight size={16} /></button>
              <button className="week-view-full-link" onClick={() => setCalOpen(true)}>View full schedule <ArrowRight size={14} /></button>
            </div>
          </div>

          <div className="week-day-selector worker-day-selector">
            {weekDays.map((day, idx) => {
              const isTodayCol = day.toDateString() === today.toDateString();
              const isActive = idx === (activeDayIdx === -1 ? 0 : activeDayIdx);
              return (
                <button
                  key={idx}
                  className={`week-day-pill ${isActive ? 'active' : ''} ${isTodayCol ? 'is-today' : ''}`}
                  onClick={() => setSelectedDayIdx(idx)}
                >
                  <span className="week-day-pill-name">{DAY_NAMES[idx]}</span>
                  <span className="week-day-pill-date">{day.getDate()}</span>
                  <span className="week-day-pill-month">{MONTH_NAMES[day.getMonth()].slice(0, 3)}</span>
                </button>
              );
            })}
          </div>

          <p className="worker-schedule-day-title">
            {activeDay?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>

          {activeDayClaims.length === 0 ? (
            <p className="empty-msg">No jobs scheduled{isToday ? ' today' : ''}.</p>
          ) : (
            <div className="schedule-list">
              {activeDayClaims.map((c) => {
                const inProgress = c.status === 'in_progress';
                return (
                  <div key={c.id} className="schedule-row">
                    <span className="schedule-row-customer">{c.customer_name || c.title}</span>
                    <span className="schedule-row-detail"><Wrench size={13} /> {c.type_brand || c.title || 'Service Call'}</span>
                    <span className="schedule-row-number">{c.claim_number}</span>
                    <span className={`schedule-row-status ${inProgress ? 'in-progress' : ''}`}>
                      <span className="schedule-row-dot" />
                      {inProgress ? 'In progress' : 'Scheduled'}
                    </span>
                    <Link to={`/claims/${c.id}`} className="btn btn-sm btn-secondary">View job</Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="worker-bottom-layout">
          <div className="worker-bottom-left">
            <section className="active-job-card">
              {activeJob ? (
                <>
                  <div className="active-job-top">
                    <div>
                      <span className="active-job-status"><span className="active-job-dot" /> In progress</span>
                      <h2>{activeJob.customer_name || activeJob.title}</h2>
                      <p className="active-job-number">{activeJob.claim_number}</p>
                      <p className="active-job-detail"><Wrench size={14} /> {activeJob.type_brand || activeJob.title || 'Service Call'}</p>
                      {activeJob.job_address && <p className="active-job-detail"><MapPin size={14} /> {activeJob.job_address}</p>}
                    </div>
                    {nextScheduled && (
                      <div className="active-job-next">
                        <span className="active-job-next-label"><Clock size={13} /> Next scheduled</span>
                        <span className="active-job-next-customer">{nextScheduled.customer_name || nextScheduled.title}</span>
                        <span className="active-job-next-sub">{nextScheduled.type_brand || nextScheduled.title || 'Service Call'}</span>
                      </div>
                    )}
                  </div>
                  <div className="active-job-actions">
                    <Link to={`/claims/${activeJob.id}`} className="btn btn-primary">Open job <ArrowRight size={15} /></Link>
                    <Link to={`/claims/${activeJob.id}`} className="btn btn-secondary"><Camera size={15} /> Add photos</Link>
                  </div>
                </>
              ) : nextScheduled ? (
                <>
                  <div className="active-job-top">
                    <div>
                      <span className="active-job-status active-job-status-upcoming">Next up</span>
                      <h2>{nextScheduled.customer_name || nextScheduled.title}</h2>
                      <p className="active-job-number">{nextScheduled.claim_number}</p>
                      <p className="active-job-detail"><Wrench size={14} /> {nextScheduled.type_brand || nextScheduled.title || 'Service Call'}</p>
                      {nextScheduled.job_address && <p className="active-job-detail"><MapPin size={14} /> {nextScheduled.job_address}</p>}
                    </div>
                  </div>
                  <div className="active-job-actions">
                    <Link to={`/claims/${nextScheduled.id}`} className="btn btn-primary">Open job <ArrowRight size={15} /></Link>
                  </div>
                </>
              ) : (
                <p className="empty-msg">No active or upcoming jobs — check My Claims for anything unassigned.</p>
              )}
            </section>

            <section className="submissions-card submissions-card-horizontal">
              <div className="attention-header">
                <h3>My submissions</h3>
                <Link to="/invoices" className="worker-week-view-full-link">View submissions <ArrowRight size={14} /></Link>
              </div>
              <div className="submissions-row-group">
                <Link to="/invoices?status=submitted" className="submissions-row">
                  <span className="submissions-icon"><FileText size={18} /></span>
                  <span className="submissions-info">
                    <strong>{awaitingReview}</strong>
                    <span>Awaiting review</span>
                    <small>Submitted and in review.</small>
                  </span>
                </Link>
                <Link to="/invoices?status=rejected" className="submissions-row">
                  <span className="submissions-icon submissions-icon-warning"><FileText size={18} /></span>
                  <span className="submissions-info">
                    <strong>{needsChanges}</strong>
                    <span>Needs changes</span>
                    <small>Action required to resubmit.</small>
                  </span>
                </Link>
              </div>
            </section>
          </div>

          <section className="attention-card">
            <div className="attention-header">
              <h3>Needs your attention</h3>
              <span className="queue-count">{rejectedInvoices.length} item{rejectedInvoices.length === 1 ? '' : 's'}</span>
            </div>
            {rejectedInvoices.length === 0 ? (
              <p className="empty-msg">Nothing needs changes right now.</p>
            ) : (
              rejectedInvoices.slice(0, 4).map((inv) => (
                <div key={inv.id} className="attention-item">
                  <AlertTriangle size={18} className="attention-icon" />
                  <div className="attention-item-body">
                    <span className="attention-item-title">{inv.claim_number}</span>
                    <strong>Needs changes</strong>
                    <p>{inv.manager_notes || 'A manager sent this back — review and resubmit.'}</p>
                  </div>
                  <Link to={`/invoices/${inv.id}`} className="btn btn-sm btn-primary">Fix &amp; resubmit</Link>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    );
  }

  // Owner/manager dashboard — "Team workspace" redesign.
  const statCards = [
    { icon: Clock, label: 'Review', value: pendingApproval, color: 'orange', to: '/invoices?status=submitted' },
    { icon: AlertCircle, label: 'Assign', value: unassignedClaims.length, color: 'orange', to: '/claims?worker=unassigned' },
    { icon: ClipboardList, label: 'Open', value: openClaims, color: 'blue', to: '/claims?status=open' },
    { icon: CheckCircle, label: 'Approved this month', value: approvedThisMonth, color: 'green', to: '/invoices?status=approved' },
  ];

  return (
    <div className="dashboard team-workspace">
      {calOpen && <CalendarModal claims={claims} isManager onClose={() => setCalOpen(false)} />}

      <div className="dashboard-top">
        <div>
          <h1>Team workspace</h1>
          <p className="dashboard-subtitle">{today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="dashboard-top-actions">
          <Link to="/claims?new=1&mode=manual" className="btn btn-primary"><Plus size={16} /> New job</Link>
          <Link to="/claims" className="btn btn-secondary"><Plus size={16} /> New invoice</Link>
        </div>
      </div>

      <div className="stat-grid">
        {statCards.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="workspace-layout">
        <div className="work-queue">
          <span className="work-queue-eyebrow">Work Queue</span>

          <section className="queue-section">
            <h2>Needs approval <span className="queue-count">({needsApprovalInvoices.length})</span></h2>
            {needsApprovalInvoices.length === 0 ? <p className="empty-msg">Nothing waiting on your review.</p> : (
              <div className="queue-table-wrap">
                <table className="queue-table">
                  <thead>
                    <tr><th>Customer</th><th>Job #</th><th>Service date</th><th>Amount</th><th>Assignee</th><th></th></tr>
                  </thead>
                  <tbody>
                    {needsApprovalInvoices.slice(0, 5).map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.customer_name || inv.claim_title}</td>
                        <td>{inv.claim_number}</td>
                        <td>{inv.date_of_service ? new Date(inv.date_of_service).toLocaleDateString() : '—'}</td>
                        <td>${Number(inv.invoice_total || 0).toFixed(2)}</td>
                        <td>{inv.technician_name || '—'}</td>
                        <td><Link to={`/invoices/${inv.id}`} className="btn btn-sm btn-primary">Review</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="queue-section">
            <h2>Needs assignee <span className="queue-count">({unassignedClaims.length})</span></h2>
            {unassignedClaims.length === 0 ? <p className="empty-msg">Every open claim has a worker assigned.</p> : (
              <div className="queue-table-wrap">
                <table className="queue-table">
                  <thead>
                    <tr><th>Customer</th><th>Job #</th><th>Service date</th><th>Amount</th><th>Assignee</th><th></th></tr>
                  </thead>
                  <tbody>
                    {unassignedClaims.slice(0, 5).map((c) => (
                      <tr key={c.id}>
                        <td>{c.customer_name || c.title}</td>
                        <td>{c.claim_number}</td>
                        <td>{c.date_of_service ? new Date(c.date_of_service).toLocaleDateString() : '—'}</td>
                        <td>—</td>
                        <td>—</td>
                        <td><Link to={`/claims/${c.id}`} className="btn btn-sm btn-primary">Assign</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="queue-section">
            <h2>Recent activity <span className="queue-count">({auditEntries.length})</span></h2>
            {auditEntries.length === 0 ? <p className="empty-msg">No recent activity.</p> : (
              <div className="queue-table-wrap">
                <table className="queue-table">
                  <thead>
                    <tr><th>Time</th><th>Event</th><th>Details</th><th>User</th></tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
                        <td>{eventLabel(entry)}</td>
                        <td className="queue-table-details">{eventDetails(entry)}</td>
                        <td>{entry.performed_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="workspace-sidebar">
          <div className="week-card">
            <div className="week-card-header">
              <h3>This week</h3>
              <div className="week-card-nav">
                <button className="week-nav-btn" onClick={() => { setWeekOffset((o) => o - 1); setSelectedDayIdx(null); }}><ChevronLeft size={15} /></button>
                <button className="week-nav-btn" onClick={() => { setWeekOffset((o) => o + 1); setSelectedDayIdx(null); }}><ChevronRight size={15} /></button>
              </div>
            </div>
            <div className="week-day-selector">
              {weekDays.map((day, idx) => {
                const isToday = day.toDateString() === today.toDateString();
                const isActive = idx === (activeDayIdx === -1 ? 0 : activeDayIdx);
                return (
                  <button
                    key={idx}
                    className={`week-day-pill ${isActive ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
                    onClick={() => setSelectedDayIdx(idx)}
                  >
                    <span className="week-day-pill-name">{DAY_NAMES[idx]}</span>
                    <span className="week-day-pill-date">{day.getDate()}</span>
                  </button>
                );
              })}
            </div>
            <div className="week-day-agenda">
              <p className="week-day-agenda-title">
                {activeDay?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              {activeDayClaims.length === 0 ? (
                <p className="empty-msg">No jobs scheduled.</p>
              ) : (
                activeDayClaims.map((c) => (
                  <Link key={c.id} to={`/claims/${c.id}`} className="week-agenda-item">
                    <div>
                      <span className="week-agenda-title">{c.customer_name || c.title}</span>
                      <span className="week-agenda-sub">{c.type_brand || c.title || 'Service Call'}</span>
                    </div>
                    {c.assigned_to_name && <Avatar src={c.assigned_to_avatar_url} name={c.assigned_to_name} size="xs" className="week-agenda-avatar" />}
                  </Link>
                ))
              )}
            </div>
            <button className="week-view-full" onClick={() => setCalOpen(true)}>View full schedule →</button>
          </div>

          <div className="create-claim-card">
            <h3>Create a claim</h3>
            <p>Document damage, service, or materials and create a claim in minutes.</p>
            <div className="create-claim-tiles">
              <Link to="/claims?new=1&mode=photo" className="create-claim-tile">
                <Camera size={18} />
                <span>From photo</span>
                <small>Upload and extract details</small>
              </Link>
              <Link to="/claims?new=1&mode=manual" className="create-claim-tile">
                <Edit3 size={18} />
                <span>Enter manually</span>
                <small>Fill in claim details</small>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, to }) {
  return (
    <Link to={to} className={`stat-card stat-${color}`}>
      <Icon size={28} />
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </Link>
  );
}
