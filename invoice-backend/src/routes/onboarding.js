const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateSasUrl } = require('../services/azureBlob');
const { logAction } = require('../services/auditLog');
const { INDUSTRY_TEMPLATES } = require('../utils/industryTemplates');

const withLogoSas = (row) => (row?.logo_blob_url ? { ...row, logo_sas_url: generateSasUrl(row.logo_blob_url, 60) } : row);

const router = express.Router();

// GET /api/onboarding/business-types — the 7 industry cards + field preview
// for the "What kind of work does your business do?" step.
router.get('/business-types', authenticate, (req, res) => {
  const list = Object.entries(INDUSTRY_TEMPLATES)
    .filter(([key]) => key !== 'general')
    .map(([key, t]) => ({ key, label: t.label, fields: t.fields }));
  res.json({ businessTypes: list, general: { key: 'general', label: INDUSTRY_TEMPLATES.general.label, fields: INDUSTRY_TEMPLATES.general.fields } });
});

// GET /api/onboarding/status — resume state for the wizard, plus the
// current onboarding-draft template's content if one exists.
router.get('/status', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { rows: orgRows } = await db.query(
      'SELECT onboarding_status, onboarding_step, onboarding_business_type FROM organizations WHERE id = $1',
      [req.user.organizationId]
    );
    if (!orgRows[0]) return res.status(404).json({ error: 'Organization not found' });

    const { rows: templateRows } = await db.query(
      `SELECT * FROM invoice_field_templates WHERE organization_id = $1 AND created_via = 'onboarding'`,
      [req.user.organizationId]
    );

    res.json({ ...orgRows[0], draftTemplate: withLogoSas(templateRows[0]) || null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/onboarding — save wizard progress (which step, which business
// type) so a refresh mid-flow can resume instead of starting over.
router.patch('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { step, business_type } = req.body;
    if (step && !['business_type', 'customize'].includes(step)) {
      return res.status(400).json({ error: 'Invalid step' });
    }

    const { rows } = await db.query(
      `UPDATE organizations SET
        onboarding_status = 'in_progress',
        onboarding_step = COALESCE($1, onboarding_step),
        onboarding_business_type = COALESCE($2, onboarding_business_type)
       WHERE id = $3
       RETURNING onboarding_status, onboarding_step, onboarding_business_type`,
      [step || null, business_type || null, req.user.organizationId]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

async function upsertOnboardingTemplate(req, { businessType, name, fields, optionalFeatures, paymentTerms, taxRate, contact }) {
  const preset = INDUSTRY_TEMPLATES[businessType] || INDUSTRY_TEMPLATES.general;
  const resolvedFields = fields || preset.fields;
  const resolvedName = name || `${preset.label} Template`;

  // ON CONFLICT relies on idx_one_onboarding_template_per_org — a retried
  // submission (double-click, network retry) updates the same draft row
  // instead of inserting a duplicate template.
  const { rows } = await db.query(
    `INSERT INTO invoice_field_templates
      (organization_id, name, industry_key, created_via, is_default, logo_blob_url, contact_name,
       contact_email, contact_phone, contact_address, payment_terms, tax_rate, optional_features, fields, created_by)
     VALUES ($1, $2, $3, 'onboarding', true, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (organization_id) WHERE created_via = 'onboarding' DO UPDATE SET
       name = EXCLUDED.name,
       industry_key = EXCLUDED.industry_key,
       logo_blob_url = EXCLUDED.logo_blob_url,
       contact_name = EXCLUDED.contact_name,
       contact_email = EXCLUDED.contact_email,
       contact_phone = EXCLUDED.contact_phone,
       contact_address = EXCLUDED.contact_address,
       payment_terms = EXCLUDED.payment_terms,
       tax_rate = EXCLUDED.tax_rate,
       optional_features = EXCLUDED.optional_features,
       fields = EXCLUDED.fields,
       version = invoice_field_templates.version + 1,
       updated_at = NOW()
     RETURNING *`,
    [
      req.user.organizationId, resolvedName, businessType || 'general',
      contact?.logo_blob_url || null, contact?.name || null, contact?.email || null,
      contact?.phone || null, contact?.address || null, paymentTerms || null, taxRate || 0,
      JSON.stringify(optionalFeatures || { claim_number: false, po_reference: false, photos: true, receipts: false, notes: true }),
      JSON.stringify(resolvedFields), req.user.membershipId,
    ]
  );

  // A template just marked is_default=true needs every other row in the
  // org to lose that flag, or the partial unique index rejects the write.
  await db.query(
    'UPDATE invoice_field_templates SET is_default = false WHERE organization_id = $1 AND id != $2 AND is_default',
    [req.user.organizationId, rows[0].id]
  );

  await db.query(
    `UPDATE organizations SET onboarding_status = 'completed', onboarding_step = NULL WHERE id = $1`,
    [req.user.organizationId]
  );

  await logAction({
    organizationId: req.user.organizationId,
    entityType: 'invoice_field_template',
    entityId: rows[0].id,
    action: 'onboarding_complete',
    performedBy: req.user.membershipId,
    metadata: { business_type: businessType || 'general' },
  });

  return rows[0];
}

// POST /api/onboarding/complete — final "Open workspace" step.
router.post('/complete', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { business_type, name, fields, optional_features, payment_terms, tax_rate,
      contact_name, contact_email, contact_phone, contact_address, logo_blob_url } = req.body;
    if (!business_type) return res.status(400).json({ error: 'business_type is required' });

    const template = await upsertOnboardingTemplate(req, {
      businessType: business_type, name, fields, optionalFeatures: optional_features,
      paymentTerms: payment_terms, taxRate: tax_rate,
      contact: { name: contact_name, email: contact_email, phone: contact_phone, address: contact_address, logo_blob_url },
    });

    res.json({ template: withLogoSas(template) });
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding/skip — "Use a general template" / continue with
// defaults, no customization.
router.post('/skip', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const template = await upsertOnboardingTemplate(req, { businessType: 'general' });
    res.json({ template: withLogoSas(template) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
