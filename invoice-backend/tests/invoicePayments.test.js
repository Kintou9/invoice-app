const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-2' });

describe('POST /api/invoices/:id/payments', () => {
  test('records a payment within the remaining balance on an approved invoice', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'approved', service_call_fee: '25.00' }] })
      .mockResolvedValueOnce({ rows: [{ total: '100.00' }] }) // line items sum
      .mockResolvedValueOnce({ rows: [{ paid: '0' }] }) // already paid
      .mockResolvedValueOnce({ rows: [{ id: 'pay-1', amount: '75.00', method: 'card' }] }); // insert

    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: ownerToken,
      body: { amount: 75, method: 'card' },
    });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe('75.00');
  });

  test('rejects a payment that exceeds the remaining balance', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'approved', service_call_fee: '0' }] })
      .mockResolvedValueOnce({ rows: [{ total: '100.00' }] })
      .mockResolvedValueOnce({ rows: [{ paid: '60.00' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: ownerToken,
      body: { amount: 50 },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remaining balance/);
  });

  test('rejects a payment against a non-approved invoice', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', service_call_fee: '0' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: ownerToken,
      body: { amount: 10 },
    });

    expect(res.status).toBe(409);
  });

  test('rejects a non-positive amount before touching the database', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: ownerToken,
      body: { amount: 0 },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects an invalid payment method', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: ownerToken,
      body: { amount: 10, method: 'bitcoin' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a worker cannot record a payment', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/invoices/inv-1/payments', token: workerToken,
      body: { amount: 10 },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/invoices/:id/payments/:paymentId', () => {
  test('owner can remove a mis-recorded payment', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'pay-1', amount: '75.00' }] });

    const res = await request(app, {
      method: 'DELETE', url: '/api/invoices/inv-1/payments/pay-1', token: ownerToken,
    });

    expect(res.status).toBe(204);
  });

  test('a manager cannot delete a payment (owner-only)', async () => {
    const managerToken = signTestToken({ role: 'manager', organizationId: 'org-1', membershipId: 'member-3' });

    const res = await request(app, {
      method: 'DELETE', url: '/api/invoices/inv-1/payments/pay-1', token: managerToken,
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a payment from a different org is a 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, {
      method: 'DELETE', url: '/api/invoices/inv-1/payments/pay-in-other-org', token: ownerToken,
    });

    expect(res.status).toBe(404);
  });
});
