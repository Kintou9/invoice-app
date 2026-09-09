const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateIssueDescription, suggestParts } = require('../services/claude');
const { generateSasUrl } = require('../services/azureBlob');
const { notify, notifyReviewers } = require('../services/notifications');

const router = express.Router();

// GET /api/invoices?claim_id=... — list invoices for a claim
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id } = req.query;
    let query, params;

    // technician_id is organization_members.id, not users.id — join through
    // the membership to get a display name.
    if (req.user.role === 'worker') {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title, u.name AS technician_name
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        WHERE i.organization_id = $1 AND i.technician_id = $2 ${claim_id ? 'AND i.claim_id = $3' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.organizationId, req.user.membershipId, claim_id] : [req.user.organizationId, req.user.membershipId];
    } else {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title, u.name AS technician_name
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
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

    // Fetch associated photos and parts — safe to scope by invoice_id alone,
    // since the invoice itself was already confirmed to belong to this org above
    const [photosResult, partsResult] = await Promise.all([
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
    ]);

    // Attach a short-lived SAS URL to each photo so the frontend can display it directly
    const photos = photosResult.rows.map((p) => ({
      ...p,
      sas_url: generateSasUrl(p.blob_url, 60),
    }));

    res.json({ ...rows[0], photos, parts: partsResult.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices — worker creates invoice for a claim
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id, template_id } = req.body;
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

    const { rows } = await db.query(
      `INSERT INTO invoices (organization_id, claim_id, template_id, technician_id, model_number, serial_number, issue_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.organizationId, claim_id, template_id || null, technicianId,
        claim.model_number || null,
        claim.serial_number || null,
        claim.description || null,
      ]
    );

    // Update claim status
    await db.query("UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1", [
      claim_id,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/invoices/:id — update invoice fields
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { model_number, serial_number, issue_description } = req.body;

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

    const { rows } = await db.query(
      `UPDATE invoices SET
        model_number = COALESCE($1, model_number),
        serial_number = COALESCE($2, serial_number),
        issue_description = COALESCE($3, issue_description),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [model_number, serial_number, issue_description, req.params.id]
    );
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

    const { rows } = await db.query(
      "UPDATE invoices SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'pending_approval', updated_at = NOW() WHERE id = $1 RETURNING claim_number",
      [existing[0].claim_id]
    );

    await notifyReviewers({
      organizationId: req.user.organizationId,
      type: 'invoice_submitted',
      message: `Invoice for claim ${claimRows[0].claim_number} needs your review`,
      link: `/invoices/${rows[0].id}`,
    });

    res.json(rows[0]);
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
