const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateSasUrl } = require('../services/azureBlob');

const router = express.Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// GET /api/audit-log — owner/manager, org-scoped, paginated, optionally
// filtered by entity_type/entity_id/action. Joins through
// organization_members -> users so the response shows a name, not just a
// bare membership id, matching how every other list endpoint in this app
// resolves an actor/assignee to a display name.
router.get('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { entity_type, entity_id, action } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseInt(req.query.offset, 10) || 0;

    const conditions = ['al.organization_id = $1'];
    const params = [req.user.organizationId];

    if (entity_type) { params.push(entity_type); conditions.push(`al.entity_type = $${params.length}`); }
    if (entity_id) { params.push(entity_id); conditions.push(`al.entity_id = $${params.length}`); }
    if (action) { params.push(action); conditions.push(`al.action = $${params.length}`); }

    params.push(limit, offset);

    const { rows } = await db.query(
      `SELECT al.*, u.name AS performed_by_name, u.avatar_thumb_blob_url AS performed_by_avatar_blob_url
       FROM audit_log al
       LEFT JOIN organization_members om ON al.performed_by = om.id
       LEFT JOIN users u ON om.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(rows.map((row) => {
      row.performed_by_avatar_url = row.performed_by_avatar_blob_url ? generateSasUrl(row.performed_by_avatar_blob_url, 60) : null;
      delete row.performed_by_avatar_blob_url;
      return row;
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
