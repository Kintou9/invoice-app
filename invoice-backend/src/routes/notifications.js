const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// GET /api/notifications — the current membership's own notifications,
// most recent first. Scoped to req.user.membershipId, not organizationId
// alone — these are per-membership, not shared org-wide list-and-filter
// like claims/invoices.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, type, message, link, read_at, created_at
       FROM notifications
       WHERE recipient_member_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.membershipId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id — mark one of the current membership's own
// notifications as read
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE id = $1 AND recipient_member_id = $2
       RETURNING id, read_at`,
      [req.params.id, req.user.membershipId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all — mark every unread notification for
// the current membership as read
router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    await db.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE recipient_member_id = $1 AND read_at IS NULL`,
      [req.user.membershipId]
    );
    res.json({ message: 'All notifications marked read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
