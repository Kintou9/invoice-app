const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateSasUrl } = require('../services/azureBlob');
const { logAction } = require('../services/auditLog');
const { INDUSTRY_TEMPLATES } = require('../utils/industryTemplates');

const router = express.Router();

// The logo lives in a private Blob container like every other upload in
// this app — a raw blob_url won't render as an <img>, so every response
// that includes a template gets a short-lived SAS URL alongside it.
const withLogoSas = (row) => (row?.logo_blob_url ? { ...row, logo_sas_url: generateSasUrl(row.logo_blob_url, 60) } : row);

const DEFAULT_OPTIONAL_FEATURES = {
  claim_number: false, po_reference: false, photos: true, receipts: false, notes: true,
};

// GET /api/invoice-field-templates — every non-archived template in the
// org, unless ?include_archived=true. Any authenticated role can list
// these (a worker needs to pick one when creating an invoice).
router.get('/', authenticate, async (req, res, next) => {
  try {
    const includeArchived = req.query.include_archived === 'true';
    const { rows } = await db.query(
      `SELECT * FROM invoice_field_templates
       WHERE organization_id = $1 AND ($2::boolean OR NOT is_archived)
       ORDER BY is_default DESC, created_at DESC`,
      [req.user.organizationId, includeArchived]
    );
    res.json(rows.map(withLogoSas));
  } catch (err) {
    next(err);
  }
});

// GET /api/invoice-field-templates/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM invoice_field_templates WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(withLogoSas(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /api/invoice-field-templates — owner creates a new template, or
// duplicates an existing one via duplicate_from.
router.post('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    let {
      name, industry_key, logo_blob_url, contact_name, contact_email, contact_phone,
      contact_address, payment_terms, tax_rate, optional_features, fields, duplicate_from,
    } = req.body;

    if (duplicate_from) {
      const { rows: srcRows } = await db.query(
        'SELECT * FROM invoice_field_templates WHERE id = $1 AND organization_id = $2',
        [duplicate_from, req.user.organizationId]
      );
      if (!srcRows[0]) return res.status(404).json({ error: 'Template to duplicate not found' });
      const src = srcRows[0];
      name = name || `${src.name} (copy)`;
      industry_key = industry_key || src.industry_key;
      logo_blob_url = logo_blob_url !== undefined ? logo_blob_url : src.logo_blob_url;
      contact_name = contact_name !== undefined ? contact_name : src.contact_name;
      contact_email = contact_email !== undefined ? contact_email : src.contact_email;
      contact_phone = contact_phone !== undefined ? contact_phone : src.contact_phone;
      contact_address = contact_address !== undefined ? contact_address : src.contact_address;
      payment_terms = payment_terms !== undefined ? payment_terms : src.payment_terms;
      tax_rate = tax_rate !== undefined ? tax_rate : src.tax_rate;
      optional_features = optional_features || src.optional_features;
      fields = fields || src.fields;
    }

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!fields) {
      fields = INDUSTRY_TEMPLATES[industry_key]?.fields || INDUSTRY_TEMPLATES.general.fields;
    }

    const { rows } = await db.query(
      `INSERT INTO invoice_field_templates
        (organization_id, name, industry_key, created_via, logo_blob_url, contact_name, contact_email,
         contact_phone, contact_address, payment_terms, tax_rate, optional_features, fields, created_by)
       VALUES ($1, $2, $3, 'manual', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user.organizationId, name, industry_key || 'general', logo_blob_url || null,
        contact_name || null, contact_email || null, contact_phone || null, contact_address || null,
        payment_terms || null, tax_rate || 0,
        JSON.stringify(optional_features || DEFAULT_OPTIONAL_FEATURES),
        JSON.stringify(fields), req.user.membershipId,
      ]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice_field_template',
      entityId: rows[0].id,
      action: 'create',
      performedBy: req.user.membershipId,
      metadata: { name, industry_key: industry_key || 'general', duplicate_from: duplicate_from || null },
    });

    res.status(201).json(withLogoSas(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/invoice-field-templates/:id — owner edits a template.
// Existing invoices keep their own frozen field_template_snapshot, so this
// never retroactively changes anything already submitted/created.
router.patch('/:id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const {
      name, logo_blob_url, contact_name, contact_email, contact_phone, contact_address,
      payment_terms, tax_rate, optional_features, fields,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE invoice_field_templates SET
        name = COALESCE($1, name),
        logo_blob_url = COALESCE($2, logo_blob_url),
        contact_name = COALESCE($3, contact_name),
        contact_email = COALESCE($4, contact_email),
        contact_phone = COALESCE($5, contact_phone),
        contact_address = COALESCE($6, contact_address),
        payment_terms = COALESCE($7, payment_terms),
        tax_rate = COALESCE($8, tax_rate),
        optional_features = COALESCE($9, optional_features),
        fields = COALESCE($10, fields),
        version = version + 1,
        updated_at = NOW()
       WHERE id = $11 AND organization_id = $12
       RETURNING *`,
      [
        name, logo_blob_url, contact_name, contact_email, contact_phone, contact_address,
        payment_terms, tax_rate, optional_features ? JSON.stringify(optional_features) : null,
        fields ? JSON.stringify(fields) : null, req.params.id, req.user.organizationId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice_field_template',
      entityId: rows[0].id,
      action: 'edit',
      performedBy: req.user.membershipId,
      metadata: { name: rows[0].name },
    });

    res.json(withLogoSas(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /api/invoice-field-templates/:id/set-default — owner makes this the
// org's default template. The partial unique index on (organization_id)
// WHERE is_default guarantees exactly one survives even under a race.
router.post('/:id/set-default', authenticate, authorize('owner'), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: target } = await client.query(
      'SELECT id FROM invoice_field_templates WHERE id = $1 AND organization_id = $2 AND NOT is_archived',
      [req.params.id, req.user.organizationId]
    );
    if (!target[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Template not found' });
    }

    await client.query(
      'UPDATE invoice_field_templates SET is_default = false WHERE organization_id = $1 AND is_default',
      [req.user.organizationId]
    );
    const { rows } = await client.query(
      'UPDATE invoice_field_templates SET is_default = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json(withLogoSas(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/invoice-field-templates/:id — owner archives a template
// (soft delete — existing invoices keep their own snapshot, unaffected).
// Blocked while it's the active default; the owner must set another
// default first, so the org is never left with zero usable default.
router.delete('/:id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT id, is_default FROM invoice_field_templates WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Template not found' });
    if (existing[0].is_default) {
      return res.status(409).json({ error: 'Set a different default template before archiving this one' });
    }

    await db.query(
      'UPDATE invoice_field_templates SET is_archived = true, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice_field_template',
      entityId: req.params.id,
      action: 'archive',
      performedBy: req.user.membershipId,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
