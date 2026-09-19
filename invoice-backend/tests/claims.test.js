const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const workerToken = signTestToken({ role: 'worker', membershipId: 'member-1' });

describe('PATCH /api/claims/:id — worker permissions', () => {
  test('worker can move their own claim between open and in_progress', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ assigned_to: 'member-1' }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1', status: 'in_progress' }] }); // update

    const res = await request(app, {
      method: 'PATCH', url: '/api/claims/claim-1', token: workerToken, body: { status: 'in_progress' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('worker cannot set a manager-only status like approved', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/claims/claim-1', token: workerToken, body: { status: 'approved' },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('worker cannot reassign or retitle a claim', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/claims/claim-1', token: workerToken, body: { assigned_to: 'member-2' },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('worker cannot patch a claim assigned to someone else', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ assigned_to: 'someone-else' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/claims/claim-1', token: workerToken, body: { status: 'in_progress' },
    });

    expect(res.status).toBe(403);
  });

  test('worker can correct customer details found on site', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ assigned_to: 'member-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1', customer_phone: '555-1234' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/claims/claim-1', token: workerToken, body: { customer_phone: '555-1234' },
    });

    expect(res.status).toBe(200);
    expect(res.body.customer_phone).toBe('555-1234');
  });
});
