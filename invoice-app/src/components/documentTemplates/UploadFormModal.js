import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { UploadCloud, FileText } from 'lucide-react';
import api from '../../services/api';

const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const CATEGORY_OPTIONS = [
  { value: 'job_claim', label: 'Job & claim' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'combined', label: 'Combined' },
];

function loadImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// A PDF page can't be sent to Claude vision or drawn as a mapping-canvas
// background as-is — it's rendered to a real PNG here, client-side, via
// pdfjs-dist. A photo/PNG/JPG upload skips this entirely (it's already an
// image) and is used directly as page 1.
async function renderPdfFirstPageToPng(file) {
  const { getDocument } = await import('../../utils/pdfjsWorker');
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, width: canvas.width, height: canvas.height, pageCount: pdf.numPages };
}

export default function UploadFormModal({ onClose }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('invoice');
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState(null); // null | 'rendering' | 'uploading' | 'detecting'

  const validateAndSetFile = (f) => {
    setError(null);
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError('Upload a PDF, PNG, or JPG file.');
      return;
    }
    if (f.size > MAX_SIZE) {
      setError('That file is too large — the limit is 15MB.');
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) validateAndSetFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Choose a file first.'); return; }
    if (!name.trim()) { setError('Give this template a name.'); return; }

    setUploading(true);
    try {
      let pageBlob = file;
      let pageFilename = file.name; // a real photo keeps its own real extension — never relabeled
      let width = null, height = null;

      if (file.type === 'application/pdf') {
        setStage('rendering');
        const rendered = await renderPdfFirstPageToPng(file);
        pageBlob = rendered.blob;
        pageFilename = 'page-1.png'; // genuinely a PNG here — pdfjs-dist's canvas.toBlob('image/png') output
        width = rendered.width;
        height = rendered.height;
      } else {
        const dims = await loadImageDimensions(file).catch(() => ({ width: null, height: null }));
        width = dims.width;
        height = dims.height;
      }

      setStage('detecting');
      const form = new FormData();
      form.append('name', name.trim());
      form.append('category', category);
      form.append('original', file, file.name);
      form.append('pages', pageBlob, pageFilename);
      if (width) form.append('page_0_width', width);
      if (height) form.append('page_0_height', height);

      const res = await api.post('/document-templates/upload', form);
      toast.success('Template uploaded — review the detected fields below.');
      navigate(`/settings/document-templates/${res.data.template.id}/map/${res.data.version.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Try again.');
    } finally {
      setUploading(false);
      setStage(null);
    }
  };

  return (
    <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <form className="dt-modal" onSubmit={handleSubmit}>
        <div className="dt-modal-header">
          <h3>Upload an existing form</h3>
          <button type="button" className="dt-modal-close" onClick={onClose} disabled={uploading}>×</button>
        </div>

        <div
          className={`dt-dropzone ${dragOver ? 'dt-dropzone-active' : ''} ${file ? 'dt-dropzone-filled' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden
            onChange={(e) => e.target.files[0] && validateAndSetFile(e.target.files[0])} />
          {file ? (
            <><FileText size={28} /><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</span></>
          ) : (
            <><UploadCloud size={28} /><strong>Drag and drop, or click to choose a file</strong><span>PDF, PNG, JPG, or a phone photo of a paper form</span></>
          )}
        </div>

        {error && <p className="dt-error">{error}</p>}

        <label className="dt-field">
          <span>Template name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Apex Insurance Claim" required />
        </label>

        <label className="dt-field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>

        <div className="dt-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
            {uploading ? (stage === 'rendering' ? 'Preparing document...' : 'Uploading & detecting fields...') : 'Upload & continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
