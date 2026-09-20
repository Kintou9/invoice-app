const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-2' });
const viewerToken = signTestToken({ role: 'viewer', organizationId: 'org-1', membershipId: 'member-3' });

// Regression coverage for POST /api/parts — the canonical endpoint the
// Invoice Detail "AI Suggest Parts" Add button now calls, replacing the
// nonexistent POST /invoices/:id/parts (see InvoiceDetailPage.js and
// InvoiceDetailPage.test.js for the frontend half of this fix).
describe('POST /api/parts', () => {
  test("adds a part to a draft invoice belonging to the caller's org", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'part-1', invoice_id: 'inv-1', name: 'Compressor', part_number: 'C-100', quantity: 1, notes: null }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor', part_number: 'C-100', quantity: 1, notes: null },
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Compressor');
  });

  test('a worker can add a part to their own assigned invoice', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'part-1', name: 'Fan motor' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: workerToken,
      body: { invoice_id: 'inv-1', name: 'Fan motor' },
    });

    expect(res.status).toBe(201);
  });

  test('rejects an invalid payload — missing name', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-1' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects a non-positive or non-integer quantity', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor', quantity: -1 },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('404s when the invoice does not exist (also covers a cross-tenant invoice_id)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // org-scoped lookup finds nothing

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-from-another-org', name: 'Compressor' },
    });

    expect(res.status).toBe(404);
  });

  test('a worker cannot add a part to an invoice assigned to someone else', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: workerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor' },
    });

    expect(res.status).toBe(403);
  });

  test('a viewer cannot add a part at all', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: viewerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor' },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('blocked once the invoice is no longer editable (submitted)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'submitted', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor' },
    });

    expect(res.status).toBe(409);
  });

  test('blocked on an approved invoice', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'approved', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts', token: ownerToken,
      body: { invoice_id: 'inv-1', name: 'Compressor' },
    });

    expect(res.status).toBe(409);
  });

  // Two independent, deliberate calls (e.g. two different real parts, or a
  // legitimate resend) must both succeed — the endpoint has no artificial
  // dedup that would reject a second genuine part. Accidental double-clicks
  // are prevented client-side instead (see InvoiceDetailPage.test.js's
  // disabled-while-pending test) since the server can't distinguish a
  // deliberate repeat from an accidental one.
  test('two sequential valid requests both succeed independently', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'part-1', name: 'Compressor' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'part-2', name: 'Compressor' }] });

    const first = await request(app, { method: 'POST', url: '/api/parts', token: ownerToken, body: { invoice_id: 'inv-1', name: 'Compressor' } });
    const second = await request(app, { method: 'POST', url: '/api/parts', token: ownerToken, body: { invoice_id: 'inv-1', name: 'Compressor' } });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });
});

// POST /api/parts/bulk — used by PartsSection.js's own separate AI-suggest
// flow (handleAiSuggest). Same security boundary as POST /api/parts above,
// so it gets the same protections, plus atomicity across the whole batch.
describe('POST /api/parts/bulk', () => {
  // db.query and db.pool.connect share one mock in tests/setup.js — a
  // pool.connect() call always has zero arguments (sql === undefined),
  // which is how this branches the invoice-lookup query from the
  // transaction client hand-off. See tests/users.test.js for the same
  // established pattern.
  function mockInvoiceLookupThenClient(invoiceRow, client) {
    db.query.mockImplementation((sql) => (sql === undefined ? Promise.resolve(client) : Promise.resolve({ rows: invoiceRow ? [invoiceRow] : [] })));
  }

  function fakeClient(insertedRows) {
    const rows = [...insertedRows];
    return {
      query: jest.fn().mockImplementation((sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
        return Promise.resolve({ rows: [rows.shift()] }); // one INSERT ... RETURNING * call
      }),
      release: jest.fn(),
    };
  }

  test('an owner can bulk-add multiple parts', async () => {
    const client = fakeClient([{ id: 'part-1', name: 'Compressor' }, { id: 'part-2', name: 'Fan motor' }]);
    mockInvoiceLookupThenClient({ id: 'inv-1', status: 'draft', technician_id: 'member-1' }, client);

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }, { name: 'Fan motor' }] },
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('a worker can bulk-add to their own assigned invoice', async () => {
    const client = fakeClient([{ id: 'part-1', name: 'Compressor' }]);
    mockInvoiceLookupThenClient({ id: 'inv-1', status: 'draft', technician_id: 'member-2' }, client);

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: workerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(201);
  });

  test('a viewer is rejected with 403', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: viewerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("a worker is rejected from another worker's invoice", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: workerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(403);
  });

  test('a cross-tenant invoice is rejected with 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-in-other-org', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(404);
  });

  test('a missing invoice is rejected with 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'does-not-exist', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(404);
  });

  test('a submitted invoice is rejected with 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'submitted', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(409);
  });

  test('an approved invoice is rejected with 409', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'approved', technician_id: 'member-1' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }] },
    });

    expect(res.status).toBe(409);
  });

  test('an empty parts array is rejected', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [] },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a malformed item (no name) is rejected before any insert', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }, { part_number: 'no-name-here' }] },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('an invalid quantity on any item is rejected before any insert', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }, { name: 'Fan motor', quantity: -3 }] },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rolls back the whole batch if one insert fails partway through — no partial persistence', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'part-1', name: 'Compressor' }] }) // first INSERT succeeds
        .mockRejectedValueOnce(new Error('simulated DB failure on second insert'))
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: jest.fn(),
    };
    mockInvoiceLookupThenClient({ id: 'inv-1', status: 'draft', technician_id: 'member-1' }, client);

    const res = await request(app, {
      method: 'POST', url: '/api/parts/bulk', token: ownerToken,
      body: { invoice_id: 'inv-1', parts: [{ name: 'Compressor' }, { name: 'Fan motor' }] },
    });

    expect(res.status).toBe(500);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
