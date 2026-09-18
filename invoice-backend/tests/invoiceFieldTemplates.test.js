const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1' });

describe('GET /api/invoice-field-templates/:id — cross-tenant isolation', () => {
  test('a template belonging to a different org is a 404, not a 403 (never confirms it exists)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // org-scoped WHERE finds nothing for org-1

    const res = await request(app, { method: 'GET', url: '/api/invoice-field-templates/tmpl-owned-by-org-2', token: ownerToken });

    expect(res.status).toBe(404);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['tmpl-owned-by-org-2', 'org-1']);
  });
});

describe('POST /api/invoice-field-templates', () => {
  test('owner can create a manual template, seeded from the industry preset when fields are omitted', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'tmpl-1', name: 'My HVAC Template', industry_key: 'hvac' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoice-field-templates', token: ownerToken,
      body: { name: 'My HVAC Template', industry_key: 'hvac' },
    });

    expect(res.status).toBe(201);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO invoice_field_templates');
    expect(JSON.parse(params[11])[0].id).toBe('equipment_type'); // seeded from hvac preset
  });

  test('worker cannot create a template', async () => {
    const res = await request(app, { method: 'POST', url: '/api/invoice-field-templates', token: workerToken, body: { name: 'x' } });
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/invoice-field-templates/:id/set-default', () => {
  test('unsets the old default and sets the new one inside one transaction', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'tmpl-2' }] }) // target lookup
        .mockResolvedValueOnce({}) // unset old default
        .mockResolvedValueOnce({ rows: [{ id: 'tmpl-2', is_default: true }] }) // set new default
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValueOnce(client);

    const res = await request(app, { method: 'POST', url: '/api/invoice-field-templates/tmpl-2/set-default', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.is_default).toBe(true);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining('is_default = false'), ['org-1']);
    expect(client.query).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('rolls back and releases the client on error', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockImplementation((sql) => {
      if (sql === 'BEGIN') return Promise.resolve({});
      if (sql === 'ROLLBACK') return Promise.resolve({});
      return Promise.reject(new Error('boom'));
    });
    db.pool.connect.mockResolvedValueOnce(client);

    const res = await request(app, { method: 'POST', url: '/api/invoice-field-templates/tmpl-2/set-default', token: ownerToken });

    expect(res.status).toBe(500);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('DELETE /api/invoice-field-templates/:id — archive', () => {
  test('blocks archiving the current default', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'tmpl-1', is_default: true }] });

    const res = await request(app, { method: 'DELETE', url: '/api/invoice-field-templates/tmpl-1', token: ownerToken });

    expect(res.status).toBe(409);
  });

  test('archives a non-default template', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tmpl-2', is_default: false }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app, { method: 'DELETE', url: '/api/invoice-field-templates/tmpl-2', token: ownerToken });

    expect(res.status).toBe(204);
    expect(db.query.mock.calls[1][0]).toContain('is_archived = true');
  });
});
