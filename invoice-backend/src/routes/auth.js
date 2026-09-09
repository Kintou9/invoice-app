const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const authenticate = require('../middleware/authenticate');
const { sendPasswordResetEmail } = require('../services/email');

const RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour — shorter than an invite's
// 7 days, since this grants access to an *existing* account rather than
// setting up a brand-new one.

const router = express.Router();

// Role/org now live on organization_members, not users — a person can have
// more than one active membership (a real scenario since invitations
// shipped: worker at one company, owner at another). "Active memberships"
// lists all of them, ordered by how long they've been a member; a login
// with no explicit target org picks the first one, same as before
// multi-org-per-user was possible. A disabled membership means no login
// access there, same as the old users.is_active=false behavior.
async function getActiveMemberships(userId) {
  const { rows } = await db.query(
    `SELECT om.id AS membership_id, om.organization_id, om.role, o.name AS organization_name
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1 AND om.status = 'active'
     ORDER BY om.joined_at ASC`,
    [userId]
  );
  return rows;
}

async function getActiveMembership(userId) {
  const memberships = await getActiveMemberships(userId);
  return memberships[0] || null;
}

function signToken(user, membership) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organization_id,
      membershipId: membership.membership_id,
      role: membership.role,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function toUserResponse(user, membership) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: membership.role,
    organizationId: membership.organization_id,
    organizationName: membership.organization_name,
  };
}

// POST /api/auth/register — public self-signup. Creates a brand-new
// organization and makes the signing-up person its owner: this is how a
// new company gets onto the platform. Joining an *existing* company
// happens separately (an owner/manager adding a member on the Users page,
// or — once built — accepting an email invitation), never through this
// public endpoint.
router.post('/register', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { name, email, password, organizationName } = req.body;
    if (!name || !email || !password || !organizationName) {
      return res.status(400).json({ error: 'Name, email, password, and company name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 12);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name.trim(), email.toLowerCase().trim(), hash]
    );
    const user = userRows[0];

    const { rows: orgRows } = await client.query(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id, name',
      [organizationName.trim()]
    );
    const org = orgRows[0];

    const { rows: memberRows } = await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')
       RETURNING id AS membership_id, organization_id, role`,
      [org.id, user.id]
    );

    await client.query('COMMIT');

    const membership = { ...memberRows[0], organization_name: org.name };
    const token = signToken(user, membership);
    res.status(201).json({ token, user: toUserResponse(user, membership) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];

    // password_hash is null for an invited-but-not-yet-accepted user —
    // bcrypt.compare throws on a null hash rather than just returning
    // false, so that case has to be checked before ever calling it.
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const membership = await getActiveMembership(user.id);
    if (!membership) {
      // No active org membership — equivalent to the old is_active=false
      // block, just decided per-membership instead of globally on the user.
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user, membership);
    res.json({ token, user: toUserResponse(user, membership) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — re-reads the membership fresh (not just the JWT
// payload) so a role change or deactivation takes effect on next load
// without needing to re-login.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    const membership = await getActiveMembership(req.user.id);
    if (!membership) {
      return res.status(401).json({ error: 'No active organization membership' });
    }

    res.json({ ...toUserResponse(rows[0], membership), created_at: rows[0].created_at });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/organizations — every organization the current user
// belongs to, for the org switcher. Includes the one they're currently
// scoped to (the frontend can tell which by comparing organizationId).
router.get('/organizations', authenticate, async (req, res, next) => {
  try {
    const memberships = await getActiveMemberships(req.user.id);
    res.json(memberships.map((m) => ({
      organizationId: m.organization_id,
      organizationName: m.organization_name,
      role: m.role,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/switch-organization — reissues a JWT scoped to a
// different organization the user is an active member of. Same shape as
// login/register/accept-invite's response — the frontend just swaps the
// stored token, no separate "switch" state to manage client-side.
router.post('/switch-organization', authenticate, async (req, res, next) => {
  try {
    const { organizationId } = req.body;
    if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });

    const { rows } = await db.query(
      `SELECT om.id AS membership_id, om.organization_id, om.role, o.name AS organization_name
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [req.user.id, organizationId]
    );
    const membership = rows[0];
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active member of that organization' });
    }

    const token = signToken(req.user, membership);
    res.json({ token, user: toUserResponse(req.user, membership) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/invite/:token — public, lets the accept-invite page show
// who invited them and to which company before asking for any input.
router.get('/invite/:token', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT om.role, om.invite_expires_at, u.email, u.password_hash IS NOT NULL AS has_password, o.name AS organization_name
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.invite_token = $1 AND om.status = 'invited'`,
      [req.params.token]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
    if (new Date(invite.invite_expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite has expired — ask for a new one' });
    }

    res.json({
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization_name,
      hasPassword: invite.has_password,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/accept-invite — public. A brand-new invitee sets their
// name and password here. Someone who's already a user elsewhere (already
// has a password from another org) instead confirms their identity with
// their existing password — this never overwrites an existing password.
router.post('/accept-invite', async (req, res, next) => {
  try {
    const { token, name, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    const { rows } = await db.query(
      `SELECT om.id AS membership_id, om.organization_id, om.role, om.invite_expires_at,
              u.id AS user_id, u.email, u.password_hash, o.name AS organization_name
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.invite_token = $1 AND om.status = 'invited'`,
      [token]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
    if (new Date(invite.invite_expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite has expired — ask for a new one' });
    }

    if (invite.password_hash) {
      // Existing user from another org — verify identity, never overwrite.
      if (!(await bcrypt.compare(password, invite.password_hash))) {
        return res.status(401).json({ error: 'Incorrect password for this existing account' });
      }
    } else {
      if (!name || password.length < 8) {
        return res.status(400).json({ error: 'Name and a password of at least 8 characters are required' });
      }
      const hash = await bcrypt.hash(password, 12);
      await db.query('UPDATE users SET name = $1, password_hash = $2, updated_at = NOW() WHERE id = $3', [
        name.trim(), hash, invite.user_id,
      ]);
    }

    await db.query(
      `UPDATE organization_members SET status = 'active', invite_token = NULL, invite_expires_at = NULL
       WHERE id = $1`,
      [invite.membership_id]
    );

    const { rows: userRows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [invite.user_id]);
    const user = userRows[0];
    const membership = {
      membership_id: invite.membership_id,
      organization_id: invite.organization_id,
      role: invite.role,
      organization_name: invite.organization_name,
    };

    const jwtToken = signToken(user, membership);
    res.json({ token: jwtToken, user: toUserResponse(user, membership) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password — public. Always returns the same generic
// success message regardless of whether the email actually exists, so this
// endpoint can't be used to enumerate which emails are registered. Only
// sends an email (and only generates a token) when a real, active-password
// account is found.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

    const { rows } = await db.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    // No account, or an invited-but-never-accepted account with no password
    // yet — nothing to reset. Same generic response either way.
    if (!user || !user.password_hash) return res.json(genericResponse);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = new Date(Date.now() + RESET_EXPIRY_MS);
    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3',
      [resetToken, resetExpiresAt, user.id]
    );

    const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;
    try {
      await sendPasswordResetEmail({ to: email.toLowerCase().trim(), resetUrl });
    } catch (emailErr) {
      // Same graceful-degradation shape as invites: the token still exists
      // and a fresh forgot-password request will just overwrite it, so
      // this doesn't need to fail the request or leak whether it worked.
      console.error('Failed to send password reset email:', emailErr.message);
    }

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password — public. Sets a new password from a valid
// reset token and logs the user in immediately, same as accept-invite.
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { rows } = await db.query(
      'SELECT id, email, name, reset_token_expires_at FROM users WHERE reset_token = $1',
      [token]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'This reset link is invalid or already used' });
    if (new Date(user.reset_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'This reset link has expired — request a new one' });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW() WHERE id = $2',
      [hash, user.id]
    );

    const membership = await getActiveMembership(user.id);
    if (!membership) {
      // Password reset worked, but there's no active org to log them into
      // (e.g. every membership got disabled since) — not an error, just no
      // token to hand back.
      return res.json({ message: 'Password updated. Please log in.' });
    }

    const jwtToken = signToken(user, membership);
    res.json({ token: jwtToken, user: toUserResponse(user, membership) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      hash,
      req.user.id,
    ]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
