const app = require('../src/app');
const db = require('../src/db');
const azure = require('../src/services/azureBlob');
const { signTestToken, request } = require('./helpers');

describe('GET /api/documents', () => {
  test('worker sees a merged, date-sorted feed scoped to their own work', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'p1', blob_url: 'https://x/photos/1.jpg', doc_date: '2026-01-02T00:00:00Z', claim_number: 'C-1', claim_title: 'Job 1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', blob_url: 'https://x/receipts/1.jpg', doc_date: '2026-01-03T00:00:00Z', claim_number: 'C-2', claim_title: 'Job 2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'i1', blob_url: 'https://x/invoice-pdfs/1.pdf', doc_date: '2026-01-01T00:00:00Z', claim_number: 'C-3', claim_title: 'Job 3' }] });
    azure.generateSasUrl.mockImplementation((url) => `${url}?sas=1`);

    const res = await request(app, { method: 'GET', url: '/api/documents', token: signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-1' }) });

    expect(res.status).toBe(200);
    expect(res.body.map((d) => d.type)).toEqual(['receipt', 'photo', 'invoice_pdf']); // date-desc
    expect(res.body.every((d) => d.sas_url.endsWith('?sas=1'))).toBe(true);

    // Worker's queries are org+technician/assignee scoped (2 params each).
    for (const [, params] of db.query.mock.calls) {
      expect(params).toEqual(['org-1', 'member-1']);
    }
  });

  test('owner sees the whole org (1-param, no technician/assignee filter)', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app, { method: 'GET', url: '/api/documents', token: signTestToken({ role: 'owner', organizationId: 'org-1' }) });
    expect(res.status).toBe(200);
    for (const [, params] of db.query.mock.calls) {
      expect(params).toEqual(['org-1']);
    }
  });
});
