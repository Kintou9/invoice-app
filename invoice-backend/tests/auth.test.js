const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/db');
const email = require('../src/services/email');
const { request } = require('./helpers');

// Covers the previously-untested half of routes/auth.js: invite preview/
// acceptance and the full password-reset lifecycle. Invite *creation* is
// already covered in tests/users.test.js.

describe('GET /api/auth/invite/:token', () => {
  test('a valid, unexpired invite returns its preview fields', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ role: 'worker', invite_expires_at: new Date(Date.now() + 60_000), email: 'invitee@example.com', has_password: false, organization_name: 'Apex Service Team' }],
    });

    const res = await request(app, { method: 'GET', url: '/api/auth/invite/sometoken' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'invitee@example.com', role: 'worker', organizationName: 'Apex Service Team', hasPassword: false });
  });

  test('an unknown token is a 404 (not found or already used)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'GET', url: '/api/auth/invite/does-not-exist' });

    expect(res.status).toBe(404);
  });

  test('an expired invite is a 410, distinct from not-found', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ role: 'worker', invite_expires_at: new Date(Date.now() - 60_000), email: 'invitee@example.com', has_password: false, organization_name: 'Apex' }],
    });

    const res = await request(app, { method: 'GET', url: '/api/auth/invite/expiredtoken' });

    expect(res.status).toBe(410);
  });
});

describe('POST /api/auth/accept-invite', () => {
  test('a brand-new invitee sets their name and password', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ membership_id: 'mem-1', organization_id: 'org-1', role: 'worker', invite_expires_at: new Date(Date.now() + 60_000), user_id: 'user-1', email: 'new@example.com', password_hash: null, organization_name: 'Apex' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users (name/password)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE organization_members (activate)
      .mockResolvedValueOnce({ rows: [] }) // logAction insert
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', name: 'New Person', email: 'new@example.com', avatar_thumb_blob_url: null }] }); // final select
    // touchLastActive is the trailing call and self-catches — safe to leave unmocked.

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'sometoken', name: 'New Person', password: 'longenough123' },
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.name).toBe('New Person');
  });

  test('an existing user confirms with their existing password — never overwrites it', async () => {
    const realHash = await bcrypt.hash('their-real-password', 4);
    db.query
      .mockResolvedValueOnce({
        rows: [{ membership_id: 'mem-1', organization_id: 'org-2', role: 'manager', invite_expires_at: new Date(Date.now() + 60_000), user_id: 'user-2', email: 'existing@example.com', password_hash: realHash, organization_name: 'Second Co' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE organization_members (activate) — no UPDATE users this time
      .mockResolvedValueOnce({ rows: [] }) // logAction insert
      .mockResolvedValueOnce({ rows: [{ id: 'user-2', name: 'Existing Person', email: 'existing@example.com', avatar_thumb_blob_url: null }] });

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'sometoken', password: 'their-real-password' },
    });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('manager');
  });

  test('an existing user with the wrong password is rejected — never accepted on their behalf', async () => {
    const realHash = await bcrypt.hash('their-real-password', 4);
    db.query.mockResolvedValueOnce({
      rows: [{ membership_id: 'mem-1', organization_id: 'org-2', role: 'manager', invite_expires_at: new Date(Date.now() + 60_000), user_id: 'user-2', email: 'existing@example.com', password_hash: realHash, organization_name: 'Second Co' }],
    });

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'sometoken', password: 'a-guess' },
    });

    expect(res.status).toBe(401);
    // rejecting must not have touched organization_members at all
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('an expired invite token is rejected with 410', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ membership_id: 'mem-1', organization_id: 'org-1', role: 'worker', invite_expires_at: new Date(Date.now() - 60_000), user_id: 'user-1', email: 'x@example.com', password_hash: null, organization_name: 'Apex' }],
    });

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'expiredtoken', name: 'X', password: 'longenough123' },
    });

    expect(res.status).toBe(410);
  });

  test('an already-used (or entirely invalid) token is rejected with 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // hashToken lookup finds nothing — token was cleared on first use

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'already-used-token', name: 'X', password: 'longenough123' },
    });

    expect(res.status).toBe(404);
  });

  test('rejects a short password for a brand-new invitee', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ membership_id: 'mem-1', organization_id: 'org-1', role: 'worker', invite_expires_at: new Date(Date.now() + 60_000), user_id: 'user-1', email: 'x@example.com', password_hash: null, organization_name: 'Apex' }],
    });

    const res = await request(app, {
      method: 'POST', url: '/api/auth/accept-invite',
      body: { token: 'sometoken', name: 'X', password: 'short' },
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/forgot-password', () => {
  test('a real account with a password gets a reset email and a generic response', async () => {
    email.sendPasswordResetEmail.mockResolvedValueOnce(undefined);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', password_hash: 'some-hash' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE users SET reset_token...

    const res = await request(app, { method: 'POST', url: '/api/auth/forgot-password', body: { email: 'real@example.com' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  test('a non-existent email gets the exact same generic response — no enumeration', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'POST', url: '/api/auth/forgot-password', body: { email: 'nobody@example.com' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('an invited-but-never-accepted account (no password yet) gets the same generic response', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'user-2', password_hash: null }] });

    const res = await request(app, { method: 'POST', url: '/api/auth/forgot-password', body: { email: 'pending@example.com' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('a provider failure still returns the same generic response, not an error', async () => {
    email.sendPasswordResetEmail.mockRejectedValueOnce(new Error('Resend is down'));
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', password_hash: 'some-hash' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'POST', url: '/api/auth/forgot-password', body: { email: 'real@example.com' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
  });
});

describe('POST /api/auth/reset-password', () => {
  test('a valid token sets a new password and logs the user in', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'real@example.com', name: 'Real Person', reset_token_expires_at: new Date(Date.now() + 60_000) }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users (new password, clear token)
      .mockResolvedValueOnce({ rows: [{ membership_id: 'mem-1', organization_id: 'org-1', role: 'owner', organization_name: 'Apex', onboarding_status: 'completed' }] }) // getActiveMemberships
      .mockResolvedValueOnce({ rows: [] }); // logAction insert

    const res = await request(app, { method: 'POST', url: '/api/auth/reset-password', body: { token: 'sometoken', password: 'newlongpassword' } });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('an expired reset token is rejected with 410', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'x@example.com', name: 'X', reset_token_expires_at: new Date(Date.now() - 60_000) }] });

    const res = await request(app, { method: 'POST', url: '/api/auth/reset-password', body: { token: 'expiredtoken', password: 'newlongpassword' } });

    expect(res.status).toBe(410);
  });

  test('an already-used (or invalid) reset token is rejected with 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'POST', url: '/api/auth/reset-password', body: { token: 'already-used', password: 'newlongpassword' } });

    expect(res.status).toBe(404);
  });

  test('rejects a short new password', async () => {
    const res = await request(app, { method: 'POST', url: '/api/auth/reset-password', body: { token: 'sometoken', password: 'short' } });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('succeeds with a generic message when there is no active membership to log into', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'x@example.com', name: 'X', reset_token_expires_at: new Date(Date.now() + 60_000) }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }); // getActiveMemberships — none active

    const res = await request(app, { method: 'POST', url: '/api/auth/reset-password', body: { token: 'sometoken', password: 'newlongpassword' } });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.message).toMatch(/please log in/i);
  });
});

describe('POST /api/auth/change-password', () => {
  const { signTestToken } = require('./helpers');
  const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1', id: 'user-1' });

  test('rejects a new password shorter than 8 characters', async () => {
    const res = await request(app, {
      method: 'POST', url: '/api/auth/change-password', token: ownerToken,
      body: { currentPassword: 'whatever-current', newPassword: 'short' },
    });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects the wrong current password', async () => {
    const realHash = await bcrypt.hash('the-real-current-password', 4);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', password_hash: realHash }] });

    const res = await request(app, {
      method: 'POST', url: '/api/auth/change-password', token: ownerToken,
      body: { currentPassword: 'a-wrong-guess', newPassword: 'newlongenoughpassword' },
    });

    expect(res.status).toBe(401);
  });

  test('succeeds with the correct current password and a valid new one', async () => {
    const realHash = await bcrypt.hash('the-real-current-password', 4);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', password_hash: realHash }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }); // logAction insert

    const res = await request(app, {
      method: 'POST', url: '/api/auth/change-password', token: ownerToken,
      body: { currentPassword: 'the-real-current-password', newPassword: 'newlongenoughpassword' },
    });

    expect(res.status).toBe(200);
  });
});
