import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Zap, Camera, FileText, Wrench, CalendarDays, ShieldCheck, ArrowRight
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
    icon: Wrench,
    title: 'AI Parts Suggestions',
    desc: 'Describe the issue and get an instant parts list with one-click search links to Google Shopping, Amazon, eBay, and RepairClinic.',
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
    desc: 'Role-based access for admins, managers, and technicians. Photos and documents stored securely on Azure Blob Storage.',
  },
];

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  return (
    <div className="landing">
      {/* Nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <Wrench size={20} />
            <span>Trackly</span>
          </div>
          <div className="landing-nav-actions">
            <button className="landing-signup-btn" onClick={() => navigate('/register')}>
              Create Company
            </button>
            <button className="landing-signin-btn" onClick={() => navigate('/login')}>
              Sign In <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-badge">Invoice Management System</div>
          <h1 className="landing-title">
            From claim to invoice<br />
            <span className="landing-title-accent">in minutes, not hours.</span>
          </h1>
          <p className="landing-subtitle">
            AI-powered claim processing, automated invoicing, and a complete workflow from service call to approval.
          </p>
          <div className="landing-cta-row">
            <button className="landing-cta-btn" onClick={() => navigate('/login')}>
              Get Started <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features">
        <div className="landing-features-inner">
          <h2 className="landing-section-title">Everything your team needs</h2>
          <p className="landing-section-sub">
            One platform for managers, technicians, and owners — no training required.
          </p>
          <div className="landing-feature-grid">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="landing-feature-card">
                <div className="landing-feature-icon">
                  <Icon size={22} />
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="landing-bottom-cta">
        <div className="landing-bottom-cta-inner">
          <h2>Ready to get started?</h2>
          <p>Sign in with your account to access the dashboard.</p>
          <button className="landing-cta-btn" onClick={() => navigate('/login')}>
            Sign In <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Trackly. All rights reserved.</span>
      </footer>
    </div>
  );
}
