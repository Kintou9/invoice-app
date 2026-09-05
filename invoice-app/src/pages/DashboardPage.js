import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { ClipboardList, FileText, CheckCircle, Clock, ChevronLeft, ChevronRight, Calendar, X, Plus } from 'lucide-react';
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

function fmtWeekRange(monday) {
  const sunday = addDays(monday, 6);
  return `${fmtMonthDay(monday)} – ${fmtMonthDay(sunday)}, ${sunday.getFullYear()}`;
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
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calOpen, setCalOpen] = useState(false);

  const isManager = user.role === 'manager' || user.role === 'admin';

  useEffect(() => {
    Promise.all([api.get('/claims'), api.get('/invoices')])
      .then(([c, i]) => {
        setClaims(c.data);
        setInvoices(i.data);
      })
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <p>Loading...</p>;

  const pendingApproval = invoices.filter((i) => i.status === 'submitted').length;
  const openClaims = claims.filter((c) => c.status === 'open' || c.status === 'in_progress').length;
  const approved = invoices.filter((i) => i.status === 'approved').length;
  const myDrafts = invoices.filter((i) => i.status === 'draft').length;

  const monday = weekDays[0];

  return (
    <div className="dashboard">
      {calOpen && (
        <CalendarModal
          claims={claims}
          isManager={isManager}
          onClose={() => setCalOpen(false)}
        />
      )}

      <div className="dashboard-top">
        <div>
          <h1>Welcome, {user.name}</h1>
          <p className="dashboard-subtitle">Here's your overview</p>
        </div>
        <button className="cal-open-btn" onClick={() => setCalOpen(true)}>
          <Calendar size={18} />
          <span>Calendar</span>
        </button>
      </div>

      {/* Week Schedule */}
      <div className="week-panel">
        <div className="week-nav">
          <button className="week-nav-btn" onClick={() => setWeekOffset((o) => o - 1)}>
            <ChevronLeft size={16} />
          </button>
          <span className="week-range">{fmtWeekRange(monday)}</span>
          <button className="week-nav-btn" onClick={() => setWeekOffset((o) => o + 1)}>
            <ChevronRight size={16} />
          </button>
          {weekOffset !== 0 && (
            <button className="week-today-btn" onClick={() => setWeekOffset(0)}>Today</button>
          )}
        </div>

        <div className="week-grid">
          {weekDays.map((day, idx) => {
            const isToday = day.toDateString() === today.toDateString();
            const dayClaims = claimsByDay[day.toDateString()] || [];
            return (
              <div key={idx} className={`week-day${isToday ? ' week-day-today' : ''}`}>
                <div className="week-day-header">
                  <span className="week-day-name">{DAY_NAMES[idx]}</span>
                  <span className={`week-day-date${isToday ? ' today-dot' : ''}`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="week-day-claims">
                  {dayClaims.length === 0 && <span className="week-empty">No jobs</span>}
                  {dayClaims.map((c) => (
                    <Link key={c.id} to={`/claims/${c.id}`} className={`week-claim-chip status-chip-${c.status}`}>
                      <span className="chip-number">{c.claim_number}</span>
                      <span className="chip-title">{c.type_brand || c.title || 'Service Call'}</span>
                      {c.assigned_to_name && <span className="chip-tech">{c.assigned_to_name}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-grid">
        <StatCard icon={ClipboardList} label="Open Claims" value={openClaims} color="blue" to="/claims" />
        <StatCard icon={Clock} label="Pending Approval" value={pendingApproval} color="orange" to="/invoices?status=submitted" />
        <StatCard icon={CheckCircle} label="Approved" value={approved} color="green" to="/invoices?status=approved" />
        <StatCard icon={FileText} label="Draft Invoices" value={myDrafts} color="gray" to="/invoices?status=draft" />
      </div>

      <div className="dashboard-sections">
        <section>
          <div className="section-header">
            <h2>Recent Claims</h2>
            <Link to="/claims" className="see-all">See all</Link>
          </div>
          <div className="claim-list">
            {claims.slice(0, 5).map((c) => (
              <Link key={c.id} to={`/claims/${c.id}`} className="claim-row">
                <span className="claim-number">{c.claim_number}</span>
                <span className="claim-title">{c.title}</span>
                <span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span>
                <span className="claim-assignee">{c.assigned_to_name || 'Unassigned'}</span>
              </Link>
            ))}
            {claims.length === 0 && <p className="empty-msg">No claims yet.</p>}
          </div>
        </section>

        {isManager && pendingApproval > 0 && (
          <section>
            <div className="section-header">
              <h2>Awaiting Your Review</h2>
              <Link to="/invoices?status=submitted" className="see-all">See all</Link>
            </div>
            <div className="claim-list">
              {invoices
                .filter((i) => i.status === 'submitted')
                .slice(0, 5)
                .map((inv) => (
                  <Link key={inv.id} to={`/invoices/${inv.id}`} className="claim-row">
                    <span className="claim-number">{inv.claim_number}</span>
                    <span className="claim-title">{inv.claim_title}</span>
                    <span className="claim-assignee">{inv.technician_name}</span>
                    <span className="status-badge status-submitted">Needs Review</span>
                  </Link>
                ))}
            </div>
          </section>
        )}
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
