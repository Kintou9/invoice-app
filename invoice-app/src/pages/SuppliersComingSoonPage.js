import { Link } from 'react-router-dom';
import { Store, ArrowLeft } from 'lucide-react';
import './SuppliersComingSoonPage.css';

// Reached whenever /suppliers is visited while SUPPLIERS_ENABLED is off —
// whether or not the nav link itself is visible. See config/featureFlags.js.
export default function SuppliersComingSoonPage() {
  return (
    <div className="suppliers-soon-page">
      <div className="suppliers-soon-card">
        <div className="suppliers-soon-icon"><Store size={28} /></div>
        <h1>Supplier management is coming soon</h1>
        <p>
          We're building a dedicated way to manage your suppliers directly in Trackly —
          track pricing, contacts, and ordering history alongside your jobs and invoices.
        </p>
        <Link to="/dashboard" className="btn btn-primary">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
