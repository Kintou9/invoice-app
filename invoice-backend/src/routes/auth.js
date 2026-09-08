const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// Role/org now live on organization_members, not users. A user's "active
// membership" is whichever org membership currently has status='active' —
// for this foundation pass every real user has exactly one, so "the first
// active one" is unambiguous. A disabled membership means no login access,
// same as the old users.is_active=false behavior.
async function getActiveMembership(userId) {
  const { rows } = await db.query(
    `SELECT om.id AS membership_id, om.organization_id, om.role, o.name AS organization_name
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1 AND om.status = 'active'
     ORDER BY om.joined_at ASC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
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

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
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
