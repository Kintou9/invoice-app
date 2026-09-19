import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ZoomIn, ZoomOut, CircleAlert, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import './TestAndActivatePage.css';

const CATEGORY_OPTIONS = [
  { value: 'job_claim', label: 'Job & claim' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'combined', label: 'Combined' },
];

export default function TestAndActivatePage() {
  const { id, versionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('invoice');
  const [allowManualEdits, setAllowManualEdits] = useState(true);
  const [useAsDefault, setUseAsDefault] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [activating, setActivating] = useState(false);
  const [unmapped, setUnmapped] = useState(null);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    api.get(`/document-templates/${id}/versions/${versionId}`)
      .then((r) => { setTemplate(r.data.template); setFields(r.data.fields); setName(r.data.template.name); setCategory(r.data.template.category); setAllowManualEdits(r.data.template.allow_manual_edits); })
      .catch(() => toast.error('Could not load this template'))
      .finally(() => setLoading(false));

    setPdfLoading(true);
    api.post(`/document-templates/${id}/versions/${versionId}/preview`)
      .then((r) => setPdfUrl(r.data.pdf_url))
      .catch((err) => toast.error(err.response?.data?.error || 'Could not render a preview'))
      .finally(() => setPdfLoading(false));
  }, [id, versionId]);

  const requiredCount = fields.filter((f) => f.required).length;
  const mappedRequiredCount = fields.filter((f) => f.required && f.placed).length;
  const allMapped = mappedRequiredCount === requiredCount;

  const handleSaveDraft = async () => {
    try {
      await api.patch(`/document-templates/${id}`, { name, allow_manual_edits: allowManualEdits });
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save');
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    setUnmapped(null);
    try {
      await api.patch(`/document-templates/${id}`, {
        name, allow_manual_edits: allowManualEdits,
        is_default_invoice: category === 'invoice' ? useAsDefault : undefined,
        is_default_job_claim: category === 'job_claim' ? useAsDefault : undefined,
      });
      await api.post(`/document-templates/${id}/versions/${versionId}/activate`);
      setActivated(true);
      toast.success('Template activated');
    } catch (err) {
      if (err.response?.status === 400 && err.response.data.unmapped_fields) {
        setUnmapped(err.response.data.unmapped_fields);
      } else {
        toast.error(err.response?.data?.error || 'Could not activate this template');
      }
    } finally {
      setActivating(false);
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!template) return <p className="empty-msg">Template not found.</p>;

  return (
    <div className="ta-page">
      <div className="ta-breadcrumb"><Link to="/settings/document-templates">Document Templates</Link> / <span>{template.name}</span></div>
      <h1>Test &amp; activate</h1>
      <p className="ta-subtitle">Check how your template looks with sample job data.</p>

      <div className="ta-layout">
        <div className="ta-preview-col">
          <div className="ta-preview-toolbar">
            <button onClick={() => setZoom((z) => Math.max(50, z - 10))}><ZoomOut size={15} /></button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn size={15} /></button>
          </div>
          <div className="ta-preview-frame">
            {pdfLoading ? <p className="ta-preview-loading">Rendering preview...</p> : pdfUrl ? (
              <iframe title="Template preview" src={pdfUrl} style={{ width: `${zoom}%` }} />
            ) : <p className="empty-msg">Preview unavailable.</p>}
          </div>
          {activated && (
            <div className="ta-activated-banner"><CheckCircle2 size={16} /> Future invoices can use this layout automatically.</div>
          )}
        </div>

        <div className="ta-settings-panel">
          <h3>Template settings</h3>
          <label className="ta-field"><span>Template name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="ta-field">
            <span>Category</span>
            <select value={category} disabled>
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>

          <label className="ta-toggle-row">
            <input type="checkbox" checked={useAsDefault} onChange={(e) => setUseAsDefault(e.target.checked)} />
            <span><strong>Use as default {category === 'job_claim' ? 'job/claim form' : 'invoice'}</strong><small>This template will be preselected when creating a new document.</small></span>
          </label>
          <label className="ta-toggle-row">
            <input type="checkbox" checked={allowManualEdits} onChange={(e) => setAllowManualEdits(e.target.checked)} />
            <span><strong>Allow manual edits before sending</strong><small>Let your team make changes before it's finalized.</small></span>
          </label>

          {unmapped ? (
            <div className="ta-status-card ta-status-warn">
              <CircleAlert size={18} />
              <div><strong>Some required fields aren't mapped</strong><ul>{unmapped.map((l) => <li key={l}>{l}</li>)}</ul></div>
            </div>
          ) : (
            <div className={`ta-status-card ${allMapped ? 'ta-status-ok' : 'ta-status-warn'}`}>
              <CheckCircle2 size={18} />
              <div><strong>{allMapped ? 'Everything lines up' : 'Some required fields need placement'}</strong><small>{mappedRequiredCount} of {requiredCount} required fields mapped</small></div>
            </div>
          )}

          <Link to={`/settings/document-templates/${id}/map/${versionId}`} className="ta-return-link">← Return to field mapping</Link>
        </div>
      </div>

      <div className="ta-bottom-actions">
        <button className="btn btn-secondary" onClick={() => navigate(`/settings/document-templates/${id}/map/${versionId}`)}>Back</button>
        <div>
          <button className="btn btn-secondary" onClick={handleSaveDraft}>Save draft</button>
          <button className="btn btn-primary" onClick={handleActivate} disabled={activating || activated}>
            {activated ? 'Activated' : activating ? 'Activating...' : 'Activate template'}
          </button>
        </div>
      </div>
    </div>
  );
}
