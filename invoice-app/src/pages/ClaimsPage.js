import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Plus, Search, Upload, Sparkles, X } from 'lucide-react';
import './ClaimsPage.css';

export default function ClaimsPage() {
  const { user } = useAuth();
  const photoInputRef = useRef(null);
  const [claims, setClaims] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ claim_number: '', title: '', description: '', assigned_to: '', claim_photo_url: '' });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/claims').then((r) => setClaims(r.data)).finally(() => setLoading(false));
    if (user.role !== 'technician') {
      api.get('/users/technicians').then((r) => setTechnicians(r.data));
    }
  }, [user.role]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoLoading(true);

    // Show local preview immediately
    setPhotoPreview(URL.createObjectURL(file));

    try {
      const data = new FormData();
      data.append('photo', file);
      const res = await api.post('/upload/claim-photo', data);

      // Store the blob URL
      setForm((f) => ({ ...f, claim_photo_url: res.data.blob_url }));

      // Auto-fill fields from AI extraction if available
      const { extracted } = res.data;
      if (extracted?.claim_number || extracted?.title) {
        setForm((f) => ({
          ...f,
          claim_photo_url: res.data.blob_url,
          claim_number: extracted.claim_number || f.claim_number,
          title: extracted.title || f.title,
          description: extracted.description || f.description,
        }));
        toast.success('Photo uploaded — AI extracted claim details');
      } else {
        toast.success('Photo uploaded');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
      setPhotoPreview(null);
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setForm((f) => ({ ...f, claim_photo_url: '' }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/claims', form);
      setClaims([res.data, ...claims]);
      setShowForm(false);
      setForm({ claim_number: '', title: '', description: '', assigned_to: '', claim_photo_url: '' });
      setPhotoPreview(null);
      toast.success('Claim created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create claim');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setForm({ claim_number: '', title: '', description: '', assigned_to: '', claim_photo_url: '' });
    setPhotoPreview(null);
  };

  const filtered = claims.filter(
    (c) =>
      c.claim_number.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="claims-page">
      <div className="page-header">
        <h1>{user.role === 'technician' ? 'My Claims' : 'All Claims'}</h1>
        {user.role !== 'technician' && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            <Plus size={16} /> New Claim
          </button>
        )}
      </div>

      {showForm && (
        <form className="create-form" onSubmit={handleCreate}>
          <h2>New Claim</h2>

          {/* Photo upload */}
          <div className="claim-photo-upload">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoUpload}
              style={{ display: 'none' }}
            />
            {photoPreview ? (
              <div className="photo-preview-wrap">
                <img src={photoPreview} alt="Claim" className="claim-photo-preview" />
                <div className="photo-preview-info">
                  <div className="photo-preview-label">
                    <Sparkles size={14} />
                    {photoLoading ? 'Extracting claim details with AI...' : 'AI extracted details below — edit as needed'}
                  </div>
                  <button type="button" className="remove-photo-btn" onClick={handleRemovePhoto}>
                    <X size={14} /> Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="photo-upload-btn"
                onClick={() => photoInputRef.current.click()}
                disabled={photoLoading}
              >
                <Upload size={18} />
                <span>Upload Insurance Claim Screenshot</span>
                <small>AI will extract the claim number and details automatically</small>
              </button>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Claim Number</label>
              <input
                value={form.claim_number}
                onChange={(e) => setForm({ ...form, claim_number: e.target.value })}
                required
                placeholder="e.g. CLM-2024-001"
              />
            </div>
            <div className="form-group">
              <label>Assign To</label>
              <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                <option value="">Unassigned</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              placeholder="Brief description of the claim"
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Additional notes or details from the claim"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={photoLoading}>
              Create Claim
            </button>
          </div>
        </form>
      )}

      <div className="search-bar">
        <Search size={16} />
        <input
          placeholder="Search by claim number or title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="claims-table-wrap">
          <table className="claims-table">
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Title</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><span className="claim-num-link">{c.claim_number}</span></td>
                  <td>{c.title}</td>
                  <td>{c.assigned_to_name || <span className="unassigned">Unassigned</span>}</td>
                  <td><span className={`status-badge status-${c.status}`}>{c.status.replace('_', ' ')}</span></td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/claims/${c.id}`} className="btn btn-sm btn-secondary">View</Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-cell">No claims found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
