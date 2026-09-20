const app = require('../src/app');
const db = require('../src/db');
const azureBlob = require('../src/services/azureBlob');
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

// DELETE /api/users/:id/avatar — the moderation-only path for an Owner to
// remove another member's photo. Deliberately separate authorization and
// audit action from the self-service DELETE /api/me/avatar (see tests/me.test.js).
describe('DELETE /api/users/:id/avatar — moderation', () => {
  test('an owner can remove another member\'s photo', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-target', role: 'worker', status: 'active' }] }) // getTargetMembership
      .mockResolvedValueOnce({ rows: [{ avatar_blob_url: 'https://blob/avatars/user-target/a.jpg', avatar_thumb_blob_url: 'https://blob/avatars/user-target/b.jpg' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }); // logAction
    azureBlob.deleteBlob.mockResolvedValue(undefined);

    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target/avatar', token: ownerToken });

    expect(res.status).toBe(200);
    expect(azureBlob.deleteBlob).toHaveBeenCalledTimes(2);
  });

  test('a manager cannot use the moderation endpoint (owner-only)', async () => {
    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target/avatar', token: managerToken });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('404s for a member outside the caller\'s own org', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // getTargetMembership finds nothing

    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target/avatar', token: ownerToken });

    expect(res.status).toBe(404);
  });

  test('404s when the target member has no photo to remove', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-target', role: 'worker', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ avatar_blob_url: null, avatar_thumb_blob_url: null }] });

    const res = await request(app, { method: 'DELETE', url: '/api/users/user-target/avatar', token: ownerToken });

    expect(res.status).toBe(404);
  });
});

// Rate limiting is skipped entirely under NODE_ENV=test (tests/setup.js's
// db mock would need real request-by-request state otherwise) — these
// tests flip NODE_ENV for their own duration only, so the limiter's
// skip check (which re-reads it live per request, not once at module
// load) actually engages, then restore it so every other test in this
// file keeps running unthrottled as normal.
describe('invite rate limiting — org-keyed, not IP-keyed', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  test('invite creation returns 429 once the 10-request budget is spent', async () => {
    process.env.NODE_ENV = 'production';
    const orgToken = signTestToken({ role: 'owner', organizationId: 'org-ratelimit-create', membershipId: 'm-1' });
    let lastStatus;
    for (let i = 0; i < 11; i++) {
      // Empty body fails validation before any db.query — the limiter
      // still counts the request regardless of its eventual status.
      const res = await request(app, { method: 'POST', url: '/api/users', token: orgToken, body: {} });
      lastStatus = res.status;
      if (i < 10) expect(res.status).toBe(400);
    }
    expect(lastStatus).toBe(429);
  });

  test('resend-invite returns 429 once the 10-request budget is spent', async () => {
    process.env.NODE_ENV = 'production';
    const orgToken = signTestToken({ role: 'owner', organizationId: 'org-ratelimit-resend', membershipId: 'm-2' });
    let lastStatus;
    for (let i = 0; i < 11; i++) {
      const res = await request(app, { method: 'POST', url: '/api/users/some-user-id/resend-invite', token: orgToken });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  test('the limit is keyed by organization, not by IP — a different org is unaffected', async () => {
    process.env.NODE_ENV = 'production';
    const orgAToken = signTestToken({ role: 'owner', organizationId: 'org-ratelimit-a', membershipId: 'm-3' });
    const orgBToken = signTestToken({ role: 'owner', organizationId: 'org-ratelimit-b', membershipId: 'm-4' });

    for (let i = 0; i < 10; i++) {
      await request(app, { method: 'POST', url: '/api/users', token: orgAToken, body: {} });
    }
    const orgABlocked = await request(app, { method: 'POST', url: '/api/users', token: orgAToken, body: {} });
    expect(orgABlocked.status).toBe(429);

    // Same test harness, same connection/IP as every request above — if
    // the limiter were IP-keyed this would also be 429. It isn't, because
    // it's a different organization.
    const orgBRes = await request(app, { method: 'POST', url: '/api/users', token: orgBToken, body: {} });
    expect(orgBRes.status).toBe(400); // reached the real handler — not blocked
  });
});
