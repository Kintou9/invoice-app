const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// GET /api/users — admin/manager can list users
router.get('/', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/technicians — for claim assignment dropdowns
router.get('/technicians', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, email FROM users WHERE role = 'technician' AND is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/users — admin creates users
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email.toLowerCase().trim(), hash, role]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    next(err);
  }
});

// PATCH /api/users/:id — admin can update role or deactivate
router.patch('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, role, is_active } = req.body;
    const { rows } = await db.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        is_active = COALESCE($3, is_active),
        updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, role, is_active`,
      [name, role, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
