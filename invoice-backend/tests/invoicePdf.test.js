const zlib = require('node:zlib');
const { PDFDocument } = require('pdf-lib');
const { generateInvoicePdf } = require('../src/services/invoicePdf');

// pdf-lib Flate-compresses stream objects (content streams, object
// streams) by default, so the text this service draws isn't literally
// present as ASCII in the raw buffer. Extract every stream...endstream
// block and inflate it, so assertions can check the actual decoded text
// pdf-lib would render, not the compressed bytes.
function extractDecodedText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRe.exec(raw))) {
    const streamBytes = Buffer.from(match[1], 'latin1');
    try {
      chunks.push(zlib.inflateSync(streamBytes).toString('latin1'));
    } catch {
      chunks.push(match[1]); // not Flate-compressed (or not valid deflate) — use as-is
    }
  }
  let combined = chunks.join('\n');

  // pdf-lib draws text as hex-encoded strings (`<...> Tj`), not literal
  // `(...)` ASCII — decode every hex-string token too so drawn text is
  // actually searchable.
  const hexDecoded = [...combined.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
    .join('\n');

  return `${combined}\n${hexDecoded}`;
}

const snapshot = {
  contact_name: 'Acme Electrical', contact_email: 'billing@acme.test', contact_phone: null, contact_address: null,
  payment_terms: 'Due within 30 days', optional_features: { claim_number: true, po_reference: false, photos: true, receipts: false, notes: true },
  fields: [
    { id: 'service_address', label: 'Service Address', type: 'text', visible: true, required: true, order: 10, customerVisible: true },
    // Internal-only field: visible but explicitly NOT customer-visible —
    // must never appear on the rendered PDF.
    { id: 'internal_tech_notes', label: 'Internal Tech Notes', type: 'text', visible: true, required: false, order: 20, customerVisible: false },
  ],
};

const invoice = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', created_at: new Date('2026-01-15').toISOString(), tax_rate: '10' };
const claim = { claim_number: 'C-1001', customer_name: 'Jane Homeowner', job_address: '123 Main St', customer_phone: '555-1234' };

// A decoy shaped exactly like a real invoice_line_items row that has been
// billed via part_purchases — includes the internal `cost` field the
// caller's SELECT is supposed to have already excluded. Feeding it in here
// directly tests that generateInvoicePdf itself never reads/renders that
// field, as a second line of defense even if a future caller's query
// regresses and starts including it.
const lineItems = [
  { id: 'li-1', description: 'Replace outlet', quantity: 1, unit: null, unit_price: '150.00', total_price: '150.00', cost: '9999.99' },
];

describe('generateInvoicePdf', () => {
  test('produces a valid, loadable single-page PDF', async () => {
    const buffer = await generateInvoicePdf({ invoice, claim, lineItems, snapshot, fieldValues: { service_address: '123 Main St', internal_tech_notes: 'do not show this' } });
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const loaded = await PDFDocument.load(buffer);
    expect(loaded.getPageCount()).toBe(1);
  });

  test('never renders the internal cost figure from a line item', async () => {
    const buffer = await generateInvoicePdf({ invoice, claim, lineItems, snapshot, fieldValues: {} });
    const text = extractDecodedText(buffer);
    expect(text).not.toContain('9999.99');
  });

  test('never renders a field marked customerVisible:false, even if a value was supplied', async () => {
    const buffer = await generateInvoicePdf({ invoice, claim, lineItems, snapshot, fieldValues: { internal_tech_notes: 'SECRET-MARKER-VALUE' } });
    const text = extractDecodedText(buffer);
    expect(text).not.toContain('SECRET-MARKER-VALUE');
    expect(text).not.toContain('Internal Tech Notes');
  });

  test('renders the customer-visible field and the computed total', async () => {
    const buffer = await generateInvoicePdf({ invoice, claim, lineItems, snapshot, fieldValues: { service_address: '123 Main St' } });
    const text = extractDecodedText(buffer);
    expect(text).toContain('Service Address');
    // subtotal 150.00 + 10% tax = 165.00
    expect(text).toContain('165.00');
  });

  test('renders the service call fee for a qualifying industry (electrical)', async () => {
    const invoiceWithFee = { ...invoice, service_call_fee: '75.00', payment_method: 'card' };
    const electricalSnapshot = { ...snapshot, industry_key: 'electrical' };
    const buffer = await generateInvoicePdf({ invoice: invoiceWithFee, claim, lineItems, snapshot: electricalSnapshot, fieldValues: {} });
    const text = extractDecodedText(buffer);
    expect(text).toContain('Service call fee');
    expect(text).toContain('75.00');
    expect(text).toContain('Paid by');
    // subtotal 150 + 10% tax (15) + 75 fee = 240.00
    expect(text).toContain('240.00');
  });

  test('never renders a service call fee for a non-qualifying industry (flooring)', async () => {
    const invoiceWithFee = { ...invoice, service_call_fee: '75.00', payment_method: 'card' };
    const flooringSnapshot = { ...snapshot, industry_key: 'flooring' };
    const buffer = await generateInvoicePdf({ invoice: invoiceWithFee, claim, lineItems, snapshot: flooringSnapshot, fieldValues: {} });
    const text = extractDecodedText(buffer);
    expect(text).not.toContain('Service call fee');
    expect(text).not.toContain('Paid by');
    // the fee must not be silently folded into the total either: 150 + 10% tax = 165.00, not 240.00
    expect(text).toContain('165.00');
    expect(text).not.toContain('240.00');
  });

  test('gracefully skips a logo that fails to embed rather than failing the whole PDF', async () => {
    const snapshotWithBadLogo = { ...snapshot, logo_blob_url: 'https://storage.example/private/logos/does-not-exist.png' };
    // azureBlob.downloadBuffer is globally mocked (tests/setup.js) to throw
    // 'Unexpected Azure call' for any un-stubbed invocation — exercising
    // exactly the failure path this test is checking.
    const buffer = await generateInvoicePdf({ invoice, claim, lineItems, snapshot: snapshotWithBadLogo, fieldValues: {} });
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });
});
