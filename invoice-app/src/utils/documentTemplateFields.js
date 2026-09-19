// The fixed catalog of real Trackly fields a detected/added template field
// can be mapped to — single source for the "Maps to" dropdown and for
// telling text fields apart from the table/signature/photo types that need
// different handling in the mapping canvas and the generator. Matches
// resolveDocumentFieldValue() in invoice-backend/src/routes/invoices.js.
export const DOCUMENT_FIELD_CATALOG = [
  { key: 'invoice_number', label: 'Invoice number', type: 'text' },
  { key: 'invoice_date', label: 'Invoice date', type: 'text' },
  { key: 'due_date', label: 'Due date', type: 'text' },
  { key: 'job_number', label: 'Job number', type: 'text' },
  { key: 'claim_number', label: 'Claim number', type: 'text' },
  { key: 'customer_name', label: 'Customer name', type: 'text' },
  { key: 'customer_phone', label: 'Customer phone', type: 'text' },
  { key: 'customer_email', label: 'Customer email', type: 'text' },
  { key: 'service_address', label: 'Service address', type: 'text' },
  { key: 'billing_address', label: 'Billing address', type: 'text' },
  { key: 'technician', label: 'Technician', type: 'text' },
  { key: 'work_performed', label: 'Work performed', type: 'text' },
  { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
  { key: 'parts', label: 'Parts', type: 'table' },
  { key: 'labor', label: 'Labor', type: 'table' },
  { key: 'tax', label: 'Tax', type: 'text' },
  { key: 'subtotal', label: 'Subtotal', type: 'text' },
  { key: 'total', label: 'Total', type: 'text' },
  { key: 'balance_due', label: 'Balance due', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
  { key: 'customer_signature', label: 'Customer signature', type: 'signature' },
  { key: 'technician_signature', label: 'Technician signature', type: 'signature' },
  { key: 'photos', label: 'Photos / attachments', type: 'photo' },
];

export const DOCUMENT_FIELD_LABELS = Object.fromEntries(DOCUMENT_FIELD_CATALOG.map((f) => [f.key, f.label]));

export function fieldTypeForKey(key) {
  return DOCUMENT_FIELD_CATALOG.find((f) => f.key === key)?.type || 'text';
}
