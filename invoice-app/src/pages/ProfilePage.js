import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Camera } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Avatar from '../components/shared/Avatar';
import PhotoCropModal from '../components/profile/PhotoCropModal';
import ConfirmModal from '../components/team/ConfirmModal';
import './ProfilePage.css';

const PHONE_PATTERN = /^[\d\s()+.-]{5,25}$/;

export default function ProfilePage() {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', jobTitle: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const load = () => {
    api.get('/me').then((res) => {
      setProfile(res.data);
      // Accounts created before first/last name existed as separate
      // fields only ever have the combined `name` — fall back to
      // splitting it as a starting point rather than showing blank
      // required fields on someone's first visit to this page.
      let { firstName, lastName } = res.data;
      if (!firstName && !lastName && res.data.name) {
        const parts = res.data.name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ');
      }
      setForm({ firstName, lastName, phone: res.data.phone, jobTitle: res.data.jobTitle });
      setDirty(false);
    }).catch(() => toast.error('Could not load your profile.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Warn on tab close/refresh with unsaved edits — the common real-world
  // way this kind of loss actually happens.
  useEffect(() => {
    const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const updateField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setDirty(true);
    setErrors((e) => ({ ...e, [field]: null }));
  };

  const validate = () => {
    const next = {};
    if (!form.firstName.trim()) next.firstName = 'First name is required.';
    if (!form.lastName.trim()) next.lastName = 'Last name is required.';
    if (form.phone && !PHONE_PATTERN.test(form.phone)) next.phone = 'Enter a valid phone number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await api.patch('/me', form);
      setProfile(res.data);
      setDirty(false);
      toast.success('Profile updated.');
      refreshUser();
    } catch (err) {
      const message = err.response?.data?.error || 'Could not save your changes.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoFile = () => setCropModalOpen(true);

  const handleSavePhoto = async (blob) => {
    setUploadingPhoto(true);
    try {
      const body = new FormData();
      body.append('avatar', blob, 'avatar.jpg');
      const res = await api.post('/me/avatar', body);
      setProfile(res.data);
      setCropModalOpen(false);
      toast.success('Profile photo updated.');
      refreshUser();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not upload that photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    setRemovingPhoto(true);
    try {
      const res = await api.delete('/me/avatar');
      setProfile(res.data);
      setRemoveConfirmOpen(false);
      toast.success('Profile photo removed.');
      refreshUser();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not remove your photo.');
    } finally {
      setRemovingPhoto(false);
    }
  };

  if (loading) return <div className="profile-page"><p className="empty-msg">Loading your profile...</p></div>;
  if (!profile) return null;

  const fullName = `${form.firstName} ${form.lastName}`.trim() || profile.name;

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1>My Profile</h1>
        <p className="profile-subtitle">Manage your personal information and profile photo.</p>
      </div>

      <div className="profile-layout">
        <section className="profile-card profile-summary-card">
          <div className="profile-photo-wrap">
            <Avatar src={profile.avatarUrl} name={fullName} size="xl" />
            <button
              type="button"
              className="profile-photo-edit-btn"
              onClick={handlePhotoFile}
              aria-label="Update profile photo"
            >
              <Camera size={16} />
            </button>
          </div>

          <h2 className="profile-name">{fullName}</h2>
          <p className="profile-email">{profile.email}</p>

          <dl className="profile-meta">
            <div>
              <dt>Role</dt>
              <dd>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{profile.organizationName}</dd>
            </div>
          </dl>

          <button type="button" className="btn btn-primary btn-full" onClick={handlePhotoFile}>
            {profile.avatarUrl ? 'Replace photo' : 'Upload new photo'}
          </button>
          {profile.avatarUrl && (
            <button type="button" className="btn btn-secondary btn-full" onClick={() => setRemoveConfirmOpen(true)}>
              Remove photo
            </button>
          )}
          <p className="profile-photo-help">JPG, PNG, or WebP. Maximum 5 MB.</p>
        </section>

        <section className="profile-card profile-form-card">
          <h2>Personal information</h2>
          <form onSubmit={handleSave}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="profile-first-name">First name</label>
                <input
                  id="profile-first-name"
                  value={form.firstName}
                  onChange={(e) => updateField('firstName', e.target.value)}
                  aria-invalid={!!errors.firstName}
                  aria-describedby={errors.firstName ? 'profile-first-name-error' : undefined}
                />
                {errors.firstName && <span id="profile-first-name-error" className="profile-field-error">{errors.firstName}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="profile-last-name">Last name</label>
                <input
                  id="profile-last-name"
                  value={form.lastName}
                  onChange={(e) => updateField('lastName', e.target.value)}
                  aria-invalid={!!errors.lastName}
                  aria-describedby={errors.lastName ? 'profile-last-name-error' : undefined}
                />
                {errors.lastName && <span id="profile-last-name-error" className="profile-field-error">{errors.lastName}</span>}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profile-email">Email address</label>
              <input id="profile-email" value={profile.email} disabled />
              <span className="profile-field-hint">This is your account email and cannot be changed.</span>
            </div>

            <div className="form-group">
              <label htmlFor="profile-phone">Phone number (optional)</label>
              <input
                id="profile-phone"
                type="tel"
                placeholder="e.g. 0412 345 678"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'profile-phone-error' : undefined}
              />
              {errors.phone && <span id="profile-phone-error" className="profile-field-error">{errors.phone}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="profile-job-title">Job title</label>
              <input
                id="profile-job-title"
                value={form.jobTitle}
                onChange={(e) => updateField('jobTitle', e.target.value)}
                placeholder="e.g. Owner / Manager"
              />
              <span className="profile-field-hint">Specific to {profile.organizationName}.</span>
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </form>
        </section>
      </div>

      <section className="profile-card profile-preview-card">
        <h2>Profile photo preview</h2>
        <p className="profile-preview-note">
          Here's how your photo will appear across Trackly. If no photo is added, Trackly will show your initials.
        </p>
        <div className="profile-preview-grid">
          <div className="profile-preview-item">
            <span className="profile-preview-label">In the sidebar</span>
            <div className="profile-preview-row">
              <Avatar src={profile.avatarUrl} name={fullName} size="sm" variant="solid" />
              <div>
                <strong>{fullName}</strong>
                <span>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}</span>
              </div>
            </div>
          </div>
          <div className="profile-preview-item">
            <span className="profile-preview-label">On the Team page</span>
            <div className="profile-preview-row">
              <Avatar src={profile.avatarUrl} name={fullName} size="md" />
              <div>
                <strong>{fullName}</strong>
                <span>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}</span>
              </div>
            </div>
          </div>
          <div className="profile-preview-item">
            <span className="profile-preview-label">In job assignments</span>
            <div className="profile-preview-row">
              <Avatar src={profile.avatarUrl} name={fullName} size="xs" />
              <div>
                <span>Assigned to</span>
                <strong>{fullName}</strong>
              </div>
            </div>
          </div>
          <div className="profile-preview-item">
            <span className="profile-preview-label">In activity comments</span>
            <div className="profile-preview-row">
              <Avatar src={profile.avatarUrl} name={fullName} size="sm" />
              <div>
                <strong>{fullName}</strong>
                <span>2 hours ago</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {cropModalOpen && (
        <PhotoCropModal
          onClose={() => setCropModalOpen(false)}
          onSave={handleSavePhoto}
          saving={uploadingPhoto}
        />
      )}

      {removeConfirmOpen && (
        <ConfirmModal
          title="Remove profile photo?"
          body="Your initials avatar will be shown instead across Trackly."
          confirmLabel="Remove photo"
          danger
          busy={removingPhoto}
          onConfirm={handleRemovePhoto}
          onCancel={() => setRemoveConfirmOpen(false)}
        />
      )}
    </div>
  );
}
