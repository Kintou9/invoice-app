const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// POST /api/parts — add a part to an invoice
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { invoice_id, name, part_number, quantity, notes } = req.body;
    if (!invoice_id || !name) {
      return res.status(400).json({ error: 'invoice_id and name are required' });
    }

    const { rows } = await db.query(
      `INSERT INTO parts (invoice_id, name, part_number, quantity, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [invoice_id, name, part_number || null, quantity || 1, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/parts/bulk — add multiple parts at once (from AI suggestions)
router.post('/bulk', authenticate, async (req, res, next) => {
  try {
    const { invoice_id, parts } = req.body;
    if (!invoice_id || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: 'invoice_id and parts array required' });
    }

    const inserted = [];
    for (const part of parts) {
      const { rows } = await db.query(
        `INSERT INTO parts (invoice_id, name, part_number, quantity, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [invoice_id, part.name, part.part_number || null, part.quantity || 1, part.notes || null]
      );
      inserted.push(rows[0]);
    }

    res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/parts/:id
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { name, part_number, quantity, notes } = req.body;
    const { rows } = await db.query(
      `UPDATE parts SET
        name = COALESCE($1, name),
        part_number = COALESCE($2, part_number),
        quantity = COALESCE($3, quantity),
        notes = COALESCE($4, notes)
       WHERE id = $5
       RETURNING *`,
      [name, part_number, quantity, notes, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Part not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/parts/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM parts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Part not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/parts/:id/links — add supplier link to a part
router.post('/:id/links', authenticate, async (req, res, next) => {
  try {
    const { supplier_name, url, price_note } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const { rows } = await db.query(
      `INSERT INTO part_supplier_links (part_id, supplier_name, url, price_note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.id, supplier_name || null, url, price_note || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/parts/links/:linkId
router.delete('/links/:linkId', authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM part_supplier_links WHERE id = $1', [
      req.params.linkId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Link not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/parts/supplier-sites — company-configured supplier sites
router.get('/supplier-sites', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM supplier_sites WHERE is_active = true ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/parts/supplier-sites — admin adds a supplier site
router.post('/supplier-sites', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, base_url, logo_url, notes } = req.body;
    if (!name || !base_url) return res.status(400).json({ error: 'name and base_url required' });

    const { rows } = await db.query(
      `INSERT INTO supplier_sites (name, base_url, logo_url, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, base_url, logo_url || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
