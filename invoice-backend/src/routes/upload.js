const express = require('express');
const multer = require('multer');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { uploadBuffer, downloadBuffer } = require('../services/azureBlob');
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

    // Run AI extraction — never block the upload if AI fails
    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;
    let extracted = { model_number: null, serial_number: null, confidence: 'low' };
    try {
      extracted = await extractEquipmentInfo(imageBase64, mediaType);
      console.log('Equipment extraction result:', JSON.stringify(extracted));
    } catch (aiErr) {
      console.warn('Equipment AI extraction skipped:', aiErr.message);
    }

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

    // Auto-populate invoice fields if AI found something
    if (extracted.model_number || extracted.serial_number) {
      await db.query(
        `UPDATE invoices SET
          model_number = COALESCE(NULLIF(model_number,''), $1),
          serial_number = COALESCE(NULLIF(serial_number,''), $2),
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

    const blobUrl = await uploadBuffer(req.file.buffer, req.file.originalname, 'claim-photos');

    let extracted = { claim_number: null, title: null, description: null, confidence: 'low' };
    try {
      const imageBase64 = req.file.buffer.toString('base64');

      // Load template if provided
      let templateBase64 = null;
      let templateMediaType = 'image/jpeg';
      const { template_id } = req.body;
      if (template_id) {
        const { rows: tRows } = await db.query(
          'SELECT blob_url, media_type FROM claim_templates WHERE id = $1 AND is_active = true',
          [template_id]
        );
        if (tRows[0]) {
          const tBuffer = await downloadBuffer(tRows[0].blob_url);
          templateBase64 = tBuffer.toString('base64');
          templateMediaType = tRows[0].media_type || 'image/jpeg';
        }
      }

      const raw = await extractClaimInfo(imageBase64, req.file.mimetype, templateBase64, templateMediaType);
      extracted = {
        claim_number: raw.invoice_number || null,
        title: [raw.type_brand, raw.customer_name].filter(Boolean).join(' — ') || null,
        description: raw.nature_of_service || null,
        customer_name: raw.customer_name || null,
        customer_phone: raw.customer_phone || null,
        job_address: raw.job_address || null,
        date_of_service: raw.date_of_service || null,
        type_brand: raw.type_brand || null,
        model_number: raw.model_number || null,
        serial_number: raw.serial_number || null,
        technician: raw.technician || null,
        confidence: raw.confidence || 'low',
      };
    } catch (aiErr) {
      console.warn('AI extraction skipped:', aiErr.message);
    }

    res.status(201).json({ blob_url: blobUrl, extracted });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/claim-template — admin uploads a claim form template
router.post('/claim-template', authenticate, authorize('admin'), upload.single('template'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name required' });

    const blobUrl = await uploadBuffer(req.file.buffer, req.file.originalname, 'claim-templates');

    const { rows } = await db.query(
      `INSERT INTO claim_templates (name, description, blob_url, media_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description || null, blobUrl, req.file.mimetype, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/upload/claim-templates — list active claim templates
router.get('/claim-templates', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, description, blob_url, created_at
       FROM claim_templates WHERE is_active = true ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/upload/claim-template/:id — admin deletes a template
router.delete('/claim-template/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'UPDATE claim_templates SET is_active = false WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Template not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
