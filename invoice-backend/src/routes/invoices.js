const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateIssueDescription, suggestParts } = require('../services/claude');
const { generateSasUrl, uploadBuffer } = require('../services/azureBlob');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { notify, notifyReviewers } = require('../services/notifications');
const { logAction } = require('../services/auditLog');

const router = express.Router();

// Explicit column list, never `cost` — that column is exclusive to the
// internal part-purchases billing flow (routes/partPurchases.js) and must
// never reach the invoice editor or a generated PDF.
const LINE_ITEM_COLUMNS = 'id, invoice_id, description, quantity, unit, unit_price, total_price, created_at, updated_at';

async function resolveTemplate(organizationId, fieldTemplateId) {
  if (fieldTemplateId) {
    const { rows } = await db.query(
      'SELECT * FROM invoice_field_templates WHERE id = $1 AND organization_id = $2 AND NOT is_archived',
      [fieldTemplateId, organizationId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    'SELECT * FROM invoice_field_templates WHERE organization_id = $1 AND is_default AND NOT is_archived',
    [organizationId]
  );
  return rows[0] || null;
}

function snapshotFromTemplate(template) {
  return {
    template_id: template.id,
    name: template.name,
    industry_key: template.industry_key,
    logo_blob_url: template.logo_blob_url,
    contact_name: template.contact_name,
    contact_email: template.contact_email,
    contact_phone: template.contact_phone,
    contact_address: template.contact_address,
    payment_terms: template.payment_terms,
    optional_features: template.optional_features,
    fields: template.fields,
  };
}

// Every visible && required field in the snapshot must have a non-empty
// value before an invoice can be submitted for review.
function validateFieldValues(snapshot, fieldValues) {
  const missing = [];
  for (const f of snapshot?.fields || []) {
    if (!f.visible || !f.required) continue;
    const value = fieldValues?.[f.id];
    if (value === undefined || value === null || value === '') missing.push(f.label);
  }
  return missing;
}

// GET /api/invoices?claim_id=... — list invoices for a claim
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id } = req.query;
    let query, params;

    // technician_id is organization_members.id, not users.id — join through
    // the membership to get a display name. The lateral join adds a
    // computed line-item total per invoice (0 for an org/invoice that's
    // never used the template/line-items feature) — purely additive, every
    // existing consumer of this list just ignores the extra field.
    if (req.user.role === 'worker') {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title,
               c.customer_name, c.customer_phone, c.job_address, c.date_of_service,
               u.name AS technician_name, COALESCE(totals.total, 0) AS invoice_total
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT SUM(total_price) AS total FROM invoice_line_items WHERE invoice_id = i.id
        ) totals ON true
        WHERE i.organization_id = $1 AND i.technician_id = $2 ${claim_id ? 'AND i.claim_id = $3' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.organizationId, req.user.membershipId, claim_id] : [req.user.organizationId, req.user.membershipId];
    } else {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title,
               c.customer_name, c.customer_phone, c.job_address, c.date_of_service,
               u.name AS technician_name, COALESCE(totals.total, 0) AS invoice_total
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT SUM(total_price) AS total FROM invoice_line_items WHERE invoice_id = i.id
        ) totals ON true
        WHERE i.organization_id = $1 ${claim_id ? 'AND i.claim_id = $2' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.organizationId, claim_id] : [req.user.organizationId];
    }

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, c.title AS claim_title,
              c.customer_name, c.customer_phone, c.job_address,
              c.type_brand, c.date_of_service,
              u.name AS technician_name,
              t.name AS template_name, t.prompt_text AS template_prompt
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       LEFT JOIN organization_members om ON i.technician_id = om.id
       LEFT JOIN users u ON om.user_id = u.id
       LEFT JOIN invoice_templates t ON i.template_id = t.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fetch associated photos, parts, and line items — safe to scope by
    // invoice_id alone, since the invoice itself was already confirmed to
    // belong to this org above.
    const [photosResult, partsResult, lineItemsResult] = await Promise.all([
      db.query('SELECT * FROM invoice_photos WHERE invoice_id = $1 ORDER BY uploaded_at', [req.params.id]),
      db.query(
        `SELECT p.*, json_agg(psl.*) FILTER (WHERE psl.id IS NOT NULL) AS supplier_links
         FROM parts p
         LEFT JOIN part_supplier_links psl ON p.id = psl.part_id
         WHERE p.invoice_id = $1
         GROUP BY p.id
         ORDER BY p.created_at`,
        [req.params.id]
      ),
      db.query(
        `SELECT ${LINE_ITEM_COLUMNS} FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at`,
        [req.params.id]
      ),
    ]);

    // Attach a short-lived SAS URL to each photo so the frontend can display it directly
    const photos = photosResult.rows.map((p) => ({
      ...p,
      sas_url: generateSasUrl(p.blob_url, 60),
    }));

    // The template snapshot's logo lives in a private Blob container like
    // every other upload — attach a short-lived SAS URL for on-screen
    // display without mutating what's actually stored on the invoice.
    const snapshot = rows[0].field_template_snapshot;
    const snapshotWithLogoSas = snapshot?.logo_blob_url
      ? { ...snapshot, logo_sas_url: generateSasUrl(snapshot.logo_blob_url, 60) }
      : snapshot;

    res.json({
      ...rows[0], field_template_snapshot: snapshotWithLogoSas,
      photos, parts: partsResult.rows, line_items: lineItemsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices — worker creates invoice for a claim
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id, template_id, field_template_id } = req.body;
    if (!claim_id) return res.status(400).json({ error: 'claim_id is required' });

    // Verify the claim exists in this organization, and is assigned to this
    // worker (or owner/manager creating on behalf)
    const { rows: claimRows } = await db.query(
      'SELECT * FROM claims WHERE id = $1 AND organization_id = $2',
      [claim_id, req.user.organizationId]
    );
    if (!claimRows[0]) return res.status(404).json({ error: 'Claim not found' });

    const claim = claimRows[0];
    if (req.user.role === 'worker' && claim.assigned_to !== req.user.membershipId) {
      return res.status(403).json({ error: 'This claim is not assigned to you' });
    }

    const technicianId = req.user.role === 'worker' ? req.user.membershipId : (claim.assigned_to || req.user.membershipId);

    // Resolves to the explicitly chosen template, else the org's default,
    // else null — an org that's never onboarded or set up a template gets
    // null here exactly like it always has, so its invoices behave
    // identically to before this feature existed.
    const template = await resolveTemplate(req.user.organizationId, field_template_id);
    const snapshot = template ? snapshotFromTemplate(template) : null;

    const { rows } = await db.query(
      `INSERT INTO invoices (organization_id, claim_id, template_id, technician_id, model_number, serial_number,
        issue_description, field_template_id, field_template_snapshot, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.organizationId, claim_id, template_id || null, technicianId,
        claim.model_number || null,
        claim.serial_number || null,
        claim.description || null,
        template ? template.id : null,
        snapshot ? JSON.stringify(snapshot) : null,
        template ? template.tax_rate : 0,
      ]
    );

    // Update claim status
    await db.query("UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1", [
      claim_id,
    ]);

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'create',
      performedBy: req.user.membershipId,
      metadata: { claim_id },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/invoices/:id — update invoice fields
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { model_number, serial_number, issue_description, field_values, field_template_id } = req.body;

    const { rows: existing } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && existing[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (existing[0].status === 'approved') {
      return res.status(409).json({ error: 'Cannot edit an approved invoice' });
    }

    // Switching templates re-snapshots and preserves any field_values whose
    // key still exists on the new template — the frontend is expected to
    // warn the user before sending this when values would be dropped, but
    // the drop itself is enforced here so it can't be bypassed client-side.
    let newSnapshot;
    let newTaxRate;
    let mergedFieldValues = field_values
      ? { ...(existing[0].field_values || {}), ...field_values }
      : undefined;

    if (field_template_id !== undefined) {
      const template = field_template_id ? await resolveTemplate(req.user.organizationId, field_template_id) : null;
      if (field_template_id && !template) return res.status(404).json({ error: 'Template not found' });
      newSnapshot = template ? snapshotFromTemplate(template) : null;
      newTaxRate = template ? template.tax_rate : 0;

      const allowedIds = new Set((newSnapshot?.fields || []).map((f) => f.id));
      const base = mergedFieldValues || existing[0].field_values || {};
      mergedFieldValues = Object.fromEntries(Object.entries(base).filter(([key]) => allowedIds.has(key)));
    }

    const { rows } = await db.query(
      `UPDATE invoices SET
        model_number = COALESCE($1, model_number),
        serial_number = COALESCE($2, serial_number),
        issue_description = COALESCE($3, issue_description),
        field_values = COALESCE($4, field_values),
        field_template_id = CASE WHEN $5 THEN $6 ELSE field_template_id END,
        field_template_snapshot = CASE WHEN $5 THEN $7 ELSE field_template_snapshot END,
        tax_rate = CASE WHEN $5 THEN $8 ELSE tax_rate END,
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        model_number, serial_number, issue_description,
        mergedFieldValues ? JSON.stringify(mergedFieldValues) : null,
        field_template_id !== undefined,
        field_template_id || null,
        newSnapshot ? JSON.stringify(newSnapshot) : null,
        newTaxRate,
        req.params.id,
      ]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'edit',
      performedBy: req.user.membershipId,
      metadata: { model_number, serial_number },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/submit — worker submits for manager review
router.post('/:id/submit', authenticate, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && existing[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (existing[0].field_template_snapshot) {
      const missing = validateFieldValues(existing[0].field_template_snapshot, existing[0].field_values);
      if (missing.length) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }
    }

    const { rows } = await db.query(
      "UPDATE invoices SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'pending_approval', updated_at = NOW() WHERE id = $1 RETURNING claim_number, customer_name, customer_phone, job_address",
      [existing[0].claim_id]
    );

    await notifyReviewers({
      organizationId: req.user.organizationId,
      type: 'invoice_submitted',
      message: `Invoice for claim ${claimRows[0].claim_number} needs your review`,
      link: `/invoices/${rows[0].id}`,
    });

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'submit',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number },
    });

    // Best-effort PDF generation — never blocks the submit itself. A
    // failure here just leaves pdf_blob_url null; the frontend offers a
    // "Generate PDF" retry via POST /:id/generate-pdf.
    if (rows[0].field_template_snapshot) {
      try {
        await generateAndStorePdf(rows[0], claimRows[0], req.user.organizationId);
      } catch (pdfErr) {
        console.warn('Invoice PDF generation skipped at submit time:', pdfErr.message);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

async function generateAndStorePdf(invoice, claim, organizationId) {
  const { rows: lineItemsRows } = await db.query(
    `SELECT ${LINE_ITEM_COLUMNS} FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at`,
    [invoice.id]
  );

  const pdfBuffer = await generateInvoicePdf({
    invoice,
    claim,
    lineItems: lineItemsRows,
    snapshot: invoice.field_template_snapshot,
    fieldValues: invoice.field_values,
  });

  const blobUrl = await uploadBuffer(pdfBuffer, `invoice-${invoice.id}.pdf`, `invoice-pdfs/${organizationId}`);

  await db.query(
    'UPDATE invoices SET pdf_blob_url = $1, pdf_generated_at = NOW() WHERE id = $2',
    [blobUrl, invoice.id]
  );

  return blobUrl;
}

// POST /api/invoices/:id/generate-pdf — on-demand (re)generation, e.g. a
// retry after the best-effort attempt at submit time failed.
router.post('/:id/generate-pdf', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, c.customer_name, c.customer_phone, c.job_address
       FROM invoices i JOIN claims c ON i.claim_id = c.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (rows[0].status === 'draft') {
      return res.status(400).json({ error: 'Submit the invoice before generating a PDF' });
    }

    const blobUrl = await generateAndStorePdf(rows[0], rows[0], req.user.organizationId);
    res.json({ pdf_url: generateSasUrl(blobUrl, 60) });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id/pdf — short-lived SAS URL to the already-generated PDF.
router.get('/:id/pdf', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT pdf_blob_url, technician_id FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!rows[0].pdf_blob_url) return res.status(404).json({ error: 'PDF not generated yet' });

    res.json({ pdf_url: generateSasUrl(rows[0].pdf_blob_url, 60) });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/approve — manager approves
router.post('/:id/approve', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body;
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'approved',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [manager_notes || null, req.user.membershipId, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING claim_number",
      [rows[0].claim_id]
    );

    if (rows[0].technician_id) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].technician_id,
        type: 'invoice_approved',
        message: `Your invoice for claim ${claimRows[0].claim_number} was approved`,
        link: `/invoices/${rows[0].id}`,
      });
    }

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'approve',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number, manager_notes: manager_notes || null },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/reject — manager rejects
router.post('/:id/reject', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body;
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'rejected',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [manager_notes || null, req.user.membershipId, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1 RETURNING claim_number",
      [rows[0].claim_id]
    );

    if (rows[0].technician_id) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].technician_id,
        type: 'invoice_rejected',
        message: `Your invoice for claim ${claimRows[0].claim_number} was rejected`,
        link: `/invoices/${rows[0].id}`,
      });
    }

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'reject',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number, manager_notes: manager_notes || null },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/ai/describe — Claude generates issue description
router.post('/:id/ai/describe', authenticate, async (req, res, next) => {
  try {
    const { techNotes } = req.body;
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, t.prompt_text
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       LEFT JOIN invoice_templates t ON i.template_id = t.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    let description;
    try {
      description = await generateIssueDescription({
        techNotes,
        modelNumber: invoice.model_number,
        serialNumber: invoice.serial_number,
        claimNumber: invoice.claim_number,
        templatePrompt: invoice.prompt_text,
      });
    } catch (aiErr) {
      console.error('AI describe error:', aiErr.message);
      return res.status(500).json({ error: 'AI service unavailable — check your Anthropic API key' });
    }

    await db.query(
      'UPDATE invoices SET ai_generated_description = $1, updated_at = NOW() WHERE id = $2',
      [description, req.params.id]
    );

    res.json({ description });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/ai/parts — Claude suggests parts
router.post('/:id/ai/parts', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    let result;
    try {
      result = await suggestParts({
        issueDescription: invoice.issue_description || invoice.ai_generated_description,
        modelNumber: invoice.model_number,
        serialNumber: invoice.serial_number,
      });
    } catch (aiErr) {
      console.error('AI parts error:', aiErr.message);
      return res.status(500).json({ error: 'AI service unavailable — check your Anthropic API key' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
