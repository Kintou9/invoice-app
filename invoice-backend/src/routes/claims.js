const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// GET /api/claims — role-scoped list
router.get('/', authenticate, async (req, res, next) => {
  try {
    let query, params;

    if (req.user.role === 'technician') {
      query = `
        SELECT c.*, u.name AS assigned_to_name, cb.name AS created_by_name
        FROM claims c
        LEFT JOIN users u ON c.assigned_to = u.id
        LEFT JOIN users cb ON c.created_by = cb.id
        WHERE c.assigned_to = $1
        ORDER BY c.created_at DESC`;
      params = [req.user.id];
    } else {
      query = `
        SELECT c.*, u.name AS assigned_to_name, cb.name AS created_by_name
        FROM claims c
        LEFT JOIN users u ON c.assigned_to = u.id
        LEFT JOIN users cb ON c.created_by = cb.id
        ORDER BY c.created_at DESC`;
      params = [];
    }

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/claims/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.name AS assigned_to_name, cb.name AS created_by_name
       FROM claims c
       LEFT JOIN users u ON c.assigned_to = u.id
       LEFT JOIN users cb ON c.created_by = cb.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Claim not found' });

    // Technicians can only see their own claims
    if (req.user.role === 'technician' && rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/claims — admin/manager creates claims
router.post('/', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const {
      claim_number, title, description, assigned_to, claim_photo_url,
      customer_name, customer_phone, job_address, date_of_service,
      type_brand, model_number, serial_number,
    } = req.body;
    const today = new Date();
    const finalNumber = claim_number || `SVC-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${Math.floor(100+Math.random()*900)}`;
    const finalTitle = title || [type_brand, customer_name].filter(Boolean).join(' — ') || 'Service Call';

    const { rows } = await db.query(
      `INSERT INTO claims
        (claim_number, title, description, assigned_to, created_by, claim_photo_url,
         customer_name, customer_phone, job_address, date_of_service,
         type_brand, model_number, serial_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        finalNumber, finalTitle, description, assigned_to || null, req.user.id, claim_photo_url || null,
        customer_name || null, customer_phone || null, job_address || null,
        date_of_service || null, type_brand || null, model_number || null, serial_number || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Claim number already exists' });
    next(err);
  }
});

// PATCH /api/claims/:id — update claim (assignment, status, etc.)
// assigned_to is set-if-present rather than COALESCE'd: the field must
// distinguish "not sent" (leave alone) from "sent as null" (unassign), which
// COALESCE can't do — it would silently ignore an explicit null and leave
// the previous assignment in place.
router.patch('/:id', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { title, description, status } = req.body;
    const hasAssignedTo = Object.prototype.hasOwnProperty.call(req.body, 'assigned_to');
    const { rows } = await db.query(
      `UPDATE claims SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        assigned_to = CASE WHEN $3 THEN $4 ELSE assigned_to END,
        status = COALESCE($5, status),
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [title, description, hasAssignedTo, req.body.assigned_to ?? null, status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Claim not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/claims/:id — admin only
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM claims WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Claim not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
