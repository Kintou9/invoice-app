const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// GET /api/users — owner/manager lists members of their own organization
router.get('/', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, om.role, om.status, om.joined_at, u.created_at
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

// POST /api/users — owner adds a member to their organization. If the email
// already belongs to a user (e.g. a person who's a member of another org),
// they're just added as a member here rather than creating a duplicate
// account — their existing name/password are left untouched.
router.post('/', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query('SELECT id, name FROM users WHERE email = $1', [normalizedEmail]);
    let user = existing[0];

    if (!user) {
      if (!name || !password) {
        return res.status(400).json({ error: 'name and password are required for a new user' });
      }
      const hash = await bcrypt.hash(password, 12);
      const { rows } = await db.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name',
        [name.trim(), normalizedEmail, hash]
      );
      user = rows[0];
    }

    const { rows: memberRows } = await db.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING role, status, joined_at`,
      [req.user.organizationId, user.id, role]
    );

    res.status(201).json({ id: user.id, name: user.name, email: normalizedEmail, ...memberRows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already a member of this organization' });
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
