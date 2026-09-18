const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

describe('GET /api/audit-log — role gating', () => {
  test('owner can read the org audit log', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'create', entity_type: 'claim' }] });
    const res = await request(app, { method: 'GET', url: '/api/audit-log', token: signTestToken({ role: 'owner' }) });
    expect(res.status).toBe(200);
  });

  test('manager can also read the org audit log', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app, { method: 'GET', url: '/api/audit-log', token: signTestToken({ role: 'manager' }) });
    expect(res.status).toBe(200);
  });

  test('worker is forbidden', async () => {
    const res = await request(app, { method: 'GET', url: '/api/audit-log', token: signTestToken({ role: 'worker' }) });
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
