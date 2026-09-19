const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-owner', id: 'user-owner' });
const managerToken = signTestToken({ role: 'manager', organizationId: 'org-1', membershipId: 'member-mgr', id: 'user-mgr' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-worker', id: 'user-worker' });
const viewerToken = signTestToken({ role: 'viewer', organizationId: 'org-1', membershipId: 'member-viewer', id: 'user-viewer' });

describe('POST /api/users — invite', () => {
  test('a manager can invite (not owner-only anymore)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // no existing user with this email
      .mockResolvedValueOnce({ rows: [{ id: 'new-user', name: 'new@example.com' }] }) // insert user
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'invited', joined_at: null }] }) // insert membership
      .mockResolvedValueOnce({ rows: [] }) // logAction's own INSERT INTO audit_log
      .mockResolvedValueOnce({ rows: [{ name: 'Acme' }] }); // org lookup

    const res = await request(app, {
      method: 'POST', url: '/api/users', token: managerToken,
      body: { email: 'new@example.com', role: 'worker' },
    });

    // email sending isn't mocked/stubbed here so it'll fail — that's fine,
    // the route degrades to 201 + emailError rather than throwing.
    expect([201]).toContain(res.status);
  });

  test('owner is never an invitable role', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users', token: ownerToken,
      body: { email: 'new@example.com', role: 'owner' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a worker cannot invite anyone', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users', token: workerToken,
      body: { email: 'new@example.com', role: 'worker' },
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a viewer cannot invite anyone', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users', token: viewerToken,
      body: { email: 'new@example.com', role: 'worker' },
    });

    expect(res.status).toBe(403);
  });

  test('viewer is a valid invitable role', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-user', name: 'new@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'viewer', status: 'invited', joined_at: null }] })
      .mockResolvedValueOnce({ rows: [] }) // logAction
      .mockResolvedValueOnce({ rows: [{ name: 'Acme' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/users', token: ownerToken,
      body: { email: 'new@example.com', role: 'viewer' },
    });

    expect([201]).toContain(res.status);
  });

  test('rejects an invalid expires_in_days', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users', token: ownerToken,
      body: { email: 'new@example.com', role: 'worker', expires_in_days: 3 },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/users/:id — role changes', () => {
  test('rejects promoting anyone to owner', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/users/user-target', token: ownerToken, body: { role: 'owner' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("rejects changing the owner's role", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem-owner-2', role: 'owner', status: 'active' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/users/user-target', token: managerToken, body: { role: 'worker' },
    });

    expect(res.status).toBe(400);
  });

  test('a manager can promote a worker to manager', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'manager', status: 'active', joined_at: null }] })
      .mockResolvedValueOnce({ rows: [] }) // logAction
      .mockResolvedValueOnce({ rows: [{ id: 'user-target', name: 'Jamie', email: 'jamie@example.com' }] });

    const res = await request(app, {
      method: 'PATCH', url: '/api/users/user-target', token: managerToken, body: { role: 'manager' },
    });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('manager');
  });

  test('rejects an unknown role value', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/users/user-target', token: ownerToken, body: { role: 'superadmin' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a worker cannot change anyone\'s role', async () => {
    const res = await request(app, {
      method: 'PATCH', url: '/api/users/user-target', token: workerToken, body: { role: 'manager' },
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/suspend', () => {
  test('cannot suspend yourself', async () => {
    // caller id (from the JWT) === req.params.id
    const res = await request(app, { method: 'POST', url: '/api/users/user-owner/suspend', token: ownerToken });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('cannot suspend the owner', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem-owner-2', role: 'owner', status: 'active' }] });

    const res = await request(app, { method: 'POST', url: '/api/users/some-owner/suspend', token: managerToken });

    expect(res.status).toBe(400);
  });

  test('suspends an active worker', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] }) // the UPDATE
      .mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'POST', url: '/api/users/user-target/suspend', token: managerToken });

    expect(res.status).toBe(200);
  });

  test('rejects suspending an already-disabled member', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'disabled' }] });

    const res = await request(app, { method: 'POST', url: '/api/users/user-target/suspend', token: managerToken });

    expect(res.status).toBe(409);
  });

  test('a viewer cannot suspend anyone', async () => {
    const res = await request(app, { method: 'POST', url: '/api/users/user-target/suspend', token: viewerToken });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/reactivate', () => {
  test('reactivates a disabled member', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'disabled' }] })
      .mockResolvedValueOnce({ rows: [] }) // the UPDATE
      .mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'POST', url: '/api/users/user-target/reactivate', token: ownerToken });

    expect(res.status).toBe(200);
  });

  test('rejects reactivating an already-active member', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'active' }] });

    const res = await request(app, { method: 'POST', url: '/api/users/user-target/reactivate', token: ownerToken });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/users/:id — cancel invite vs remove member', () => {
  test('cannot remove yourself', async () => {
    const res = await request(app, { method: 'DELETE', url: '/api/users/user-owner', token: ownerToken });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('cannot remove the owner', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem-owner-2', role: 'owner', status: 'active' }] });

    const res = await request(app, { method: 'DELETE', url: '/api/users/some-owner', token: managerToken });

    expect(res.status).toBe(400);
  });

  test('a still-pending invite is hard-deleted (cancel)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'invited' }] })
      .mockResolvedValueOnce({ rows: [] }) // the DELETE
      .mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target', token: ownerToken });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[1][0]).toMatch(/^DELETE FROM organization_members/);
  });

  test('an active member is soft-removed, not hard-deleted', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] }) // the UPDATE
      .mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target', token: ownerToken });

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[1][0]).toMatch(/^UPDATE organization_members SET status = 'removed'/);
  });

  test('a worker cannot remove anyone', async () => {
    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target', token: workerToken });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/transfer-ownership', () => {
  const bcrypt = require('bcryptjs');

  test('rejects a non-owner caller', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: managerToken, body: { password: 'x' },
    });
    expect(res.status).toBe(403);
  });

  test('requires a password', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: ownerToken, body: {},
    });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects an incorrect password', async () => {
    const realHash = await bcrypt.hash('correct-password', 4);
    db.query.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });

    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: ownerToken, body: { password: 'wrong-password' },
    });

    expect(res.status).toBe(401);
  });

  test('rejects transferring to an invited (non-active) member', async () => {
    const realHash = await bcrypt.hash('correct-password', 4);
    db.query
      .mockResolvedValueOnce({ rows: [{ password_hash: realHash }] })
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'invited' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: ownerToken, body: { password: 'correct-password' },
    });

    expect(res.status).toBe(400);
  });

  test('rejects transferring to a viewer', async () => {
    const realHash = await bcrypt.hash('correct-password', 4);
    db.query
      .mockResolvedValueOnce({ rows: [{ password_hash: realHash }] })
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', role: 'viewer', status: 'active' }] });

    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: ownerToken, body: { password: 'correct-password' },
    });

    expect(res.status).toBe(400);
  });

  test('a manager successfully transfers ownership to an active worker', async () => {
    const realHash = await bcrypt.hash('correct-password', 4);
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };

    // tests/setup.js's db mock reuses one shared jest.fn for db.query AND
    // db.pool.connect (an "unexpected call" throws, whichever alias hits
    // it first) — a plain .mockResolvedValueOnce() chain can't tell them
    // apart, so branch on db.pool.connect() always being called with zero
    // arguments (db.query always gets a SQL string as its first arg).
    let queryCall = 0;
    db.query.mockImplementation((sql) => {
      if (sql === undefined) return Promise.resolve(client);
      queryCall += 1;
      if (queryCall === 1) return Promise.resolve({ rows: [{ password_hash: realHash }] });
      if (queryCall === 2) return Promise.resolve({ rows: [{ membership_id: 'mem-1', role: 'worker', status: 'active' }] });
      return Promise.resolve({ rows: [] }); // logAction
    });

    const res = await request(app, {
      method: 'POST', url: '/api/users/user-target/transfer-ownership', token: ownerToken, body: { password: 'correct-password' },
    });

    expect(res.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('tenant isolation', () => {
  test('a user in another org gets 404, not the target member data', async () => {
    const otherOrgOwnerToken = signTestToken({ role: 'owner', organizationId: 'org-2', membershipId: 'member-other', id: 'user-other-owner' });
    db.query.mockResolvedValueOnce({ rows: [] }); // getTargetMembership finds nothing scoped to org-2

    const res = await request(app, { method: 'POST', url: '/api/users/user-target/suspend', token: otherOrgOwnerToken });

    expect(res.status).toBe(404);
  });
});
