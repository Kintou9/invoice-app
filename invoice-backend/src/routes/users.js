const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { sendInviteEmail } = require('../services/email');

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const router = express.Router();

// GET /api/users — owner/manager lists members of their own organization.
// name is masked to null only for a brand-new invitee whose "name" is
// still literally the placeholder (their own email) set at invite time —
// showing the email twice over (as both name and email columns) is more
// confusing than a plain "Pending" the frontend renders instead. An
// existing user (already has a real name from another org) invited here
// keeps showing their real name even while still 'invited'.
router.get('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, CASE WHEN om.status = 'invited' AND u.name = u.email THEN NULL ELSE u.name END AS name,
              u.email, om.role, om.status, om.joined_at, u.created_at
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY u.name`,
      [req.user.organizationId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/technicians — active workers in this organization, for
// claim assignment dropdowns
router.get('/technicians', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 AND om.role = 'worker' AND om.status = 'active'
       ORDER BY u.name`,
      [req.user.organizationId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/users — owner invites someone by email. If the email already
// belongs to a user (e.g. a person who's a member of another org), they're
// just added as a member here rather than creating a duplicate account —
// their existing name/password are left untouched and they aren't emailed
// a "set your password" link, just added as invited (see accept-invite in
// auth.js for how that's reconciled). A brand-new email gets a real invite
// email with a link to set their name and password.
router.post('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query('SELECT id, name FROM users WHERE email = $1', [normalizedEmail]);
    let user = existing[0];
    const isNewUser = !user;

    if (!user) {
      // Placeholder name until they accept and set their own — avoids a
      // separate nullable-name migration for what's a very short-lived gap.
      const { rows } = await db.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name',
        [normalizedEmail, normalizedEmail]
      );
      user = rows[0];
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    const { rows: memberRows } = await db.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status, invite_token, invite_expires_at)
       VALUES ($1, $2, $3, 'invited', $4, $5)
       RETURNING role, status, joined_at`,
      [req.user.organizationId, user.id, role, inviteToken, inviteExpiresAt]
    );

    const { rows: orgRows } = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.organizationId]);
    const inviteUrl = `${config.frontendUrl}/accept-invite?token=${inviteToken}`;

    try {
      await sendInviteEmail({
        to: normalizedEmail,
        organizationName: orgRows[0]?.name || 'your team',
        inviterName: req.user.name,
        role,
        inviteUrl,
      });
    } catch (emailErr) {
      console.error('Failed to send invite email:', emailErr.message);
      return res.status(201).json({
        id: user.id, name: isNewUser ? null : user.name, email: normalizedEmail, ...memberRows[0],
        emailError: 'Invite created, but the email failed to send. You can resend it from this page.',
      });
    }

    res.status(201).json({ id: user.id, name: isNewUser ? null : user.name, email: normalizedEmail, ...memberRows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already a member of this organization' });
    next(err);
  }
});

// POST /api/users/:id/resend-invite — owner resends an invite email with a
// fresh token (also re-extends the expiry), for a pending invite that
// failed to send or that the person never received.
router.post('/:id/resend-invite', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    const { rows: memberRows } = await db.query(
      `UPDATE organization_members SET invite_token = $1, invite_expires_at = $2
       WHERE user_id = $3 AND organization_id = $4 AND status = 'invited'
       RETURNING role`,
      [inviteToken, inviteExpiresAt, req.params.id, req.user.organizationId]
    );
    if (!memberRows[0]) return res.status(404).json({ error: 'No pending invite found for this member' });

    const { rows: userRows } = await db.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
    const { rows: orgRows } = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.organizationId]);
    const inviteUrl = `${config.frontendUrl}/accept-invite?token=${inviteToken}`;

    try {
      await sendInviteEmail({
        to: userRows[0].email,
        organizationName: orgRows[0]?.name || 'your team',
        inviterName: req.user.name,
        role: memberRows[0].role,
        inviteUrl,
      });
    } catch (emailErr) {
      // The new token is already saved even though the email didn't go
      // out — same graceful-degradation shape as the initial invite, so
      // the owner sees a clear reason to try again rather than a raw 500.
      console.error('Failed to resend invite email:', emailErr.message);
      return res.status(200).json({ message: 'Invite token refreshed, but the email failed to send. Try resending again.' });
    }

    res.json({ message: 'Invite resent' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/:id — owner updates a member's name, role, or status
// within their own organization. name lives on users; role/status live on
// organization_members — updated separately, then returned combined.
router.patch('/:id', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { name, role, status } = req.body;

    if (name) {
      await db.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [name, req.params.id]);
    }

    const { rows: memberRows } = await db.query(
      `UPDATE organization_members SET
        role = COALESCE($1, role),
        status = COALESCE($2, status)
       WHERE user_id = $3 AND organization_id = $4
       RETURNING role, status, joined_at`,
      [role, status, req.params.id, req.user.organizationId]
    );
    if (!memberRows[0]) return res.status(404).json({ error: 'User not found in this organization' });

    const { rows: userRows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.params.id]);
    res.json({ ...userRows[0], ...memberRows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
