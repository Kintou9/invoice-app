const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-2' });

describe('POST /api/invoice-line-items', () => {
  test("creates a line item on a draft invoice belonging to the caller's org", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', technician_id: 'member-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'li-1', description: 'Copper pipe', quantity: 2, unit_price: '15.00', total_price: '30.00' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoice-line-items', token: ownerToken,
      body: { invoice_id: 'inv-1', description: 'Copper pipe', quantity: 2, unit_price: 15 },
    });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('cost');
  });

  test('blocked on an approved invoice', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', technician_id: 'member-1', status: 'approved' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoice-line-items', token: ownerToken,
      body: { invoice_id: 'inv-1', description: 'x', quantity: 1, unit_price: 1 },
    });

    expect(res.status).toBe(409);
  });

  test('a worker cannot add a line item to an invoice assigned to someone else', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', technician_id: 'member-1', status: 'draft' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoice-line-items', token: workerToken,
      body: { invoice_id: 'inv-1', description: 'x', quantity: 1, unit_price: 1 },
    });

    expect(res.status).toBe(403);
  });

  test('an invoice from a different org is a 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoice-line-items', token: ownerToken,
      body: { invoice_id: 'inv-in-other-org', description: 'x', quantity: 1, unit_price: 1 },
    });

    expect(res.status).toBe(404);
  });
});

test('no query in this route file ever selects the internal cost column', () => {
  const routeSource = require('fs').readFileSync(`${__dirname}/../src/routes/invoiceLineItems.js`, 'utf8');
  // A crude but effective regression guard: strip comment lines (which are
  // allowed to explain *why* cost is excluded), then assert the word
  // "cost" never appears in the remaining executable source at all — not
  // just inside query template strings, so it also catches a future
  // SAFE_COLUMNS edit.
  const codeOnly = routeSource
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  expect(codeOnly.toLowerCase()).not.toMatch(/\bcost\b/);
});
