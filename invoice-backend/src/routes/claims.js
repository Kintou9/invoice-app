const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { notify } = require('../services/notifications');

const router = express.Router();

// assigned_to is an organization_members.id — nothing previously stopped an
// owner/manager from assigning a claim to a membership belonging to a
// completely different org (not a data leak, since org-scoped viewing still
// protects it, but a permanently meaningless assignment: that membership
// can never see or act on it from its own org's perspective).
async function isMemberOfOrg(membershipId, organizationId) {
  const { rows } = await db.query(
    'SELECT 1 FROM organization_members WHERE id = $1 AND organization_id = $2',
    [membershipId, organizationId]
  );
  return rows.length > 0;
}

// GET /api/claims — org- and role-scoped list
router.get('/', authenticate, async (req, res, next) => {
  try {
    let query, params;

    // assigned_to/created_by are organization_members.id, not users.id —
    // getting a display name means joining through the membership to the
    // user it belongs to.
    if (req.user.role === 'worker') {
      query = `
        SELECT c.*, u.name AS assigned_to_name, cb.name AS created_by_name
        FROM claims c
        LEFT JOIN organization_members om_a ON c.assigned_to = om_a.id
        LEFT JOIN users u ON om_a.user_id = u.id
        LEFT JOIN organization_members om_c ON c.created_by = om_c.id
        LEFT JOIN users cb ON om_c.user_id = cb.id
        WHERE c.organization_id = $1 AND c.assigned_to = $2
        ORDER BY c.created_at DESC`;
      params = [req.user.organizationId, req.user.membershipId];
    } else {
      query = `
        SELECT c.*, u.name AS assigned_to_name, cb.name AS created_by_name
        FROM claims c
        LEFT JOIN organization_members om_a ON c.assigned_to = om_a.id
        LEFT JOIN users u ON om_a.user_id = u.id
        LEFT JOIN organization_members om_c ON c.created_by = om_c.id
        LEFT JOIN users cb ON om_c.user_id = cb.id
        WHERE c.organization_id = $1
        ORDER BY c.created_at DESC`;
      params = [req.user.organizationId];
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
       LEFT JOIN organization_members om_a ON c.assigned_to = om_a.id
       LEFT JOIN users u ON om_a.user_id = u.id
       LEFT JOIN organization_members om_c ON c.created_by = om_c.id
       LEFT JOIN users cb ON om_c.user_id = cb.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Claim not found' });

    // Workers can only see their own claims
    if (req.user.role === 'worker' && rows[0].assigned_to !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/claims — owner/manager creates claims
router.post('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const {
      claim_number, title, description, assigned_to, claim_photo_url,
      customer_name, customer_phone, job_address, date_of_service,
      type_brand, model_number, serial_number,
    } = req.body;
    if (assigned_to && !(await isMemberOfOrg(assigned_to, req.user.organizationId))) {
      return res.status(400).json({ error: 'assigned_to must be a member of your organization' });
    }

    const today = new Date();
    const finalNumber = claim_number || `SVC-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${Math.floor(100+Math.random()*900)}`;
    const finalTitle = title || [type_brand, customer_name].filter(Boolean).join(' — ') || 'Service Call';

    const { rows } = await db.query(
      `INSERT INTO claims
        (organization_id, claim_number, title, description, assigned_to, created_by, claim_photo_url,
         customer_name, customer_phone, job_address, date_of_service,
         type_brand, model_number, serial_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.user.organizationId, finalNumber, finalTitle, description, assigned_to || null, req.user.membershipId, claim_photo_url || null,
        customer_name || null, customer_phone || null, job_address || null,
        date_of_service || null, type_brand || null, model_number || null, serial_number || null,
      ]
    );

    if (rows[0].assigned_to) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].assigned_to,
        type: 'claim_assigned',
        message: `You were assigned claim ${rows[0].claim_number}`,
        link: `/claims/${rows[0].id}`,
      });
    }

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
router.patch('/:id', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { title, description, status } = req.body;
    const hasAssignedTo = Object.prototype.hasOwnProperty.call(req.body, 'assigned_to');
    if (hasAssignedTo && req.body.assigned_to && !(await isMemberOfOrg(req.body.assigned_to, req.user.organizationId))) {
      return res.status(400).json({ error: 'assigned_to must be a member of your organization' });
    }
    const { rows } = await db.query(
      `UPDATE claims SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        assigned_to = CASE WHEN $3 THEN $4 ELSE assigned_to END,
        status = COALESCE($5, status),
        updated_at = NOW()
       WHERE id = $6 AND organization_id = $7
       RETURNING *`,
      [title, description, hasAssignedTo, req.body.assigned_to ?? null, status, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Claim not found' });

    if (hasAssignedTo && rows[0].assigned_to) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].assigned_to,
        type: 'claim_assigned',
        message: `You were assigned claim ${rows[0].claim_number}`,
        link: `/claims/${rows[0].id}`,
      });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/claims/:id — owner only
router.delete('/:id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM claims WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Claim not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
