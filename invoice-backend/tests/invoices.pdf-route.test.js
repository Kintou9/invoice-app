const app = require('../src/app');
const db = require('../src/db');
const azure = require('../src/services/azureBlob');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1' });

describe('GET /api/invoices/:id/pdf', () => {
  test('404 when no PDF has been generated yet', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ pdf_blob_url: null, technician_id: 'member-1' }] });

    const res = await request(app, { method: 'GET', url: '/api/invoices/inv-1/pdf', token: ownerToken });

    expect(res.status).toBe(404);
  });

  test('returns a SAS URL when a PDF already exists', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ pdf_blob_url: 'https://storage.example/invoice-pdfs/org-1/inv-1.pdf', technician_id: 'member-1' }] });
    azure.generateSasUrl.mockReturnValueOnce('https://storage.example/invoice-pdfs/org-1/inv-1.pdf?sas=token');

    const res = await request(app, { method: 'GET', url: '/api/invoices/inv-1/pdf', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.pdf_url).toContain('sas=token');
  });

  test('an invoice belonging to a different org is a 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'GET', url: '/api/invoices/inv-in-other-org/pdf', token: ownerToken });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/invoices/:id/generate-pdf', () => {
  test('blocked while the invoice is still a draft', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1', claim_number: 'C-1', customer_name: 'Jane', customer_phone: null, job_address: null }],
    });

    const res = await request(app, { method: 'POST', url: '/api/invoices/inv-1/generate-pdf', token: ownerToken });

    expect(res.status).toBe(400);
  });

  test('regenerates and returns a SAS URL for a submitted invoice with no template (no line items, minimal render)', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'inv-1', status: 'submitted', technician_id: 'member-1', created_at: new Date().toISOString(), tax_rate: '0',
          field_template_snapshot: null, field_values: {},
          claim_number: 'C-1', customer_name: 'Jane', customer_phone: null, job_address: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // line items lookup inside generateAndStorePdf
      .mockResolvedValueOnce({ rows: [] }); // UPDATE invoices SET pdf_blob_url

    azure.uploadBuffer.mockResolvedValueOnce('https://storage.example/invoice-pdfs/org-1/inv-1.pdf');
    azure.generateSasUrl.mockReturnValueOnce('https://storage.example/invoice-pdfs/org-1/inv-1.pdf?sas=token');

    const res = await request(app, { method: 'POST', url: '/api/invoices/inv-1/generate-pdf', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.pdf_url).toContain('sas=token');
    expect(azure.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'invoice-inv-1.pdf', 'invoice-pdfs/org-1');
  });
});
