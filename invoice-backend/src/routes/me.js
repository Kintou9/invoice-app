const express = require('express');
const multer = require('multer');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const { uploadBuffer, deleteBlob, generateSasUrl } = require('../services/azureBlob');
const { processAvatar } = require('../services/avatarImage');
const { logAction } = require('../services/auditLog');

const router = express.Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, per spec
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WebP images are supported.'));
  },
});

async function loadProfile(userId, membershipId) {
  const { rows } = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.name, u.email, u.phone,
            u.avatar_blob_url, u.avatar_thumb_blob_url,
            om.role, om.job_title, o.name AS organization_name
     FROM users u
     JOIN organization_members om ON om.id = $2
     JOIN organizations o ON o.id = om.organization_id
     WHERE u.id = $1`,
    [userId, membershipId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    jobTitle: row.job_title || '',
    organizationName: row.organization_name,
    avatarUrl: row.avatar_blob_url ? generateSasUrl(row.avatar_blob_url, 60) : null,
    avatarThumbUrl: row.avatar_thumb_blob_url ? generateSasUrl(row.avatar_thumb_blob_url, 60) : null,
  };
}

// GET /api/me — the current authenticated user's own profile. Identity
// comes only from the verified JWT (req.user), never a request param.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const profile = await loadProfile(req.user.id, req.user.membershipId);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/me — account-level fields (name/phone) plus the current
// membership's job_title. Role, organization membership, and account
// status are never accepted here.
router.patch('/', authenticate, async (req, res, next) => {
  try {
    const { firstName, lastName, phone, jobTitle } = req.body;

    if (typeof firstName !== 'string' || !firstName.trim()) {
      return res.status(400).json({ error: 'First name is required.' });
    }
    if (typeof lastName !== 'string' || !lastName.trim()) {
      return res.status(400).json({ error: 'Last name is required.' });
    }
    if (firstName.trim().length > 80 || lastName.trim().length > 80) {
      return res.status(400).json({ error: 'Name is too long.' });
    }
    if (phone !== undefined && phone !== null && phone !== '' && !/^[\d\s()+.-]{5,25}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (jobTitle !== undefined && jobTitle !== null && String(jobTitle).length > 100) {
      return res.status(400).json({ error: 'Job title is too long.' });
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    await db.query(
      `UPDATE users SET first_name = $1, last_name = $2, name = $3, phone = $4, updated_at = NOW() WHERE id = $5`,
      [firstName.trim(), lastName.trim(), fullName, phone ? phone.trim() : null, req.user.id]
    );
    await db.query(
      `UPDATE organization_members SET job_title = $1 WHERE id = $2`,
      [jobTitle ? String(jobTitle).trim() : null, req.user.membershipId]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'user',
      entityId: req.user.id,
      action: 'update_profile',
      performedBy: req.user.membershipId,
    });

    const profile = await loadProfile(req.user.id, req.user.membershipId);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// POST /api/me/avatar — multipart upload, field name "avatar". Blob path
// is keyed by req.user.id (server-derived, never client-supplied), so one
// user can never overwrite another's photo. The old avatar (if any) is
// deleted after the new one uploads successfully.
router.post('/avatar', authenticate, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    let large, small;
    try {
      ({ large, small } = await processAvatar(req.file.buffer));
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    const folder = `avatars/${req.user.id}`;
    const [largeUrl, smallUrl] = await Promise.all([
      uploadBuffer(large, 'avatar-large.jpg', folder),
      uploadBuffer(small, 'avatar-small.jpg', folder),
    ]);

    const { rows: prevRows } = await db.query(
      'SELECT avatar_blob_url, avatar_thumb_blob_url FROM users WHERE id = $1',
      [req.user.id]
    );

    await db.query(
      'UPDATE users SET avatar_blob_url = $1, avatar_thumb_blob_url = $2, updated_at = NOW() WHERE id = $3',
      [largeUrl, smallUrl, req.user.id]
    );

    // Best-effort cleanup of the replaced blobs — never let a delete
    // failure undo an otherwise-successful upload.
    const prev = prevRows[0];
    if (prev?.avatar_blob_url) deleteBlob(prev.avatar_blob_url).catch(() => {});
    if (prev?.avatar_thumb_blob_url) deleteBlob(prev.avatar_thumb_blob_url).catch(() => {});

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'user',
      entityId: req.user.id,
      action: 'update_avatar',
      performedBy: req.user.membershipId,
    });

    const profile = await loadProfile(req.user.id, req.user.membershipId);
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/me/avatar — restores the initials fallback.
router.delete('/avatar', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT avatar_blob_url, avatar_thumb_blob_url FROM users WHERE id = $1',
      [req.user.id]
    );
    const prev = rows[0];
    if (!prev?.avatar_blob_url) return res.status(404).json({ error: 'No photo to remove.' });

    await db.query(
      'UPDATE users SET avatar_blob_url = NULL, avatar_thumb_blob_url = NULL, updated_at = NOW() WHERE id = $1',
      [req.user.id]
    );

    deleteBlob(prev.avatar_blob_url).catch(() => {});
    if (prev.avatar_thumb_blob_url) deleteBlob(prev.avatar_thumb_blob_url).catch(() => {});

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'user',
      entityId: req.user.id,
      action: 'remove_avatar',
      performedBy: req.user.membershipId,
    });

    const profile = await loadProfile(req.user.id, req.user.membershipId);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
