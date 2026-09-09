const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const { autoDetectSupplier } = require('../utils/supplierDetect');

const router = express.Router();

const VALID_STATUSES = ['ordered', 'shipped', 'delivered', 'returned', 'refunded', 'cancelled'];

// GET /api/purchases?claim_id=... — list purchases logged against a claim
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id } = req.query;
    if (!claim_id) return res.status(400).json({ error: 'claim_id query param is required' });

    const { rows: claimRows } = await db.query(
      'SELECT id FROM claims WHERE id = $1 AND organization_id = $2',
      [claim_id, req.user.organizationId]
    );
    if (!claimRows[0]) return res.status(404).json({ error: 'Claim not found' });

    const { rows } = await db.query(
      `SELECT pp.*, li.total_price AS billed_amount
       FROM part_purchases pp
       LEFT JOIN invoice_line_items li ON pp.invoice_line_item_id = li.id
       WHERE pp.claim_id = $1 AND pp.organization_id = $2
       ORDER BY pp.created_at DESC`,
      [claim_id, req.user.organizationId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/purchases — log a part purchase against a claim
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      claim_id,
      part_description,
      part_number,
      quantity = 1,
      supplier_name,
      unit_cost,
      shipping_cost = 0,
      tax = 0,
      product_url,
      tracking_url,
      order_number,
      tracking_number,
      status = 'ordered',
      purchase_date,
    } = req.body;

    if (!claim_id || !part_description || unit_cost === undefined) {
      return res.status(400).json({ error: 'claim_id, part_description and unit_cost are required' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const { rows: claimRows } = await db.query(
      'SELECT id FROM claims WHERE id = $1 AND organization_id = $2',
      [claim_id, req.user.organizationId]
    );
    if (!claimRows[0]) return res.status(404).json({ error: 'Claim not found' });

    const resolvedSupplier = supplier_name || (product_url ? autoDetectSupplier(product_url) : null);

    const { rows } = await db.query(
      `INSERT INTO part_purchases (
         organization_id, claim_id, part_description, part_number, quantity,
         supplier_name, unit_cost, shipping_cost, tax,
         product_url, tracking_url, order_number, tracking_number,
         status, purchase_date, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        req.user.organizationId, claim_id, part_description, part_number || null, quantity,
        resolvedSupplier, unit_cost, shipping_cost, tax,
        product_url || null, tracking_url || null, order_number || null, tracking_number || null,
        status, purchase_date || null, req.user.membershipId,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/purchases/:id
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const allowedFields = [
      'part_description', 'part_number', 'quantity', 'supplier_name',
      'unit_cost', 'shipping_cost', 'tax', 'product_url', 'tracking_url',
      'order_number', 'tracking_number', 'status', 'purchase_date',
      'refund_amount', 'receipt_blob_url',
    ];

    const updates = [];
    const values = [];
    let i = 1;
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${i}`);
        values.push(req.body[field]);
        i++;
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    updates.push(`updated_at = NOW()`);

    values.push(req.params.id, req.user.organizationId);
    const { rows } = await db.query(
      `UPDATE part_purchases SET ${updates.join(', ')}
       WHERE id = $${i} AND organization_id = $${i + 1}
       RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Purchase not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/purchases/:id — only while it hasn't been billed to an invoice yet
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT invoice_line_item_id FROM part_purchases WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Purchase not found' });
    if (existing[0].invoice_line_item_id) {
      return res.status(409).json({ error: 'This purchase has already been added to an invoice and cannot be deleted' });
    }

    await db.query('DELETE FROM part_purchases WHERE id = $1 AND organization_id = $2', [
      req.params.id, req.user.organizationId,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/purchases/:id/add-to-invoice — bill this purchase to the
// customer as a priced invoice line item, at whatever markup was set.
router.post('/:id/add-to-invoice', authenticate, async (req, res, next) => {
  try {
    const { invoice_id, unit_price } = req.body;
    if (!invoice_id || unit_price === undefined) {
      return res.status(400).json({ error: 'invoice_id and unit_price are required' });
    }
    if (unit_price < 0) {
      return res.status(400).json({ error: 'unit_price must be >= 0' });
    }

    const { rows: purchaseRows } = await db.query(
      'SELECT * FROM part_purchases WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!purchaseRows[0]) return res.status(404).json({ error: 'Purchase not found' });
    const purchase = purchaseRows[0];

    if (purchase.invoice_line_item_id) {
      return res.status(409).json({ error: 'This purchase has already been added to an invoice' });
    }

    const { rows: invoiceRows } = await db.query(
      'SELECT id, claim_id, status FROM invoices WHERE id = $1 AND organization_id = $2',
      [invoice_id, req.user.organizationId]
    );
    if (!invoiceRows[0]) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invoiceRows[0];

    if (invoice.claim_id !== purchase.claim_id) {
      return res.status(400).json({ error: 'This invoice belongs to a different claim than the purchase' });
    }
    if (invoice.status === 'approved') {
      return res.status(409).json({ error: 'Cannot add a line item to an approved invoice' });
    }

    const { rows: lineItemRows } = await db.query(
      `INSERT INTO invoice_line_items (organization_id, invoice_id, description, quantity, unit_price, cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.organizationId, invoice_id, purchase.part_description, purchase.quantity, unit_price, purchase.total_cost]
    );
    const lineItem = lineItemRows[0];

    await db.query(
      'UPDATE part_purchases SET invoice_line_item_id = $1, updated_at = NOW() WHERE id = $2',
      [lineItem.id, purchase.id]
    );

    const profit = Number((Number(lineItem.total_price) - Number(lineItem.cost)).toFixed(2));
    const marginPct = Number(lineItem.total_price) > 0
      ? Number(((profit / Number(lineItem.total_price)) * 100).toFixed(1))
      : null;

    res.status(201).json({ line_item: lineItem, profit, margin_pct: marginPct });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
