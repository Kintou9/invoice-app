import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ZoomIn, ZoomOut, Plus, Trash2, Search, Check, CircleAlert } from 'lucide-react';
import api from '../services/api';
import { DOCUMENT_FIELD_CATALOG, DOCUMENT_FIELD_LABELS } from '../utils/documentTemplateFields';
import './MapYourFormPage.css';

function newFieldId() {
  return `new-${Math.random().toString(36).slice(2)}`;
}

export default function MapYourFormPage() {
  const { id, versionId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState(null);
  const [version, setVersion] = useState(null);
  const [pages, setPages] = useState([]);
  const [fields, setFields] = useState([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [placingId, setPlacingId] = useState(null); // a field awaiting its first click-to-place
  const [dragState, setDragState] = useState(null); // { fieldId, mode: 'move'|'resize', startX, startY, orig }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/document-templates/${id}/versions/${versionId}`)
      .then((r) => { setTemplate(r.data.template); setVersion(r.data.version); setPages(r.data.pages); setFields(r.data.fields); })
      .catch(() => toast.error('Could not load this template'))
      .finally(() => setLoading(false));
  }, [id, versionId]);

  const currentPage = pages.find((p) => p.page_number === page);
  const pageFields = useMemo(() => fields.filter((f) => f.page_number === page), [fields, page]);
  const filteredFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? fields.filter((f) => f.label.toLowerCase().includes(q)) : fields;
  }, [fields, search]);
  const needsReviewCount = fields.filter((f) => !f.reviewed || !f.placed).length;
  const selected = fields.find((f) => f.id === selectedId) || null;

  const updateField = (fieldId, patch) => setFields((fs) => fs.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));

  const handleCanvasClick = (e) => {
    if (!placingId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    updateField(placingId, { x: Math.max(0, x - 0.08), y: Math.max(0, y - 0.02), width: 0.16, height: 0.04, placed: true });
    setSelectedId(placingId);
    setPlacingId(null);
  };

  const handleBoxMouseDown = (e, field, mode) => {
    e.stopPropagation();
    setSelectedId(field.id);
    setDragState({ fieldId: field.id, mode, startX: e.clientX, startY: e.clientY, orig: { x: field.x, y: field.y, width: field.width, height: field.height } });
  };

  useEffect(() => {
    if (!dragState) return undefined;
    const handleMove = (e) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragState.startX) / rect.width;
      const dy = (e.clientY - dragState.startY) / rect.height;
      if (dragState.mode === 'move') {
        updateField(dragState.fieldId, {
          x: Math.min(0.95, Math.max(0, dragState.orig.x + dx)),
          y: Math.min(0.95, Math.max(0, dragState.orig.y + dy)),
        });
      } else {
        updateField(dragState.fieldId, {
          width: Math.max(0.03, Math.min(1 - dragState.orig.x, dragState.orig.width + dx)),
          height: Math.max(0.02, Math.min(1 - dragState.orig.y, dragState.orig.height + dy)),
        });
      }
    };
    const handleUp = () => setDragState(null);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => { document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp); };
  }, [dragState]);

  const handleAddField = () => {
    const newField = {
      id: newFieldId(), page_number: page, field_key: '', label: 'New field', field_type: 'text',
      x: 0.1, y: 0.1, width: 0.2, height: 0.04, placed: true, required: false, sample_value: '',
      detection_confidence: null, reviewed: true,
    };
    setFields((fs) => [...fs, newField]);
    setSelectedId(newField.id);
  };

  const handleDeleteField = (fieldId) => {
    setFields((fs) => fs.filter((f) => f.id !== fieldId));
    if (selectedId === fieldId) setSelectedId(null);
  };

  const persist = async () => {
    setSaving(true);
    try {
      await api.patch(`/document-templates/${id}/versions/${versionId}/fields`, { fields });
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the mapping');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => { if (await persist()) toast.success('Draft saved'); };
  const handleTest = async () => { if (await persist()) navigate(`/settings/document-templates/${id}/test/${versionId}`); };

  if (loading) return <p>Loading...</p>;
  if (!template) return <p className="empty-msg">Template not found.</p>;

  return (
    <div className="mf-page">
      <div className="mf-breadcrumb"><Link to="/settings/document-templates">Document Templates</Link> / <span>{template.name}</span></div>
      <h1>Map your form</h1>
      <p className="mf-subtitle">Review the fields once, then Trackly will fill this form automatically.</p>

      <div className="mf-layout">
        <div className="mf-canvas-col">
          <div className="mf-canvas-toolbar">
            <button onClick={() => setZoom((z) => Math.max(50, z - 10))}><ZoomOut size={15} /></button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn size={15} /></button>
            {pages.length > 1 && (
              <div className="mf-page-nav">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <span>Page {page} of {pages.length}</span>
                <button disabled={page >= pages.length} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            )}
            {placingId && <span className="mf-placing-hint"><CircleAlert size={14} /> Click on the document to place this field</span>}
          </div>
          <div className="mf-canvas-scroll">
            <div className="mf-canvas" style={{ width: `${zoom}%` }} ref={canvasRef} onClick={handleCanvasClick}>
              {currentPage && <img src={currentPage.sas_url} alt="Document page" draggable={false} />}
              {pageFields.filter((f) => f.placed).map((f) => {
                const index = fields.indexOf(f) + 1;
                return (
                  <div
                    key={f.id}
                    className={`mf-field-box ${selectedId === f.id ? 'mf-field-box-selected' : ''}`}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                    onMouseDown={(e) => handleBoxMouseDown(e, f, 'move')}
                  >
                    <span className="mf-field-marker">{index}</span>
                    <div className="mf-field-resize" onMouseDown={(e) => handleBoxMouseDown(e, f, 'resize')} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mf-panel">
          <div className="mf-panel-summary">
            <div className="mf-summary-icon"><Check size={16} /></div>
            <div>
              <strong>{fields.length} fields detected</strong>
              <span>Confidence: {version?.detection_confidence ? version.detection_confidence[0].toUpperCase() + version.detection_confidence.slice(1) : 'N/A'}</span>
            </div>
            {needsReviewCount > 0 && <span className="mf-needs-review-pill">{needsReviewCount} need review</span>}
          </div>

          <div className="mf-search"><Search size={14} /><input placeholder="Search fields..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

          <div className="mf-field-list">
            {filteredFields.map((f) => {
              const index = fields.indexOf(f) + 1;
              return (
                <button key={f.id} className={`mf-field-row ${selectedId === f.id ? 'active' : ''}`} onClick={() => setSelectedId(f.id)}>
                  <span className="mf-field-row-index">{index}</span>
                  <span className="mf-field-row-label">{f.label}</span>
                  <span className="mf-field-row-maps">{DOCUMENT_FIELD_LABELS[f.field_key] || (f.field_key ? 'Custom' : 'Unmapped')}</span>
                  {!f.placed ? <CircleAlert size={14} className="mf-icon-warn" /> : <Check size={14} className="mf-icon-ok" />}
                </button>
              );
            })}
            {filteredFields.length === 0 && <p className="empty-msg">No fields yet.</p>}
          </div>

          <button className="btn btn-secondary mf-add-field-btn" onClick={handleAddField}><Plus size={14} /> Add field</button>

          {selected && (
            <div className="mf-field-editor">
              <div className="mf-field-editor-header">
                <strong>{selected.label}</strong>
                <button onClick={() => handleDeleteField(selected.id)}><Trash2 size={14} /></button>
              </div>
              <label className="mf-field">
                <span>Field label</span>
                <input value={selected.label} onChange={(e) => updateField(selected.id, { label: e.target.value })} />
              </label>
              <label className="mf-field">
                <span>Maps to</span>
                <select
                  value={selected.field_key || ''}
                  onChange={(e) => updateField(selected.id, { field_key: e.target.value, field_type: DOCUMENT_FIELD_CATALOG.find((c) => c.key === e.target.value)?.type || 'text', reviewed: true })}
                >
                  <option value="">Not mapped</option>
                  {DOCUMENT_FIELD_CATALOG.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="mf-toggle-row">
                <input type="checkbox" checked={selected.required} onChange={(e) => updateField(selected.id, { required: e.target.checked })} />
                Required field
              </label>
              <label className="mf-field">
                <span>Sample value (from this document)</span>
                <input value={selected.sample_value || ''} onChange={(e) => updateField(selected.id, { sample_value: e.target.value })} />
              </label>
              {!selected.placed && (
                <button className="btn btn-secondary mf-place-btn" onClick={() => setPlacingId(selected.id)}>Place on document</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mf-bottom-actions">
        <button className="btn btn-secondary" onClick={() => navigate('/settings/document-templates')}>Back</button>
        <div>
          <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : 'Save draft'}</button>
          <button className="btn btn-primary" onClick={handleTest} disabled={saving}>Test with sample data →</button>
        </div>
      </div>
    </div>
  );
}
