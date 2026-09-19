const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { sendInviteEmail } = require('../services/email');
const { logAction } = require('../services/auditLog');
const { deleteBlob, generateSasUrl } = require('../services/azureBlob');
const { hashToken } = require('../utils/tokenHash');

const INVITE_EXPIRY_DAYS_ALLOWED = [7, 14, 30];
const DEFAULT_INVITE_EXPIRY_DAYS = 7;
const INVITABLE_ROLES = ['manager', 'worker', 'viewer'];

const router = express.Router();

// A membership row addressed by its *user* id, scoped to the caller's own
// org — every mutating route below looks the target up this way first so
// it can check role/status before deciding what to do, and so a org-B
// caller passing an org-A user id gets a clean 404 (tenant isolation).
async function getTargetMembership(userId, organizationId) {
  const { rows } = await db.query(
    `SELECT id AS membership_id, role, status FROM organization_members WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId]
  );
  return rows[0] || null;
}

// GET /api/users — owner/manager lists members of their own organization,
// plus a per-member workload snapshot: real assigned-job counts for a
// worker (never a score/ranking), org-wide oversight volume for a manager,
// nothing computed for owner/viewer (the frontend renders "—"/"Read only").
// name is masked to null only for a brand-new invitee whose "name" is
// still literally the placeholder (their own email) set at invite time —
// showing the email twice over (as both name and email columns) is more
// confusing than a plain "Pending" the frontend renders instead. An
// existing user (already has a real name from another org) invited here
// keeps showing their real name even while still 'invited'. 'removed'
// members are excluded — they're gone from the team, but every join
// elsewhere (claims, invoices, audit log) still resolves their name fine
// since the row itself is a soft-delete, not gone.
router.get('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows: members } = await db.query(
      `SELECT u.id, CASE WHEN om.status = 'invited' AND u.name = u.email THEN NULL ELSE u.name END AS name,
              u.email, u.avatar_thumb_blob_url, om.id AS membership_id, om.role, om.status, om.joined_at, om.last_active_at,
              om.invite_expires_at, u.created_at
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 AND om.status != 'removed'
       ORDER BY u.name`,
      [req.user.organizationId]
    );

    const { rows: workloadRows } = await db.query(
      `SELECT
         om.id AS membership_id,
         COUNT(DISTINCT c.id) FILTER (WHERE c.status IN ('open', 'in_progress')) AS active_jobs,
         COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'pending_approval') AS awaiting_review,
         COUNT(DISTINCT c.id) FILTER (WHERE c.date_of_service = CURRENT_DATE) AS scheduled_today,
         COUNT(DISTINCT c.id) FILTER (WHERE pp.id IS NOT NULL) AS waiting_for_parts
       FROM organization_members om
       LEFT JOIN claims c ON c.assigned_to = om.id
       LEFT JOIN part_purchases pp ON pp.claim_id = c.id AND pp.status IN ('ordered', 'shipped')
       WHERE om.organization_id = $1 AND om.role = 'worker' AND om.status != 'removed'
       GROUP BY om.id`,
      [req.user.organizationId]
    );
    const workloadByMembership = Object.fromEntries(workloadRows.map((w) => [w.membership_id, w]));

    // Manager oversight volume is org-wide, not personal — the same pair
    // of numbers attaches to every manager row, so it's computed once.
    const { rows: orgStatsRows } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM claims WHERE organization_id = $1 AND status IN ('open', 'in_progress')) AS org_open_jobs,
         (SELECT COUNT(*) FROM invoices WHERE organization_id = $1 AND status = 'submitted') AS org_pending_review`,
      [req.user.organizationId]
    );
    const orgStats = orgStatsRows[0];

    const withWorkload = members.map((m) => {
      m.avatar_url = m.avatar_thumb_blob_url ? generateSasUrl(m.avatar_thumb_blob_url, 60) : null;
      delete m.avatar_thumb_blob_url;
      if (m.role === 'worker') {
        const w = workloadByMembership[m.membership_id];
        return {
          ...m,
          workload: {
            active_jobs: Number(w?.active_jobs || 0),
            awaiting_review: Number(w?.awaiting_review || 0),
            scheduled_today: Number(w?.scheduled_today || 0),
            waiting_for_parts: Number(w?.waiting_for_parts || 0),
          },
        };
      }
      if (m.role === 'manager') {
        return {
          ...m,
          workload: { org_open_jobs: Number(orgStats.org_open_jobs), org_pending_review: Number(orgStats.org_pending_review) },
        };
      }
      return { ...m, workload: null };
    });

    res.json(withWorkload);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/technicians — active workers in this organization, for
// claim assignment dropdowns. Returns the *membership* id, not the user id
// — claims.assigned_to/invoices.technician_id point at organization_members
// now, so this is the id the frontend needs to send back on assignment.
router.get('/technicians', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT om.id, u.name, u.email
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

// POST /api/users — owner/manager invites someone by email. If the email
// already belongs to a user (e.g. a person who's a member of another org),
// they're just added as a member here rather than creating a duplicate
// account — their existing name/password are left untouched and they
// aren't emailed a "set your password" link, just added as invited (see
// accept-invite in auth.js for how that's reconciled). A brand-new email
// gets a real invite email with a link to set their name and password.
// 'owner' is never an invitable role — the only way to become owner is the
// dedicated transfer-ownership workflow below.
router.post('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { email, role, message, expires_in_days } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }
    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${INVITABLE_ROLES.join(', ')}` });
    }
    const expiryDays = expires_in_days !== undefined ? Number(expires_in_days) : DEFAULT_INVITE_EXPIRY_DAYS;
    if (!INVITE_EXPIRY_DAYS_ALLOWED.includes(expiryDays)) {
      return res.status(400).json({ error: `expires_in_days must be one of: ${INVITE_EXPIRY_DAYS_ALLOWED.join(', ')}` });
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
    const inviteExpiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    // Store only a hash at rest — the raw token exists solely in the
    // emailed invite link, same treatment as auth.js's reset_token.
    // Aliased to membership_id, not id — memberRows gets spread into the
    // response below alongside the user row, and a bare "id" here would
    // silently clobber the user's own id in that spread.
    const { rows: memberRows } = await db.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status, invite_token, invite_expires_at)
       VALUES ($1, $2, $3, 'invited', $4, $5)
       RETURNING id AS membership_id, role, status, joined_at`,
      [req.user.organizationId, user.id, role, hashToken(inviteToken), inviteExpiresAt]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'organization_member',
      entityId: memberRows[0].membership_id,
      action: 'invite',
      performedBy: req.user.membershipId,
      metadata: { email: normalizedEmail, role },
    });

    const { rows: orgRows } = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.organizationId]);
    const inviteUrl = `${config.frontendUrl}/accept-invite?token=${inviteToken}`;

    try {
      await sendInviteEmail({
        to: normalizedEmail,
        organizationName: orgRows[0]?.name || 'your team',
        inviterName: req.user.name,
        role,
        inviteUrl,
        message,
        expiresInDays: expiryDays,
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

// POST /api/users/:id/resend-invite — owner/manager resends an invite email
// with a fresh token (also re-extends the expiry) — the old token stops
// working immediately since it's overwritten, not merely superseded.
router.post('/:id/resend-invite', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = new Date(Date.now() + DEFAULT_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { rows: memberRows } = await db.query(
      `UPDATE organization_members SET invite_token = $1, invite_expires_at = $2
       WHERE user_id = $3 AND organization_id = $4 AND status = 'invited'
       RETURNING id AS membership_id, role`,
      [hashToken(inviteToken), inviteExpiresAt, req.params.id, req.user.organizationId]
    );
    if (!memberRows[0]) return res.status(404).json({ error: 'No pending invite found for this member' });

    const { rows: userRows } = await db.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
    const { rows: orgRows } = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.organizationId]);
    const inviteUrl = `${config.frontendUrl}/accept-invite?token=${inviteToken}`;

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'organization_member',
      entityId: memberRows[0].membership_id,
      action: 'resend_invite',
      performedBy: req.user.membershipId,
      metadata: { email: userRows[0]?.email },
    });

    try {
      await sendInviteEmail({
        to: userRows[0].email,
        organizationName: orgRows[0]?.name || 'your team',
        inviterName: req.user.name,
        role: memberRows[0].role,
        inviteUrl,
        expiresInDays: DEFAULT_INVITE_EXPIRY_DAYS,
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

// PATCH /api/users/:id — owner/manager updates a member's name or role
// within their own organization. 'owner' can never be granted or changed
// through this route — see POST /:id/transfer-ownership, the only path a
// membership can end up with role='owner'.
router.patch('/:id', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { name, role } = req.body;
    if (role !== undefined && !INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${INVITABLE_ROLES.join(', ')}` });
    }

    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'User not found in this organization' });
    if (target.role === 'owner') {
      return res.status(400).json({ error: "The workspace owner's role can't be changed here — use ownership transfer" });
    }

    if (name) {
      await db.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [name, req.params.id]);
    }

    const { rows: memberRows } = await db.query(
      `UPDATE organization_members SET role = COALESCE($1, role) WHERE id = $2
       RETURNING id AS membership_id, role, status, joined_at`,
      [role || null, target.membership_id]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'organization_member',
      entityId: memberRows[0].membership_id,
      action: role ? 'role_change' : 'edit',
      performedBy: req.user.membershipId,
      metadata: role ? { old_role: target.role, new_role: role } : { name },
    });

    const { rows: userRows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.params.id]);
    res.json({ ...userRows[0], ...memberRows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/suspend — temporarily revoke access (reversible via
// reactivate below). Never the owner, never yourself.
router.post('/:id/suspend', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't suspend your own account" });

    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'Member not found in this organization' });
    if (target.role === 'owner') return res.status(400).json({ error: 'The workspace owner cannot be suspended' });
    if (target.status !== 'active') return res.status(409).json({ error: 'Only an active member can be suspended' });

    await db.query(`UPDATE organization_members SET status = 'disabled' WHERE id = $1`, [target.membership_id]);
    await logAction({
      organizationId: req.user.organizationId, entityType: 'organization_member', entityId: target.membership_id,
      action: 'suspend', performedBy: req.user.membershipId, metadata: {},
    });
    res.json({ message: 'Member suspended' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/reactivate — restore access after a suspension.
router.post('/:id/reactivate', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'Member not found in this organization' });
    if (target.status !== 'disabled') return res.status(409).json({ error: 'Only a suspended member can be reactivated' });

    await db.query(`UPDATE organization_members SET status = 'active' WHERE id = $1`, [target.membership_id]);
    await logAction({
      organizationId: req.user.organizationId, entityType: 'organization_member', entityId: target.membership_id,
      action: 'reactivate', performedBy: req.user.membershipId, metadata: {},
    });
    res.json({ message: 'Member reactivated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id — serves two related actions depending on the
// target's current status. A still-'invited' row has no history anywhere
// yet (nothing FKs to a membership that's never done anything), so it's
// safe to hard-delete — that's "Cancel invitation". An active/disabled
// member almost certainly has claims/invoices/audit rows pointing at their
// membership id (all RESTRICT, not CASCADE, by design — losing that
// attribution would be a real data-integrity regression), so "Remove from
// workspace" is a soft-delete: status='removed' hides them from the team
// list and from assignment dropdowns while every historical join still
// resolves their name normally. Never the owner, never yourself.
router.delete('/:id', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account" });

    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'Member not found in this organization' });
    if (target.role === 'owner') return res.status(400).json({ error: 'The workspace owner cannot be removed' });

    if (target.status === 'invited') {
      await db.query('DELETE FROM organization_members WHERE id = $1', [target.membership_id]);
      await logAction({
        organizationId: req.user.organizationId, entityType: 'organization_member', entityId: target.membership_id,
        action: 'cancel_invite', performedBy: req.user.membershipId, metadata: {},
      });
      return res.json({ message: 'Invitation canceled' });
    }

    await db.query(`UPDATE organization_members SET status = 'removed' WHERE id = $1`, [target.membership_id]);
    await logAction({
      organizationId: req.user.organizationId, entityType: 'organization_member', entityId: target.membership_id,
      action: 'remove', performedBy: req.user.membershipId, metadata: {},
    });
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/transfer-ownership — the only way a membership can
// ever become 'owner'. Owner-only, and the caller must re-confirm their
// own password (ownership is the single most sensitive action in this
// app) — same existing-user identity check bcrypt.compare pattern already
// used in auth.js's accept-invite.
router.post('/:id/transfer-ownership', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Your current password is required to transfer ownership' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You already own this workspace' });

    const { rows: callerRows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!callerRows[0]?.password_hash || !(await bcrypt.compare(password, callerRows[0].password_hash))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'Member not found in this organization' });
    if (target.status !== 'active') return res.status(400).json({ error: 'Only an active member can become the owner' });
    if (!['manager', 'worker'].includes(target.role)) {
      return res.status(400).json({ error: 'Ownership can only be transferred to a manager or worker' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE organization_members SET role = 'manager' WHERE id = $1`, [req.user.membershipId]);
      await client.query(`UPDATE organization_members SET role = 'owner' WHERE id = $1`, [target.membership_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'organization_member',
      entityId: target.membership_id,
      action: 'transfer_ownership',
      performedBy: req.user.membershipId,
      metadata: { from_user_id: req.user.id, to_user_id: req.params.id },
    });

    res.json({ message: 'Ownership transferred' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id/avatar — moderation-only path for an Owner to
// remove another member's photo (e.g. inappropriate content). Deliberately
// separate from the self-service DELETE /api/me/avatar: different
// authorization (owner-only, not "any authenticated user removing their
// own"), different audit action, and tenant-scoped via the same
// getTargetMembership lookup every other member-management route uses.
router.delete('/:id/avatar', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const target = await getTargetMembership(req.params.id, req.user.organizationId);
    if (!target) return res.status(404).json({ error: 'Member not found in this organization' });

    const { rows } = await db.query(
      'SELECT avatar_blob_url, avatar_thumb_blob_url FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]?.avatar_blob_url) return res.status(404).json({ error: 'This member has no photo to remove' });

    await db.query(
      'UPDATE users SET avatar_blob_url = NULL, avatar_thumb_blob_url = NULL, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    deleteBlob(rows[0].avatar_blob_url).catch(() => {});
    if (rows[0].avatar_thumb_blob_url) deleteBlob(rows[0].avatar_thumb_blob_url).catch(() => {});

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'user',
      entityId: req.params.id,
      action: 'moderate_remove_avatar',
      performedBy: req.user.membershipId,
    });

    res.json({ message: 'Photo removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
