const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner' });
const workerToken = signTestToken({ role: 'worker' });

describe('PATCH /api/onboarding', () => {
  test('owner can save step progress', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ onboarding_status: 'in_progress', onboarding_step: 'business_type', onboarding_business_type: 'electrical' }],
    });

    const res = await request(app, {
      method: 'PATCH', url: '/api/onboarding', token: ownerToken,
      body: { step: 'business_type', business_type: 'electrical' },
    });

    expect(res.status).toBe(200);
    expect(res.body.onboarding_step).toBe('business_type');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE organizations'), ['business_type', 'electrical', 'org-1']);
  });

  test('worker is forbidden from saving onboarding progress', async () => {
    const res = await request(app, { method: 'PATCH', url: '/api/onboarding', token: workerToken, body: { step: 'business_type' } });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/onboarding/status', () => {
  test('resumes with org state plus any onboarding draft template', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ onboarding_status: 'in_progress', onboarding_step: 'customize', onboarding_business_type: 'plumbing' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tmpl-1', created_via: 'onboarding', industry_key: 'plumbing' }] });

    const res = await request(app, { method: 'GET', url: '/api/onboarding/status', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.onboarding_step).toBe('customize');
    expect(res.body.draftTemplate.id).toBe('tmpl-1');
  });
});

describe('POST /api/onboarding/complete — idempotency', () => {
  test('retried submission with identical payload upserts the same row instead of duplicating', async () => {
    const upsertedRow = { id: 'tmpl-1', organization_id: 'org-1', created_via: 'onboarding', is_default: true, name: 'Electrical Template' };

    // First submission: INSERT ... ON CONFLICT DO UPDATE, then unset-other-defaults,
    // then flip org to completed. (A 4th, unmocked audit-log call falls
    // through to the default "throw" implementation and is swallowed by
    // logAction's own try/catch — see services/auditLog.js.)
    db.query
      .mockResolvedValueOnce({ rows: [upsertedRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const payload = { business_type: 'electrical', name: 'Electrical Template' };

    const first = await request(app, { method: 'POST', url: '/api/onboarding/complete', token: ownerToken, body: payload });
    expect(first.status).toBe(200);
    expect(first.body.template.id).toBe('tmpl-1');

    // Second, identical submission (simulating a double-click/retry) hits
    // the exact same ON CONFLICT DO UPDATE path and returns the same row —
    // the route never distinguishes "first" vs "retried" calls, the DB's
    // partial unique index is what actually prevents a duplicate.
    db.query
      .mockResolvedValueOnce({ rows: [upsertedRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const second = await request(app, { method: 'POST', url: '/api/onboarding/complete', token: ownerToken, body: payload });
    expect(second.status).toBe(200);
    expect(second.body.template.id).toBe('tmpl-1');

    const insertCalls = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO invoice_field_templates'));
    expect(insertCalls).toHaveLength(2);
    for (const [sql] of insertCalls) {
      expect(sql).toContain('ON CONFLICT (organization_id) WHERE created_via');
    }
  });

  test('worker cannot complete onboarding', async () => {
    const res = await request(app, { method: 'POST', url: '/api/onboarding/complete', token: workerToken, body: { business_type: 'general' } });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('missing business_type is rejected before any DB call', async () => {
    const res = await request(app, { method: 'POST', url: '/api/onboarding/complete', token: ownerToken, body: {} });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});
