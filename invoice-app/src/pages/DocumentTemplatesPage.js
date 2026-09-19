import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import UploadFormModal from '../components/documentTemplates/UploadFormModal';
import ConfirmModal from '../components/team/ConfirmModal';
import {
  UploadCloud, FileText, Search, Star, MoreHorizontal, Eye, Pencil, Copy, Archive, Check,
} from 'lucide-react';
import './DocumentTemplatesPage.css';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'job_claim', label: 'Job & claim' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'combined', label: 'Combined' },
];

const STATUS_LABELS = {
  active: { label: 'Ready', tone: 'green' },
  needs_review: { label: 'Needs review', tone: 'orange' },
  processing: { label: 'Processing', tone: 'blue' },
  draft: { label: 'Draft', tone: 'gray' },
  failed: { label: 'Failed', tone: 'red' },
  archived: { label: 'Archived', tone: 'gray' },
};

export default function DocumentTemplatesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManageTemplates = user.role === 'owner' || user.role === 'manager';
  // The flat-field "Start from scratch" builder is the pre-existing
  // invoice_field_templates system, which has always been owner-only on the
  // backend — kept as-is per not touching that system's own permissions,
  // so this button stays owner-only too rather than showing something that
  // would 403 for a manager.
  const canBuildFromScratch = user.role === 'owner';

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveWarning, setArchiveWarning] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api.get('/document-templates').then((r) => setTemplates(r.data)).catch(() => toast.error('Failed to load templates')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (tab !== 'all' && t.category !== tab) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, tab, search]);

  const handleStartFromScratch = () => navigate('/settings/invoice-templates?new=1');

  const handlePreview = async (t) => {
    if (t.source_type !== 'uploaded' || !t.active_version_id) {
      toast.info('Preview is available once this template has an active version.');
      return;
    }
    setBusyId(t.id);
    try {
      const res = await api.post(`/document-templates/${t.id}/versions/${t.active_version_id}/preview`);
      window.open(res.data.pdf_url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate a preview');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (t) => {
    setBusyId(t.id);
    try {
      await api.post(`/document-templates/${t.id}/duplicate`);
      toast.success('Template duplicated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not duplicate this template');
    } finally {
      setBusyId(null);
      setOpenMenuId(null);
    }
  };

  const handleArchive = async (confirm) => {
    setBusyId(archiveTarget.id);
    try {
      await api.post(`/document-templates/${archiveTarget.id}/archive${confirm ? '?confirm=true' : ''}`);
      toast.success('Template archived');
      setArchiveTarget(null);
      setArchiveWarning(null);
      load();
    } catch (err) {
      if (err.response?.status === 409) {
        setArchiveWarning(err.response.data);
      } else {
        toast.error(err.response?.data?.error || 'Could not archive this template');
        setArchiveTarget(null);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleEditMapping = async (t) => {
    if (t.source_type === 'built') {
      navigate('/settings/invoice-templates');
      return;
    }
    if (t.status === 'active') {
      // Editing a live template never mutates it — a fresh draft version is
      // created first, and the mapping workspace opens on that draft.
      setBusyId(t.id);
      try {
        const res = await api.post(`/document-templates/${t.id}/versions`, { clone_from_version_id: t.active_version_id });
        navigate(`/settings/document-templates/${t.id}/map/${res.data.id}`);
      } catch (err) {
        toast.error(err.response?.data?.error || 'Could not start a new draft');
      } finally {
        setBusyId(null);
      }
      return;
    }
    navigate(`/settings/document-templates/${t.id}/map/${t.active_version_id}`);
  };

  if (loading) return <p>Loading templates...</p>;

  return (
    <div className="dt-page">
      <div className="dt-header">
        <div>
          <h1>Document Templates</h1>
          <p className="dt-subtitle">Use your existing forms or start with a Trackly template.</p>
        </div>
      </div>

      {(canManageTemplates || canBuildFromScratch) && (
        <div className="dt-creation-row">
          {canManageTemplates && (
            <div className="dt-creation-card dt-creation-recommended">
              <span className="dt-badge-recommended">Recommended</span>
              <div className="dt-creation-icon"><UploadCloud size={26} /></div>
              <h2>Upload an existing form</h2>
              <p>PDF, photo, or scanned paper form</p>
              <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>Upload form</button>
              <ul>
                <li><Check size={13} /> We'll extract the fields</li>
                <li><Check size={13} /> Works with most forms</li>
                <li><Check size={13} /> Set up in minutes</li>
              </ul>
            </div>
          )}
          {canBuildFromScratch && (
            <div className="dt-creation-card">
              <div className="dt-creation-icon"><FileText size={26} /></div>
              <h2>Build a Trackly template</h2>
              <p>Start with a clean template and add the fields you need.</p>
              <button className="btn btn-secondary" onClick={handleStartFromScratch}>Start from scratch</button>
              <ul>
                <li><Check size={13} /> Invoices, claims, or combined</li>
                <li><Check size={13} /> Customize for your business</li>
                <li><Check size={13} /> Use again and again</li>
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="dt-tabs">
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      <div className="dt-toolbar">
        <div className="dt-search"><Search size={15} /><input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="dt-grid">
        {filtered.map((t) => {
          const statusMeta = STATUS_LABELS[t.status] || STATUS_LABELS.draft;
          return (
            <div key={t.id} className="dt-card">
              <div className="dt-card-thumb">
                {t.thumbnail_sas_url ? <img src={t.thumbnail_sas_url} alt="" /> : <FileText size={32} />}
                <button className={`dt-star ${t.is_default ? 'dt-star-active' : ''}`} title="Default template"><Star size={16} /></button>
              </div>
              <div className="dt-card-body">
                <strong>{t.name}</strong>
                <span className={`role-badge role-manager`}>{t.category === 'job_claim' ? 'Claim form' : t.category === 'combined' ? 'Combined' : 'Invoice'}</span>
                <div className="dt-card-meta">
                  <FileText size={13} />
                  {t.source_type === 'built' ? 'Custom Trackly template' : `${t.field_count ?? 0} field${t.field_count === 1 ? '' : 's'} mapped`}
                </div>
                <div className="dt-card-status">
                  <span className={`dt-status-dot dt-status-${statusMeta.tone}`} /> {statusMeta.label}
                  {t.fields_needing_review > 0 && <span className="dt-needs-review"> · {t.fields_needing_review} need review</span>}
                </div>
              </div>
              <div className="dt-card-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => handlePreview(t)} disabled={busyId === t.id}><Eye size={13} /> Preview</button>
                {canManageTemplates && (
                  <button className="btn btn-sm btn-secondary" onClick={() => handleEditMapping(t)} disabled={busyId === t.id}><Pencil size={13} /> Edit mapping</button>
                )}
                {canManageTemplates && (
                  <div className="dt-menu-wrap">
                    <button className="btn btn-sm btn-secondary" onClick={() => setOpenMenuId(openMenuId === t.id ? null : t.id)}><MoreHorizontal size={14} /></button>
                    {openMenuId === t.id && (
                      <div className="dt-menu">
                        <button onClick={() => handleDuplicate(t)}><Copy size={13} /> Duplicate</button>
                        <button className="dt-menu-danger" onClick={() => { setArchiveTarget(t); setOpenMenuId(null); }}><Archive size={13} /> Archive</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="empty-msg">No templates match your filters.</p>}
      </div>

      {uploadOpen && <UploadFormModal onClose={() => setUploadOpen(false)} />}

      {archiveTarget && !archiveWarning && (
        <ConfirmModal
          title="Archive this template?"
          body={`"${archiveTarget.name}" will be archived. It can't be selected for new documents, but nothing already generated is affected.`}
          confirmLabel="Archive"
          danger
          busy={busyId === archiveTarget.id}
          onConfirm={() => handleArchive(false)}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
      {archiveTarget && archiveWarning && (
        <ConfirmModal
          title="This template is in use"
          body={`${archiveWarning.documents_generated} document(s) have been generated from it and it has ${archiveWarning.active_assignments} active assignment(s). Archiving won't change past documents, but it will stop this template from being used for new ones. Archive anyway?`}
          confirmLabel="Archive anyway"
          danger
          busy={busyId === archiveTarget.id}
          onConfirm={() => handleArchive(true)}
          onCancel={() => { setArchiveTarget(null); setArchiveWarning(null); }}
        />
      )}
    </div>
  );
}
