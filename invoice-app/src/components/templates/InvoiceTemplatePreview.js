import './InvoiceTemplatePreview.css';

// Renders a template (or an invoice's frozen field_template_snapshot) as a
// mock invoice. Deliberately mirrors the layout the backend's
// generateInvoicePdf service draws (services/invoicePdf.js), so the
// on-screen preview never drifts from what the generated PDF actually
// shows — one shape, one preview, one PDF renderer, no separate preview
// data model to keep in sync.
export default function InvoiceTemplatePreview({ template, logoPreviewUrl, fieldValues = {} }) {
  if (!template) return null;

  const visibleFields = (template.fields || [])
    .filter((f) => f.visible)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const features = template.optional_features || {};

  return (
    <div className="template-preview" role="img" aria-label={`Preview of ${template.name || 'invoice'} template`}>
      <div className="template-preview-header">
        {(logoPreviewUrl || template.logo_blob_url) && (
          <img className="template-preview-logo" src={logoPreviewUrl || template.logo_blob_url} alt="Business logo" />
        )}
        <div>
          <div className="template-preview-business">{template.contact_name || 'Your Business Name'}</div>
          {template.contact_email && <div className="template-preview-contact">{template.contact_email}</div>}
          {template.contact_phone && <div className="template-preview-contact">{template.contact_phone}</div>}
          {template.contact_address && <div className="template-preview-contact">{template.contact_address}</div>}
        </div>
      </div>

      <div className="template-preview-meta">
        <span>Invoice #ABCD1234</span>
        {features.claim_number && <span>Claim #: C-1001</span>}
        {features.po_reference && <span>PO Reference: —</span>}
      </div>

      {visibleFields.length > 0 && (
        <div className="template-preview-section">
          <h4>Job Details</h4>
          {visibleFields.map((f) => (
            <div key={f.id} className="template-preview-field">
              <span className="template-preview-field-label">
                {f.label}{f.required ? ' *' : ''}
                {!f.customerVisible && <span className="template-preview-internal-tag">internal only</span>}
              </span>
              <span className="template-preview-field-value">{fieldValues[f.id] || '—'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="template-preview-section">
        <h4>Line Items</h4>
        <div className="template-preview-line-item">
          <span>Sample service</span><span>$100.00</span>
        </div>
        <div className="template-preview-totals">
          <div>Subtotal: $100.00</div>
          {Number(template.tax_rate) > 0 && <div>Tax ({template.tax_rate}%): ${(100 * Number(template.tax_rate) / 100).toFixed(2)}</div>}
          <strong>Total: ${(100 + 100 * Number(template.tax_rate || 0) / 100).toFixed(2)}</strong>
        </div>
      </div>

      {template.payment_terms && (
        <div className="template-preview-section">
          <h4>Payment Terms</h4>
          <p>{template.payment_terms}</p>
        </div>
      )}
    </div>
  );
}
