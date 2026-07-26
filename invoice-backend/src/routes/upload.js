const express = require('express');
const multer = require('multer');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { uploadBuffer } = require('../services/azureBlob');
const { extractEquipmentInfo, extractClaimInfo } = require('../services/claude');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});

// POST /api/upload/photo/:invoiceId — technician uploads equipment photo, AI extracts info
router.post('/photo/:invoiceId', authenticate, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { invoiceId } = req.params;
    const { rows: invoiceRows } = await db.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    if (!invoiceRows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'technician' && invoiceRows[0].technician_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Upload to Azure Blob
    const blobUrl = await uploadBuffer(req.file.buffer, req.file.originalname, `photos/${invoiceId}`);

    // Run AI extraction
    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;
    const extracted = await extractEquipmentInfo(imageBase64, mediaType);

    // Save photo record
    const { rows } = await db.query(
      `INSERT INTO invoice_photos (invoice_id, blob_url, extracted_model, extracted_serial, raw_ai_response)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        invoiceId,
        blobUrl,
        extracted.model_number || null,
        extracted.serial_number || null,
        JSON.stringify(extracted),
      ]
    );

    // Auto-populate invoice fields if not already set
    if (extracted.model_number || extracted.serial_number) {
      await db.query(
        `UPDATE invoices SET
          model_number = COALESCE(model_number, $1),
          serial_number = COALESCE(serial_number, $2),
          updated_at = NOW()
         WHERE id = $3`,
        [extracted.model_number, extracted.serial_number, invoiceId]
      );
    }

    res.status(201).json({ photo: rows[0], extracted });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/template — admin uploads invoice template
router.post('/template', authenticate, authorize('admin'), upload.single('template'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { name, prompt_text } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required' });

    const blobUrl = await uploadBuffer(req.file.buffer, req.file.originalname, 'templates');

    const { rows } = await db.query(
      `INSERT INTO invoice_templates (name, blob_url, prompt_text, uploaded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, blobUrl, prompt_text || null, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/upload/templates — list available templates
router.get('/templates', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, blob_url, prompt_text, created_at FROM invoice_templates WHERE is_active = true ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/upload/manager-folder — list approved invoices in manager folder
router.get('/manager-folder', authenticate, authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT i.id, i.filled_blob_url, i.reviewed_at, i.manager_notes,
              c.claim_number, c.title AS claim_title,
              u.name AS technician_name
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       JOIN users u ON i.technician_id = u.id
       WHERE i.status = 'approved'
       ORDER BY i.reviewed_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/claim-photo — upload insurance claim screenshot, AI extracts claim info
router.post('/claim-photo', authenticate, authorize('admin', 'manager'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Upload to Azure Blob
    const blobUrl = await uploadBuffer(req.file.buffer, req.file.originalname, 'claim-photos');

    // Try AI extraction — gracefully falls back if API key not set
    let extracted = { claim_number: null, title: null, description: null, confidence: 'low' };
    try {
      const imageBase64 = req.file.buffer.toString('base64');
      extracted = await extractClaimInfo(imageBase64, req.file.mimetype);
    } catch (aiErr) {
      console.warn('AI extraction skipped:', aiErr.message);
    }

    res.status(201).json({ blob_url: blobUrl, extracted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
