const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');
const { resolveTemplateAssignment } = require('../src/services/documentTemplates');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-owner' });
const workerToken = signTestToken({ role: 'worker', organizationId: 'org-1', membershipId: 'member-worker' });
const viewerToken = signTestToken({ role: 'viewer', organizationId: 'org-1', membershipId: 'member-viewer' });
const otherOrgToken = signTestToken({ role: 'owner', organizationId: 'org-2', membershipId: 'member-other' });

describe('role enforcement (server-side, not just hidden UI)', () => {
  test('a worker cannot archive a template', async () => {
    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/archive', token: workerToken });
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a viewer cannot create a new draft version', async () => {
    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/versions', token: viewerToken, body: {} });
    expect(res.status).toBe(403);
  });

  test('a worker cannot save field mappings', async () => {
    const res = await request(app, { method: 'PATCH', url: '/api/document-templates/tpl-1/versions/v-1/fields', token: workerToken, body: { fields: [] } });
    expect(res.status).toBe(403);
  });

  test('a viewer cannot upload a template', async () => {
    const res = await request(app, { method: 'POST', url: '/api/document-templates/upload', token: viewerToken, body: {} });
    expect(res.status).toBe(403);
  });
});

describe('tenant isolation', () => {
  test('GET /:id from a different org is a 404, never the other org\'s template', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // getOwnedTemplate scoped to org-2 finds nothing

    const res = await request(app, { method: 'GET', url: '/api/document-templates/tpl-1', token: otherOrgToken });

    expect(res.status).toBe(404);
  });

  test('activate from a different org is a 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/versions/v-1/activate', token: otherOrgToken });

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/versions/:versionId/activate — the required-field guard', () => {
  test('blocks activation and lists exactly what is unmapped', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] }) // getOwnedTemplate
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', template_id: 'tpl-1' }] }) // version lookup
      .mockResolvedValueOnce({ rows: [{ label: 'Customer signature' }, { label: 'Total' }] }); // unmapped required fields

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/versions/v-1/activate', token: ownerToken });

    expect(res.status).toBe(400);
    expect(res.body.unmapped_fields).toEqual(['Customer signature', 'Total']);
  });

  test('succeeds and demotes the previously active version to archived', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    // db.query and db.pool.connect share one underlying mock in tests/setup.js
    // (both aliases of the same "unexpected call" jest.fn) — every
    // .mockResolvedValueOnce() call, on whichever alias, pushes onto that one
    // shared FIFO queue, so these must be queued in the exact chronological
    // order the route actually calls them: getOwnedTemplate, version lookup,
    // unmapped-fields check, *then* db.pool.connect() for the transaction,
    // then logAction's own db.query call.
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-2', template_id: 'tpl-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // no unmapped required fields
    db.pool.connect.mockResolvedValueOnce(client);
    db.query.mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/versions/v-2/activate', token: ownerToken });

    expect(res.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'archived'"),
      ['tpl-1']
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ['v-2']
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('POST /:id/archive — never a silent delete of an in-use template', () => {
  test('blocks with a 409 and usage counts when in use, without confirm', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // generated_documents count
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // template_assignments count

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/archive', token: ownerToken });

    expect(res.status).toBe(409);
    expect(res.body.documents_generated).toBe(3);
    expect(res.body.active_assignments).toBe(1);
  });

  test('archives when confirm=true is passed', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [] }) // DELETE template_assignments
      .mockResolvedValueOnce({ rows: [] }) // UPDATE status='archived'
      .mockResolvedValueOnce({ rows: [] }); // logAction

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/archive?confirm=true', token: ownerToken });

    expect(res.status).toBe(200);
  });

  test('archives immediately when not in use, no confirmation needed', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app, { method: 'POST', url: '/api/document-templates/tpl-1/archive', token: ownerToken });

    expect(res.status).toBe(200);
  });
});

describe('resolveTemplateAssignment — most-specific-wins', () => {
  test('an insurance-specific match beats a service match and an org default', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { scope: 'organization', scope_value: null, template_id: 'tpl-default', status: 'active' },
        { scope: 'service', scope_value: 'HVAC', template_id: 'tpl-service', status: 'active' },
        { scope: 'insurance', scope_value: 'Apex Insurance', template_id: 'tpl-insurance', status: 'active' },
      ],
    });

    const result = await resolveTemplateAssignment({
      organizationId: 'org-1', category: 'invoice', serviceType: 'HVAC', industryKey: 'hvac', insuranceCompany: 'Apex Insurance',
    });

    expect(result).toBe('tpl-insurance');
  });

  test('the simple "Use as default invoice" toggle works even with no template_assignments row at all', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // no template_assignments rows
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-toggled-default' }] }); // is_default_invoice=true template

    const result = await resolveTemplateAssignment({ organizationId: 'org-1', category: 'invoice', serviceType: null, industryKey: null, insuranceCompany: null });

    expect(result).toBe('tpl-toggled-default');
  });

  test('falls back to the organization default when nothing more specific matches', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ scope: 'organization', scope_value: null, template_id: 'tpl-default', status: 'active' }],
    });

    const result = await resolveTemplateAssignment({
      organizationId: 'org-1', category: 'invoice', serviceType: 'Plumbing', industryKey: null, insuranceCompany: null,
    });

    expect(result).toBe('tpl-default');
  });

  test('returns null when nothing matches at all — caller falls back to the generic renderer', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // no template_assignments rows
      .mockResolvedValueOnce({ rows: [] }); // no is_default_invoice/is_default_job_claim template either

    const result = await resolveTemplateAssignment({ organizationId: 'org-1', category: 'invoice', serviceType: null, industryKey: null, insuranceCompany: null });

    expect(result).toBeNull();
  });

  test('a service match does not fire for a different service type', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ scope: 'service', scope_value: 'HVAC', template_id: 'tpl-hvac', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] }); // falls through to the is_default_* check, which also finds nothing

    const result = await resolveTemplateAssignment({ organizationId: 'org-1', category: 'invoice', serviceType: 'Plumbing', industryKey: null, insuranceCompany: null });

    expect(result).toBeNull();
  });
});

describe('an active version cannot be mutated — this is what protects past generated documents', () => {
  test('PATCH .../fields on an active version is rejected; a new draft must be created first', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'tpl-1', organization_id: 'org-1' }] }) // getOwnedTemplate
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', template_id: 'tpl-1', status: 'active' }] }); // version lookup

    const res = await request(app, {
      method: 'PATCH', url: '/api/document-templates/tpl-1/versions/v-1/fields', token: ownerToken, body: { fields: [] },
    });

    expect(res.status).toBe(409);
  });
});
