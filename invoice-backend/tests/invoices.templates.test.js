const app = require('../src/app');
const db = require('../src/db');
const { signTestToken, request } = require('./helpers');

const ownerToken = signTestToken({ role: 'owner', organizationId: 'org-1', membershipId: 'member-1' });

const defaultTemplate = {
  id: 'tmpl-default', organization_id: 'org-1', name: 'General', industry_key: 'general',
  is_default: true, tax_rate: '7.50',
  fields: [{ id: 'service_description', label: 'Service Description', type: 'textarea', visible: true, required: true, order: 10, customerVisible: true }],
  optional_features: { claim_number: false, po_reference: false, photos: true, receipts: false, notes: true },
};

describe('POST /api/invoices — template resolution', () => {
  test('creating with no field_template_id falls back to the org default and snapshots it', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1', assigned_to: 'member-1', model_number: null, serial_number: null, description: null }] }) // claim lookup
      .mockResolvedValueOnce({ rows: [defaultTemplate] }) // resolveTemplate: default lookup
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', field_template_id: 'tmpl-default', tax_rate: '7.50' }] }) // insert
      .mockResolvedValueOnce({ rows: [{ claim_number: 'C-1' }] }); // claim status update

    const res = await request(app, { method: 'POST', url: '/api/invoices', token: ownerToken, body: { claim_id: 'claim-1' } });

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls[2];
    expect(insertCall[0]).toContain('field_template_snapshot');
    expect(insertCall[1][7]).toBe('tmpl-default'); // field_template_id
    expect(JSON.parse(insertCall[1][8]).template_id).toBe('tmpl-default'); // snapshot
    expect(insertCall[1][9]).toBe('7.50'); // tax_rate
  });

  test('an org with zero templates creates an invoice with null template columns — unchanged legacy behavior', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1', assigned_to: 'member-1', model_number: null, serial_number: null, description: null }] })
      .mockResolvedValueOnce({ rows: [] }) // resolveTemplate: no default exists
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', field_template_id: null }] })
      .mockResolvedValueOnce({ rows: [{ claim_number: 'C-1' }] });

    const res = await request(app, { method: 'POST', url: '/api/invoices', token: ownerToken, body: { claim_id: 'claim-1' } });

    expect(res.status).toBe(201);
    const insertCall = db.query.mock.calls[2];
    expect(insertCall[1][7]).toBeNull();
    expect(insertCall[1][8]).toBeNull();
    expect(insertCall[1][9]).toBe(0);
  });

  test('an explicit field_template_id overrides the org default', async () => {
    const otherTemplate = { ...defaultTemplate, id: 'tmpl-other', is_default: false };
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'claim-1', assigned_to: 'member-1', model_number: null, serial_number: null, description: null }] })
      .mockResolvedValueOnce({ rows: [otherTemplate] }) // resolveTemplate: explicit id lookup
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1' }] })
      .mockResolvedValueOnce({ rows: [{ claim_number: 'C-1' }] });

    await request(app, { method: 'POST', url: '/api/invoices', token: ownerToken, body: { claim_id: 'claim-1', field_template_id: 'tmpl-other' } });

    expect(db.query.mock.calls[1][0]).toContain('id = $1 AND organization_id = $2');
    expect(db.query.mock.calls[1][1]).toEqual(['tmpl-other', 'org-1']);
  });
});

describe('PATCH /api/invoices/:id — field_values and template switching', () => {
  test('merges field_values into the existing JSONB', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1', field_values: { a: '1' } }] })
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', field_values: { a: '1', b: '2' } }] });

    const res = await request(app, { method: 'PATCH', url: '/api/invoices/inv-1', token: ownerToken, body: { field_values: { b: '2' } } });

    expect(res.status).toBe(200);
    const updateParams = db.query.mock.calls[1][1];
    expect(JSON.parse(updateParams[3])).toEqual({ a: '1', b: '2' });
  });

  test('switching templates drops field_values whose key no longer exists on the new template', async () => {
    const newTemplate = { ...defaultTemplate, id: 'tmpl-new', fields: [{ id: 'kept_field', label: 'Kept', type: 'text', visible: true, required: false, order: 10, customerVisible: true }] };
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'inv-1', status: 'draft', technician_id: 'member-1', field_values: { kept_field: 'x', dropped_field: 'y' } }],
      })
      .mockResolvedValueOnce({ rows: [newTemplate] }) // resolveTemplate for the switch
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1' }] });

    await request(app, { method: 'PATCH', url: '/api/invoices/inv-1', token: ownerToken, body: { field_template_id: 'tmpl-new' } });

    const updateParams = db.query.mock.calls[2][1];
    expect(JSON.parse(updateParams[3])).toEqual({ kept_field: 'x' });
  });

  test('cannot edit an approved invoice', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inv-1', status: 'approved', technician_id: 'member-1' }] });

    const res = await request(app, { method: 'PATCH', url: '/api/invoices/inv-1', token: ownerToken, body: { field_values: { a: '1' } } });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/invoices/:id/submit — required-field validation', () => {
  test('rejects submission when a required, visible field is missing', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'inv-1', technician_id: 'member-1', status: 'draft',
        field_template_snapshot: defaultTemplate,
        field_values: {}, // service_description (required) missing
      }],
    });

    const res = await request(app, { method: 'POST', url: '/api/invoices/inv-1/submit', token: ownerToken });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Service Description');
    // Validation failure happens before any mutating query.
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('historical invoices unchanged after a template edit', () => {
  test("GET /api/invoices/:id returns the invoice's own stored snapshot verbatim, never live template data", async () => {
    const staleSnapshot = { ...defaultTemplate, name: 'General (v1, before edit)' };
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: 'org-1', technician_id: 'member-1', field_template_snapshot: staleSnapshot }] })
      .mockResolvedValueOnce({ rows: [] }) // photos
      .mockResolvedValueOnce({ rows: [] }) // parts
      .mockResolvedValueOnce({ rows: [] }); // line items

    const res = await request(app, { method: 'GET', url: '/api/invoices/inv-1', token: ownerToken });

    expect(res.status).toBe(200);
    expect(res.body.field_template_snapshot.name).toBe('General (v1, before edit)');
    // The GET route never re-joins invoice_field_templates by id — it only
    // returns what's already stored on the invoice row itself.
    const joinedTemplateQuery = db.query.mock.calls.some(([sql]) => sql.includes('LEFT JOIN invoice_field_templates'));
    expect(joinedTemplateQuery).toBe(false);
  });
});
