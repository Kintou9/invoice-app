const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateIssueDescription, suggestParts } = require('../services/claude');
const { generateSasUrl } = require('../services/azureBlob');

const router = express.Router();

// GET /api/invoices?claim_id=... — list invoices for a claim
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id } = req.query;
    let query, params;

    if (req.user.role === 'technician') {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title, u.name AS technician_name
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN users u ON i.technician_id = u.id
        WHERE i.technician_id = $1 ${claim_id ? 'AND i.claim_id = $2' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.id, claim_id] : [req.user.id];
    } else {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title, u.name AS technician_name
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN users u ON i.technician_id = u.id
        ${claim_id ? 'WHERE i.claim_id = $1' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [claim_id] : [];
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
      `SELECT i.*, c.claim_number, c.title AS claim_title, u.name AS technician_name,
              t.name AS template_name, t.prompt_text AS template_prompt
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       LEFT JOIN users u ON i.technician_id = u.id
       LEFT JOIN invoice_templates t ON i.template_id = t.id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'technician' && rows[0].technician_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fetch associated photos and parts
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

// POST /api/invoices — technician creates invoice for a claim
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id, template_id } = req.body;
    if (!claim_id) return res.status(400).json({ error: 'claim_id is required' });

    // Verify the claim is assigned to this technician (or admin/manager creating on behalf)
    const { rows: claimRows } = await db.query('SELECT * FROM claims WHERE id = $1', [claim_id]);
    if (!claimRows[0]) return res.status(404).json({ error: 'Claim not found' });

    const claim = claimRows[0];
    if (req.user.role === 'technician' && claim.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'This claim is not assigned to you' });
    }

    const technicianId = req.user.role === 'technician' ? req.user.id : (claim.assigned_to || req.user.id);

    const { rows } = await db.query(
      `INSERT INTO invoices (claim_id, template_id, technician_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [claim_id, template_id || null, technicianId]
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

    const { rows: existing } = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'technician' && existing[0].technician_id !== req.user.id) {
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

// POST /api/invoices/:id/submit — technician submits for manager review
router.post('/:id/submit', authenticate, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'technician' && existing[0].technician_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows } = await db.query(
      "UPDATE invoices SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    await db.query(
      "UPDATE claims SET status = 'pending_approval', updated_at = NOW() WHERE id = $1",
      [existing[0].claim_id]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/approve — manager approves
router.post('/:id/approve', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body;
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'approved',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [manager_notes || null, req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    await db.query(
      "UPDATE claims SET status = 'approved', updated_at = NOW() WHERE id = $1",
      [rows[0].claim_id]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/reject — manager rejects
router.post('/:id/reject', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body;
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'rejected',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [manager_notes || null, req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    await db.query(
      "UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1",
      [rows[0].claim_id]
    );

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
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    const description = await generateIssueDescription({
      techNotes,
      modelNumber: invoice.model_number,
      serialNumber: invoice.serial_number,
      claimNumber: invoice.claim_number,
      templatePrompt: invoice.prompt_text,
    });

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
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    const result = await suggestParts({
      issueDescription: invoice.issue_description || invoice.ai_generated_description,
      modelNumber: invoice.model_number,
      serialNumber: invoice.serial_number,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
