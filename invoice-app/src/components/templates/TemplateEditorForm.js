import { useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../services/api';
import './TemplateEditorForm.css';

// The one shared editor for a template's config — used by both the
// onboarding wizard's customize step and the Invoice Templates settings
// page, so there is exactly one place this editing UI is built. `value` is
// the controlled draft object; `onChange(patch)` merges a partial update
// into it (parent owns the state).
export default function TemplateEditorForm({ value, onChange }) {
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const set = (patch) => onChange({ ...patch });
  const setFeature = (key, checked) => set({ optional_features: { ...value.optional_features, [key]: checked } });

  const updateField = (fieldId, patch) => {
    set({ fields: value.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) });
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const data = new FormData();
      data.append('logo', file);
      const res = await api.post('/upload/logo', data);
      set({ logo_blob_url: res.data.blob_url, logo_sas_url: res.data.sas_url });
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const sortedFields = [...(value.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const features = value.optional_features || {};

  return (
    <div className="template-editor-form">
      <div className="form-group">
        <label htmlFor="tpl-name">Template Name</label>
        <input id="tpl-name" value={value.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Electrical Services" />
      </div>

      <fieldset className="template-editor-fieldset">
        <legend>Business Info</legend>
        <div className="template-editor-logo-row">
          {(value.logo_sas_url || value.logo_blob_url) && (
            <img className="template-editor-logo-preview" src={value.logo_sas_url || value.logo_blob_url} alt="Business logo preview" />
          )}
          <label className="btn btn-secondary btn-sm template-editor-upload-btn">
            {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
            <input type="file" accept="image/jpeg,image/png" onChange={handleLogoChange} disabled={uploadingLogo} style={{ display: 'none' }} />
          </label>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tpl-contact-name">Business Name</label>
            <input id="tpl-contact-name" value={value.contact_name || ''} onChange={(e) => set({ contact_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="tpl-contact-email">Email</label>
            <input id="tpl-contact-email" type="email" value={value.contact_email || ''} onChange={(e) => set({ contact_email: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tpl-contact-phone">Phone</label>
            <input id="tpl-contact-phone" value={value.contact_phone || ''} onChange={(e) => set({ contact_phone: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="tpl-contact-address">Address</label>
            <input id="tpl-contact-address" value={value.contact_address || ''} onChange={(e) => set({ contact_address: e.target.value })} />
          </div>
        </div>
      </fieldset>

      <fieldset className="template-editor-fieldset">
        <legend>Invoice Fields</legend>
        <p className="template-editor-hint">Show or hide fields, and mark which ones are required.</p>
        {sortedFields.map((f) => (
          <div key={f.id} className="template-editor-field-row">
            <span className="template-editor-field-label">{f.label}</span>
            <label className="template-editor-checkbox">
              <input type="checkbox" checked={f.visible} onChange={(e) => updateField(f.id, { visible: e.target.checked, required: e.target.checked ? f.required : false })} />
              Show
            </label>
            <label className="template-editor-checkbox">
              <input type="checkbox" checked={f.required} disabled={!f.visible} onChange={(e) => updateField(f.id, { required: e.target.checked })} />
              Required
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="template-editor-fieldset">
        <legend>Payment &amp; Tax</legend>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="tpl-payment-terms">Default Payment Terms</label>
            <textarea id="tpl-payment-terms" rows={2} value={value.payment_terms || ''} onChange={(e) => set({ payment_terms: e.target.value })} placeholder="e.g. Due within 30 days" />
          </div>
          <div className="form-group" style={{ maxWidth: 160 }}>
            <label htmlFor="tpl-tax-rate">Tax Rate (%)</label>
            <input
              id="tpl-tax-rate" type="number" min="0" max="100" step="0.01"
              value={value.tax_rate ?? 0}
              onChange={(e) => set({ tax_rate: e.target.value })}
            />
          </div>
        </div>
        <p className="template-editor-hint">Applied as a flat percentage to the line-item subtotal — set this to your actual local rate; it's never inferred automatically.</p>
      </fieldset>

      <fieldset className="template-editor-fieldset">
        <legend>Optional Sections</legend>
        <div className="template-editor-features-grid">
          {[
            ['claim_number', 'Claim Number'], ['po_reference', 'PO Reference'],
            ['photos', 'Photos'], ['receipts', 'Receipts'], ['notes', 'Notes'],
          ].map(([key, label]) => (
            <label key={key} className="template-editor-checkbox">
              <input type="checkbox" checked={!!features[key]} onChange={(e) => setFeature(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <details className="template-editor-advanced">
        <summary>Advanced settings</summary>
        <p className="template-editor-hint">Control which fields appear on the customer-facing PDF vs. stay internal-only.</p>
        {sortedFields.map((f) => (
          <label key={f.id} className="template-editor-checkbox">
            <input type="checkbox" checked={f.customerVisible} onChange={(e) => updateField(f.id, { customerVisible: e.target.checked })} />
            Show &quot;{f.label}&quot; on customer PDF
          </label>
        ))}
      </details>
    </div>
  );
}
