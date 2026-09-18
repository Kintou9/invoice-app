import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import TemplateEditorForm from '../components/templates/TemplateEditorForm';
import InvoiceTemplatePreview from '../components/templates/InvoiceTemplatePreview';
import { Plus, Copy, Star, Archive } from 'lucide-react';
import './InvoiceTemplatesSettingsPage.css';

export default function InvoiceTemplatesSettingsPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/invoice-field-templates?include_archived=true').then((r) => setTemplates(r.data)).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const startEdit = (template) => {
    setEditingId(template.id);
    setDraft({ ...template });
  };

  const handleNew = async () => {
    try {
      const res = await api.post('/invoice-field-templates', { name: 'New Template', industry_key: 'general' });
      setTemplates((t) => [res.data, ...t]);
      startEdit(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create template');
    }
  };

  const handleDuplicate = async (template) => {
    try {
      const res = await api.post('/invoice-field-templates', { duplicate_from: template.id });
      setTemplates((t) => [res.data, ...t]);
      toast.success('Template duplicated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not duplicate template');
    }
  };

  const handleSetDefault = async (template) => {
    try {
      await api.post(`/invoice-field-templates/${template.id}/set-default`);
      toast.success(`"${template.name}" is now the default`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not set default');
    }
  };

  const handleArchive = async (template) => {
    try {
      await api.delete(`/invoice-field-templates/${template.id}`);
      toast.success('Template archived');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not archive template');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/invoice-field-templates/${editingId}`, draft);
      setTemplates((t) => t.map((x) => (x.id === editingId ? res.data : x)));
      toast.success('Template saved');
      setEditingId(null);
      setDraft(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading...</p>;

  if (editingId && draft) {
    return (
      <div className="invoice-templates-page">
        <div className="page-header">
          <h1>Edit Template</h1>
        </div>
        <div className="template-settings-layout">
          <TemplateEditorForm value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <InvoiceTemplatePreview template={draft} />
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => { setEditingId(null); setDraft(null); }} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    );
  }

  const active = templates.filter((t) => !t.is_archived);
  const archived = templates.filter((t) => t.is_archived);

  return (
    <div className="invoice-templates-page">
      <div className="page-header">
        <h1>Invoice Templates</h1>
        <button className="btn btn-primary" onClick={handleNew}><Plus size={16} /> New Template</button>
      </div>

      <div className="invoice-templates-list">
        {active.map((t) => (
          <div key={t.id} className="invoice-template-row">
            <div className="invoice-template-row-main" onClick={() => startEdit(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && startEdit(t)}>
              <span className="invoice-template-name">{t.name}</span>
              {t.is_default && <span className="status-badge status-approved">Default</span>}
            </div>
            <div className="invoice-template-row-actions">
              {!t.is_default && (
                <button className="btn btn-secondary btn-sm" onClick={() => handleSetDefault(t)} title="Set as default"><Star size={14} /></button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => handleDuplicate(t)} title="Duplicate"><Copy size={14} /></button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleArchive(t)} title="Archive" disabled={t.is_default}><Archive size={14} /></button>
            </div>
          </div>
        ))}
        {active.length === 0 && <p className="empty-cell">No templates yet — create one, or set one up during onboarding.</p>}
      </div>

      {archived.length > 0 && (
        <details className="template-editor-advanced" style={{ marginTop: '1.5rem' }}>
          <summary>Archived templates ({archived.length})</summary>
          <div className="invoice-templates-list">
            {archived.map((t) => (
              <div key={t.id} className="invoice-template-row archived">
                <span className="invoice-template-name">{t.name}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
