import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  FileText, Package, Zap, Camera, Wrench, CalendarDays, ShieldCheck,
  UserPlus, Send, ArrowRight,
} from 'lucide-react';
import './LandingPage.css';

const FEATURES = [
  {
    icon: Camera,
    title: 'AI Claim Photo Extraction',
    desc: 'Upload a service form photo and Claude instantly reads the customer info, appliance details, and job address — no manual entry.',
  },
  {
    icon: Zap,
    title: 'Auto-Populated Invoices',
    desc: 'Claims flow directly into invoices. Model number, serial number, and service description are pre-filled so technicians can focus on the job.',
  },
  {
    icon: Package,
    title: 'Parts & Purchases',
    desc: 'Track what you spent on parts for every job — supplier, cost, tracking — and bill the customer at whatever markup you set.',
  },
  {
    icon: CalendarDays,
    title: 'Weekly Schedule View',
    desc: 'See every job plotted on a Monday–Sunday calendar. Managers assign claims, technicians see their day — no more spreadsheets.',
  },
  {
    icon: FileText,
    title: 'Manager Review Workflow',
    desc: 'Technicians submit invoices for review. Managers approve or reject with notes, keeping every job accountable and audit-ready.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure & Cloud-Based',
    desc: 'Role-based access for owners, managers, and workers, full audit trail on every claim and invoice, and rate-limited, encrypted infrastructure.',
  },
];

const ICON_TINTS = ['tint-sage', 'tint-blue', 'tint-mint'];

const STEPS = [
  {
    icon: UserPlus,
    title: 'Create a Claim',
    desc: 'Log the customer, equipment, and job details — or snap a photo and let AI fill it in.',
  },
  {
    icon: Wrench,
    title: 'Do the Job',
    desc: 'Technician completes the work, adds parts, and fills out the invoice on-site.',
  },
  {
    icon: Send,
    title: 'Submit & Get Paid',
    desc: 'Manager reviews and approves, then the invoice is ready to send.',
  },
];

const ACTIVITY = [
  { claim: 'SVC-20260910-482', desc: 'Refrigerator repair', status: 'Approved', tone: 'approved' },
  { claim: 'SVC-20260909-217', desc: 'HVAC service call', status: 'In progress', tone: 'progress' },
  { claim: 'SVC-20260909-104', desc: 'Washer replacement', status: 'Invoice sent', tone: 'sent' },
  { claim: 'SVC-20260908-963', desc: 'Dishwasher install', status: 'Parts ordered', tone: 'ordered' },
];

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="landing">
      {/* Nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="landing-logo-mark" aria-hidden="true" />
            <span>Trackly</span>
          </div>
          <nav className="landing-nav-links">
            <a href="#features" onClick={scrollTo('features')}>Features</a>
            <a href="#how-it-works" onClick={scrollTo('how-it-works')}>Solutions</a>
          </nav>
          <button className="landing-demo-btn" onClick={() => navigate('/register')}>
            Book Demo
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow">Built for service businesses</div>
            <h1 className="landing-title">
              From claim to invoice,<br />all in one place.
            </h1>
            <p className="landing-subtitle">
              Trackly helps service businesses manage claims, parts, invoices, and approvals — so you can spend less time on admin and more time on what you do best.
            </p>
            <div className="landing-cta-row">
              <button className="landing-btn-primary" onClick={() => navigate('/register')}>
                Start Free <ArrowRight size={16} />
              </button>
              <button className="landing-btn-secondary" onClick={() => navigate('/register')}>
                Book Demo
              </button>
            </div>
            <p className="landing-cta-note">No credit card required&nbsp;&nbsp;|&nbsp;&nbsp;Set up in minutes</p>
            <span className="landing-script landing-script-left">Organize, grow, move forward</span>
          </div>

          <div className="landing-hero-visual">
            <div className="landing-preview-card">
              <div className="landing-preview-sidebar">
                <div className="landing-preview-brand">
                  <span className="landing-logo-mark landing-logo-mark-sm" aria-hidden="true" />
                  <span>Trackly</span>
                </div>
                <div className="landing-preview-nav">
                  <span className="active">Dashboard</span>
                  <span>Claims</span>
                  <span>Invoices</span>
                  <span>Parts &amp; Purchases</span>
                  <span>Users</span>
                </div>
              </div>
              <div className="landing-preview-main">
                <div className="landing-preview-topbar">
                  <div className="landing-preview-search">Search…</div>
                  <div className="landing-preview-avatar">AS</div>
                </div>
                <p className="landing-preview-greeting">Good morning, Alex</p>
                <p className="landing-preview-subgreeting">Here's what's happening with your business.</p>
                <div className="landing-preview-stats">
                  <div className="landing-preview-stat">
                    <span className="stat-label">Open Claims</span>
                    <span className="stat-value">12</span>
                  </div>
                  <div className="landing-preview-stat">
                    <span className="stat-label">Invoices Sent</span>
                    <span className="stat-value">28</span>
                  </div>
                  <div className="landing-preview-stat stat-mint">
                    <span className="stat-label">Approved</span>
                    <span className="stat-value">9</span>
                  </div>
                </div>
                <div className="landing-preview-activity">
                  <div className="landing-preview-activity-header">Recent Activity</div>
                  {ACTIVITY.map((a) => (
                    <div key={a.claim} className="landing-preview-activity-row">
                      <FileText size={14} />
                      <span className="activity-claim">{a.claim}</span>
                      <span className="activity-desc">{a.desc}</span>
                      <span className={`activity-badge badge-${a.tone}`}>{a.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <span className="landing-script landing-script-right">Less admin.<br />More progress.</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features" id="features">
        <div className="landing-features-inner">
          <div className="landing-eyebrow landing-eyebrow-center">A simpler way to run your business</div>
          <h2 className="landing-section-title">Everything you need, without the complexity.</h2>
          <div className="landing-feature-grid">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="landing-feature-card">
                <div className={`landing-feature-icon ${ICON_TINTS[i % ICON_TINTS.length]}`}>
                  <Icon size={22} />
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-how" id="how-it-works">
        <div className="landing-how-inner">
          <div className="landing-eyebrow landing-eyebrow-center">Get started in minutes</div>
          <h2 className="landing-section-title">How Trackly works</h2>
          <div className="landing-steps">
            {STEPS.map(({ icon: Icon, title, desc }, i) => (
              <div className="landing-step" key={title}>
                <div className="landing-step-icon-wrap">
                  <span className="landing-step-number">{i + 1}</span>
                  <div className="landing-step-icon">
                    <Icon size={26} />
                  </div>
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
                {i < STEPS.length - 1 && <ArrowRight className="landing-step-arrow" size={20} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="landing-bottom-cta">
        <div className="landing-bottom-cta-inner">
          <div className="landing-bottom-cta-copy">
            <div className="landing-eyebrow">Ready to grow your service business?</div>
            <h2>See Trackly in action.</h2>
            <p>Join the service businesses running smoother with Trackly.</p>
          </div>
          <div className="landing-bottom-cta-actions">
            <button className="landing-btn-primary" onClick={() => navigate('/register')}>
              Book Demo <ArrowRight size={16} />
            </button>
            <button className="landing-link-btn" onClick={() => navigate('/register')}>
              Or start free →
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-brand landing-footer-brand">
            <span className="landing-logo-mark landing-logo-mark-sm" aria-hidden="true" />
            <span>Trackly</span>
          </div>
          <nav className="landing-footer-links">
            <a href="#features" onClick={scrollTo('features')}>Features</a>
            <a href="#how-it-works" onClick={scrollTo('how-it-works')}>Solutions</a>
          </nav>
        </div>
        <div className="landing-footer-bottom">
          © {new Date().getFullYear()} Trackly. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
