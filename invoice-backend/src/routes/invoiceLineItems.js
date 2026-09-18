const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// Column list is explicit everywhere in this file and never includes
// `cost` — that column is exclusive to the internal part-purchases billing
// flow (routes/partPurchases.js) and must never reach a request driven by
// the invoice editor or the customer-facing PDF.
const SAFE_COLUMNS = 'id, organization_id, invoice_id, description, quantity, unit, unit_price, total_price, created_at, updated_at';

async function loadEditableInvoice(req, invoiceId) {
  const { rows } = await db.query(
    'SELECT id, technician_id, status FROM invoices WHERE id = $1 AND organization_id = $2',
    [invoiceId, req.user.organizationId]
  );
  const invoice = rows[0];
  if (!invoice) return { error: [404, 'Invoice not found'] };
  if (req.user.role === 'worker' && invoice.technician_id !== req.user.membershipId) {
    return { error: [403, 'Forbidden'] };
  }
  if (!['draft', 'rejected'].includes(invoice.status)) {
    return { error: [409, 'Line items can only be edited on a draft or rejected invoice'] };
  }
  return { invoice };
}

// POST /api/invoice-line-items — invoice_id is trusted from the body, so
// it's re-verified against the caller's own organization and edit
// permissions first, same pattern as routes/parts.js.
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { invoice_id, description, quantity, unit_price, unit } = req.body;
    if (!invoice_id || !description || quantity == null || unit_price == null) {
      return res.status(400).json({ error: 'invoice_id, description, quantity, and unit_price are required' });
    }

    const { error } = await loadEditableInvoice(req, invoice_id);
    if (error) return res.status(error[0]).json({ error: error[1] });

    const { rows } = await db.query(
      `INSERT INTO invoice_line_items (organization_id, invoice_id, description, quantity, unit_price, unit)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SAFE_COLUMNS}`,
      [req.user.organizationId, invoice_id, description, quantity, unit_price, unit || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/invoice-line-items/:id
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows: existingRows } = await db.query(
      `SELECT ${SAFE_COLUMNS} FROM invoice_line_items WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Line item not found' });

    const { error } = await loadEditableInvoice(req, existingRows[0].invoice_id);
    if (error) return res.status(error[0]).json({ error: error[1] });

    const { description, quantity, unit_price, unit } = req.body;
    const { rows } = await db.query(
      `UPDATE invoice_line_items SET
        description = COALESCE($1, description),
        quantity = COALESCE($2, quantity),
        unit_price = COALESCE($3, unit_price),
        unit = COALESCE($4, unit),
        updated_at = NOW()
       WHERE id = $5
       RETURNING ${SAFE_COLUMNS}`,
      [description, quantity, unit_price, unit, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/invoice-line-items/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows: existingRows } = await db.query(
      `SELECT ${SAFE_COLUMNS} FROM invoice_line_items WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Line item not found' });

    const { error } = await loadEditableInvoice(req, existingRows[0].invoice_id);
    if (error) return res.status(error[0]).json({ error: error[1] });

    await db.query('DELETE FROM invoice_line_items WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
