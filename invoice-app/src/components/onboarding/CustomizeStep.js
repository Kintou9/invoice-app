import { useState } from 'react';
import TemplateEditorForm from '../templates/TemplateEditorForm';
import InvoiceTemplatePreview from '../templates/InvoiceTemplatePreview';
import './CustomizeStep.css';

export default function CustomizeStep({ draft, onChange, onUseDefaults, onSaveAndContinue, saving }) {
  const [mobileView, setMobileView] = useState('edit');

  return (
    <div className="customize-step">
      <h1>Customize your invoice</h1>
      <p className="business-type-subtitle">Set up your branding and fields — you can change this any time from Settings.</p>

      <div className="customize-step-mobile-toggle">
        <button type="button" className={mobileView === 'edit' ? 'active' : ''} aria-pressed={mobileView === 'edit'} onClick={() => setMobileView('edit')}>Edit</button>
        <button type="button" className={mobileView === 'preview' ? 'active' : ''} aria-pressed={mobileView === 'preview'} onClick={() => setMobileView('preview')}>Preview</button>
      </div>

      <div className="customize-step-layout">
        <div className={`customize-step-editor ${mobileView === 'preview' ? 'hide-on-mobile' : ''}`}>
          <TemplateEditorForm value={draft} onChange={onChange} />
        </div>
        <div className={`customize-step-preview ${mobileView === 'edit' ? 'hide-on-mobile' : ''}`}>
          <InvoiceTemplatePreview template={draft} />
        </div>
      </div>

      <div className="business-type-actions">
        <button type="button" className="btn btn-secondary" onClick={onUseDefaults} disabled={saving}>
          Use defaults
        </button>
        <button type="button" className="btn btn-primary" onClick={onSaveAndContinue} disabled={saving}>
          {saving ? 'Saving...' : 'Save and continue'}
        </button>
      </div>
    </div>
  );
}
