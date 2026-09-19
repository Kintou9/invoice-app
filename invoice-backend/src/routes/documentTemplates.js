const express = require('express');
const multer = require('multer');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { uploadBuffer, generateSasUrl } = require('../services/azureBlob');
const { detectDocumentFields } = require('../services/claude');
const { resolveTemplateAssignment } = require('../services/documentTemplates');
const { generateFromTemplate } = require('../services/documentPdf');
const { logAction } = require('../services/auditLog');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — a phone photo of a form can be large
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type — upload a PDF, PNG, or JPG'));
  },
});

async function getOwnedTemplate(id, organizationId) {
  const { rows } = await db.query('SELECT * FROM document_templates WHERE id = $1 AND organization_id = $2', [id, organizationId]);
  return rows[0] || null;
}

// GET /api/document-templates — the unified library: real upload-based
// document_templates plus the existing flat-field invoice_field_templates,
// mapped into one common shape so the library page shows both kinds side
// by side without either system knowing about the other.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows: uploaded } = await db.query(
      `SELECT dt.*, tv.id AS active_version_id, tv.detection_confidence,
              (SELECT COUNT(*) FROM template_fields tf WHERE tf.version_id = tv.id) AS field_count,
              (SELECT COUNT(*) FROM template_fields tf WHERE tf.version_id = tv.id AND NOT tf.reviewed) AS fields_needing_review,
              (SELECT tp.image_blob_url FROM template_pages tp WHERE tp.version_id = tv.id AND tp.page_number = 1) AS thumbnail_blob_url
       FROM document_templates dt
       LEFT JOIN template_versions tv ON tv.template_id = dt.id AND tv.status IN ('active', 'draft', 'needs_review', 'processing', 'failed')
         AND tv.id = (SELECT id FROM template_versions WHERE template_id = dt.id ORDER BY version_number DESC LIMIT 1)
       WHERE dt.organization_id = $1 AND dt.status != 'archived'
       ORDER BY dt.is_default DESC, dt.created_at DESC`,
      [req.user.organizationId]
    );

    const { rows: built } = await db.query(
      `SELECT id, name, industry_key, is_default, is_archived, created_at, updated_at
       FROM invoice_field_templates WHERE organization_id = $1 AND NOT is_archived
       ORDER BY is_default DESC, created_at DESC`,
      [req.user.organizationId]
    );

    const uploadedShaped = uploaded.map((t) => ({
      id: t.id, name: t.name, category: t.category, source_type: 'uploaded', status: t.status,
      is_default: t.is_default, is_default_invoice: t.is_default_invoice, is_default_job_claim: t.is_default_job_claim,
      active_version_id: t.active_version_id, detection_confidence: t.detection_confidence,
      field_count: Number(t.field_count || 0), fields_needing_review: Number(t.fields_needing_review || 0),
      thumbnail_sas_url: t.thumbnail_blob_url ? generateSasUrl(t.thumbnail_blob_url, 60) : null,
      created_at: t.created_at, updated_at: t.updated_at,
    }));
    const builtShaped = built.map((t) => ({
      id: t.id, name: t.name, category: 'invoice', source_type: 'built', status: 'active',
      is_default: t.is_default, is_default_invoice: t.is_default, is_default_job_claim: false,
      active_version_id: null, detection_confidence: null, field_count: null, fields_needing_review: 0,
      thumbnail_sas_url: null, created_at: t.created_at, updated_at: t.updated_at,
    }));

    res.json([...uploadedShaped, ...builtShaped].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/upload — creates the template + its first
// (draft) version from an uploaded original file plus its already-rasterized
// page image(s) (a photo needs no rasterization; a PDF is rendered to PNG
// client-side with pdfjs-dist before this call, since Claude vision — and
// the mapping canvas itself — both need a real image, not a PDF binary).
// Detection runs against page 1 only; a failure here degrades to an empty,
// fully-manual field list rather than blocking the upload (per the
// "never block the workflow" requirement) — the version status reflects
// which happened (needs_review vs failed) so the UI can be honest about it.
router.post('/upload', authenticate, authorize('owner', 'manager'), upload.fields([
  { name: 'original', maxCount: 1 },
  { name: 'pages', maxCount: 20 },
]), async (req, res, next) => {
  const { name, category } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
  if (!['job_claim', 'invoice', 'combined'].includes(category)) {
    return res.status(400).json({ error: 'category must be job_claim, invoice, or combined' });
  }
  const originalFile = req.files?.original?.[0];
  const pageFiles = req.files?.pages || [];
  if (!originalFile || pageFiles.length === 0) {
    return res.status(400).json({ error: 'An original file and at least one rendered page image are required' });
  }

  // Only acquired once validation has passed — no pooled connection is held
  // during pure request-shape checks.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: templateRows } = await client.query(
      `INSERT INTO document_templates (organization_id, name, category, source_type, status, created_by)
       VALUES ($1, $2, $3, 'uploaded', 'processing', $4) RETURNING *`,
      [req.user.organizationId, name, category, req.user.membershipId]
    );
    const template = templateRows[0];

    const originalBlobUrl = await uploadBuffer(originalFile.buffer, originalFile.originalname, `document-templates/${req.user.organizationId}`);

    const { rows: versionRows } = await client.query(
      `INSERT INTO template_versions (template_id, organization_id, version_number, status, source_blob_url, page_count, created_by)
       VALUES ($1, $2, 1, 'processing', $3, $4, $5) RETURNING *`,
      [template.id, req.user.organizationId, originalBlobUrl, pageFiles.length, req.user.membershipId]
    );
    const version = versionRows[0];

    // Pixel dimensions come from the browser (pdfjs-dist canvas / Image()
    // load) since there's no server-side image-dimension library in this repo.
    for (let i = 0; i < pageFiles.length; i += 1) {
      const pageFile = pageFiles[i];
      const pageBlobUrl = await uploadBuffer(pageFile.buffer, pageFile.originalname, `document-templates/${req.user.organizationId}/pages`);
      const width = Number(req.body[`page_${i}_width`]) || null;
      const height = Number(req.body[`page_${i}_height`]) || null;
      await client.query(
        `INSERT INTO template_pages (version_id, page_number, image_blob_url, width, height) VALUES ($1, $2, $3, $4, $5)`,
        [version.id, i + 1, pageBlobUrl, width, height]
      );
    }

    await client.query('COMMIT');

    // Detection happens after the transaction commits — a Claude failure
    // must never roll back a perfectly good upload.
    let finalStatus = 'needs_review';
    let overallConfidence = null;
    try {
      const firstPage = pageFiles[0];
      const detected = await detectDocumentFields(firstPage.buffer.toString('base64'), firstPage.mimetype);
      overallConfidence = detected.overall_confidence;
      let order = 0;
      for (const f of detected.fields) {
        await db.query(
          `INSERT INTO template_fields
            (version_id, organization_id, page_number, field_key, label, field_type, sample_value, detection_confidence, display_order)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
          [version.id, req.user.organizationId, `custom:${f.label}`, f.label, f.field_type || 'text', f.value || null, f.confidence || 'low', order]
        );
        order += 1;
      }
      if (detected.fields.length === 0) finalStatus = 'draft'; // nothing detected — fully manual, not a failure
    } catch (detectErr) {
      console.error('Document field detection failed:', detectErr.message);
      finalStatus = 'draft'; // degrade to manual mapping rather than blocking the upload
      overallConfidence = null;
    }

    await db.query(`UPDATE template_versions SET status = $1, detection_confidence = $2 WHERE id = $3`, [finalStatus, overallConfidence, version.id]);
    await db.query(`UPDATE document_templates SET status = $1, updated_at = NOW() WHERE id = $2`, [finalStatus, template.id]);

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
      action: 'upload', performedBy: req.user.membershipId, metadata: { name, category },
    });

    res.status(201).json({ template: { ...template, status: finalStatus }, version: { ...version, status: finalStatus, detection_confidence: overallConfidence } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/document-templates/:id — full detail with its version list
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: versions } = await db.query(
      'SELECT * FROM template_versions WHERE template_id = $1 ORDER BY version_number DESC',
      [template.id]
    );
    const { rows: assignments } = await db.query('SELECT * FROM template_assignments WHERE template_id = $1', [template.id]);
    res.json({ ...template, versions, assignments });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/document-templates/:id — rename / settings
router.patch('/:id', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { name, allow_manual_edits, is_default_invoice, is_default_job_claim } = req.body;
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    if (is_default_invoice) {
      await db.query(`UPDATE document_templates SET is_default_invoice = false WHERE organization_id = $1 AND id != $2`, [req.user.organizationId, template.id]);
    }
    if (is_default_job_claim) {
      await db.query(`UPDATE document_templates SET is_default_job_claim = false WHERE organization_id = $1 AND id != $2`, [req.user.organizationId, template.id]);
    }

    const { rows } = await db.query(
      `UPDATE document_templates SET
        name = COALESCE($1, name),
        allow_manual_edits = COALESCE($2, allow_manual_edits),
        is_default_invoice = COALESCE($3, is_default_invoice),
        is_default_job_claim = COALESCE($4, is_default_job_claim),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name, allow_manual_edits, is_default_invoice, is_default_job_claim, template.id]
    );

    if (is_default_invoice !== undefined || is_default_job_claim !== undefined) {
      await logAction({
        organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
        action: 'default_changed', performedBy: req.user.membershipId, metadata: { is_default_invoice, is_default_job_claim },
      });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/duplicate
router.post('/:id/duplicate', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { rows: newTemplateRows } = await db.query(
      `INSERT INTO document_templates (organization_id, name, category, source_type, status, allow_manual_edits, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING *`,
      [req.user.organizationId, `${template.name} (copy)`, template.category, template.source_type, template.allow_manual_edits, req.user.membershipId]
    );
    const newTemplate = newTemplateRows[0];

    const { rows: sourceVersion } = await db.query(
      `SELECT * FROM template_versions WHERE template_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [template.id]
    );
    if (sourceVersion[0]) {
      const { rows: newVersionRows } = await db.query(
        `INSERT INTO template_versions (template_id, organization_id, version_number, status, source_blob_url, page_count, created_by)
         VALUES ($1, $2, 1, 'draft', $3, $4, $5) RETURNING *`,
        [newTemplate.id, req.user.organizationId, sourceVersion[0].source_blob_url, sourceVersion[0].page_count, req.user.membershipId]
      );
      const { rows: sourcePages } = await db.query('SELECT * FROM template_pages WHERE version_id = $1', [sourceVersion[0].id]);
      for (const p of sourcePages) {
        await db.query(
          'INSERT INTO template_pages (version_id, page_number, image_blob_url, width, height) VALUES ($1, $2, $3, $4, $5)',
          [newVersionRows[0].id, p.page_number, p.image_blob_url, p.width, p.height]
        );
      }
      const { rows: sourceFields } = await db.query('SELECT * FROM template_fields WHERE version_id = $1', [sourceVersion[0].id]);
      for (const f of sourceFields) {
        await db.query(
          `INSERT INTO template_fields (version_id, organization_id, page_number, field_key, label, field_type, x, y, width, height, placed, required, sample_value, format_options, reviewed, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [newVersionRows[0].id, req.user.organizationId, f.page_number, f.field_key, f.label, f.field_type, f.x, f.y, f.width, f.height, f.placed, f.required, f.sample_value, f.format_options, f.reviewed, f.display_order]
        );
      }
    }

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: newTemplate.id,
      action: 'upload', performedBy: req.user.membershipId, metadata: { duplicated_from: template.id },
    });

    res.status(201).json(newTemplate);
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/archive — never a silent hard delete.
// Blocks with a 409 (listing what's using it) unless ?confirm=true, per the
// "do not permanently delete an actively used template without
// confirmation" requirement — even confirmed, this only archives (status
// flag), it never deletes rows, so every generated_documents/audit_log
// reference still resolves.
router.post('/:id/archive', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { rows: docCount } = await db.query('SELECT COUNT(*) FROM generated_documents WHERE template_id = $1', [template.id]);
    const { rows: assignmentCount } = await db.query('SELECT COUNT(*) FROM template_assignments WHERE template_id = $1', [template.id]);
    const inUse = Number(docCount[0].count) > 0 || Number(assignmentCount[0].count) > 0;

    if (inUse && req.query.confirm !== 'true') {
      return res.status(409).json({
        error: 'This template is in use',
        documents_generated: Number(docCount[0].count),
        active_assignments: Number(assignmentCount[0].count),
        message: 'Pass ?confirm=true to archive it anyway. Past generated documents are unaffected.',
      });
    }

    await db.query('DELETE FROM template_assignments WHERE template_id = $1', [template.id]);
    await db.query(`UPDATE document_templates SET status = 'archived', archived_at = NOW(), is_default_invoice = false, is_default_job_claim = false WHERE id = $1`, [template.id]);

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
      action: 'archive', performedBy: req.user.membershipId, metadata: { was_in_use: inUse },
    });

    res.json({ message: 'Template archived' });
  } catch (err) {
    next(err);
  }
});

// GET /api/document-templates/:id/versions/:versionId — pages + fields for the mapping workspace
router.get('/:id/versions/:versionId', authenticate, async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: versionRows } = await db.query('SELECT * FROM template_versions WHERE id = $1 AND template_id = $2', [req.params.versionId, template.id]);
    if (!versionRows[0]) return res.status(404).json({ error: 'Version not found' });

    const { rows: pages } = await db.query('SELECT * FROM template_pages WHERE version_id = $1 ORDER BY page_number', [req.params.versionId]);
    const { rows: fields } = await db.query('SELECT * FROM template_fields WHERE version_id = $1 ORDER BY display_order', [req.params.versionId]);

    res.json({
      template,
      version: versionRows[0],
      pages: pages.map((p) => ({ ...p, sas_url: generateSasUrl(p.image_blob_url, 60) })),
      fields,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/versions — creates a new draft version to
// edit, optionally cloning an existing version's pages/fields as a starting
// point. This is the explicit "editing an active template creates a draft"
// entry point: the frontend calls this before opening the mapping workspace
// on an already-active template, rather than mutating the live version.
router.post('/:id/versions', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { clone_from_version_id } = req.body;
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { rows: maxVersion } = await db.query('SELECT COALESCE(MAX(version_number), 0) AS max FROM template_versions WHERE template_id = $1', [template.id]);
    const nextVersionNumber = Number(maxVersion[0].max) + 1;

    let sourcePages = [];
    let sourceFields = [];
    let sourceBlobUrl = null;
    let pageCount = 1;
    if (clone_from_version_id) {
      const { rows: sourceVersionRows } = await db.query('SELECT * FROM template_versions WHERE id = $1 AND template_id = $2', [clone_from_version_id, template.id]);
      if (!sourceVersionRows[0]) return res.status(404).json({ error: 'Source version not found' });
      sourceBlobUrl = sourceVersionRows[0].source_blob_url;
      pageCount = sourceVersionRows[0].page_count;
      sourcePages = (await db.query('SELECT * FROM template_pages WHERE version_id = $1', [clone_from_version_id])).rows;
      sourceFields = (await db.query('SELECT * FROM template_fields WHERE version_id = $1', [clone_from_version_id])).rows;
    }

    const { rows: newVersionRows } = await db.query(
      `INSERT INTO template_versions (template_id, organization_id, version_number, status, source_blob_url, page_count, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6) RETURNING *`,
      [template.id, req.user.organizationId, nextVersionNumber, sourceBlobUrl, pageCount, req.user.membershipId]
    );

    for (const p of sourcePages) {
      await db.query('INSERT INTO template_pages (version_id, page_number, image_blob_url, width, height) VALUES ($1,$2,$3,$4,$5)', [newVersionRows[0].id, p.page_number, p.image_blob_url, p.width, p.height]);
    }
    for (const f of sourceFields) {
      await db.query(
        `INSERT INTO template_fields (version_id, organization_id, page_number, field_key, label, field_type, x, y, width, height, placed, required, sample_value, format_options, reviewed, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [newVersionRows[0].id, req.user.organizationId, f.page_number, f.field_key, f.label, f.field_type, f.x, f.y, f.width, f.height, f.placed, f.required, f.sample_value, f.format_options, f.reviewed, f.display_order]
      );
    }

    res.status(201).json(newVersionRows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/document-templates/:id/versions/:versionId/fields — bulk save
// for the mapping workspace: add / move / resize / delete / edit-panel
// changes all land here as one array, applied as a clean replace-set for
// that version. Never touches the original uploaded file.
router.patch('/:id/versions/:versionId/fields', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields must be an array' });

    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: versionRows } = await db.query('SELECT * FROM template_versions WHERE id = $1 AND template_id = $2', [req.params.versionId, template.id]);
    if (!versionRows[0]) return res.status(404).json({ error: 'Version not found' });
    if (versionRows[0].status === 'active') return res.status(409).json({ error: 'An active version cannot be edited — create a new version first' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM template_fields WHERE version_id = $1', [req.params.versionId]);
      let order = 0;
      for (const f of fields) {
        await client.query(
          `INSERT INTO template_fields (version_id, organization_id, page_number, field_key, label, field_type, x, y, width, height, placed, required, sample_value, format_options, detection_confidence, reviewed, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            req.params.versionId, req.user.organizationId, f.page_number || 1, f.field_key, f.label, f.field_type || 'text',
            f.x || 0, f.y || 0, f.width || 0, f.height || 0, !!f.placed, !!f.required, f.sample_value || null,
            f.format_options ? JSON.stringify(f.format_options) : null, f.detection_confidence || null, !!f.reviewed, order,
          ]
        );
        order += 1;
      }
      const newStatus = versionRows[0].status === 'processing' ? 'needs_review' : versionRows[0].status;
      await client.query('UPDATE template_versions SET status = $1 WHERE id = $2', [newStatus, req.params.versionId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
      action: 'field_mapping_changed', performedBy: req.user.membershipId, metadata: { version_id: req.params.versionId, field_count: fields.length },
    });

    res.json({ message: 'Mapping saved' });
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/versions/:versionId/preview — renders
// with sample data for the Test & Activate screen, without changing status.
router.post('/:id/versions/:versionId/preview', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: pages } = await db.query('SELECT * FROM template_pages WHERE version_id = $1', [req.params.versionId]);
    const { rows: fields } = await db.query('SELECT * FROM template_fields WHERE version_id = $1 AND organization_id = $2', [req.params.versionId, req.user.organizationId]);
    if (pages.length === 0) return res.status(404).json({ error: 'Version not found' });

    const fieldValuesByFieldId = {};
    for (const f of fields) {
      fieldValuesByFieldId[f.id] = f.field_type === 'table'
        ? [{ description: 'Sample line item', quantity: 1, unit_price: '100.00', total_price: '100.00' }]
        : (f.sample_value || `Sample ${f.label}`);
    }

    const pdfBuffer = await generateFromTemplate({ pages, fields, fieldValuesByFieldId });
    const blobUrl = await uploadBuffer(pdfBuffer, `preview-${req.params.versionId}.pdf`, `document-templates/${req.user.organizationId}/previews`);
    res.json({ pdf_url: generateSasUrl(blobUrl, 30) });
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/versions/:versionId/activate — the
// activation guard: every required field must actually be placed on the
// document before this template can go live, per the request's explicit
// rule. Demotes whichever version was previously active to 'archived' so
// exactly one stays active (past generated_documents still point at their
// own frozen version_id regardless).
router.post('/:id/versions/:versionId/activate', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows: versionRows } = await db.query('SELECT * FROM template_versions WHERE id = $1 AND template_id = $2', [req.params.versionId, template.id]);
    if (!versionRows[0]) return res.status(404).json({ error: 'Version not found' });

    const { rows: unmapped } = await db.query(
      `SELECT label FROM template_fields WHERE version_id = $1 AND required AND NOT placed`,
      [req.params.versionId]
    );
    if (unmapped.length > 0) {
      return res.status(400).json({
        error: 'Some required fields are not mapped yet',
        unmapped_fields: unmapped.map((f) => f.label),
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE template_versions SET status = 'archived' WHERE template_id = $1 AND status = 'active'`, [template.id]);
      await client.query(`UPDATE template_versions SET status = 'active' WHERE id = $1`, [req.params.versionId]);
      await client.query(`UPDATE document_templates SET status = 'active', updated_at = NOW() WHERE id = $1`, [template.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
      action: 'activate', performedBy: req.user.membershipId, metadata: { version_id: req.params.versionId },
    });

    res.json({ message: 'Template activated' });
  } catch (err) {
    next(err);
  }
});

// POST /api/document-templates/:id/assignments
router.post('/:id/assignments', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { scope, scope_value } = req.body;
    if (!['organization', 'service', 'industry', 'insurance'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be organization, service, industry, or insurance' });
    }
    if (scope !== 'organization' && !scope_value) {
      return res.status(400).json({ error: 'scope_value is required for a non-organization scope' });
    }
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { rows } = await db.query(
      `INSERT INTO template_assignments (organization_id, template_id, scope, scope_value) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.organizationId, template.id, scope, scope === 'organization' ? null : scope_value]
    );

    await logAction({
      organizationId: req.user.organizationId, entityType: 'document_template', entityId: template.id,
      action: 'default_changed', performedBy: req.user.membershipId, metadata: { scope, scope_value },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/document-templates/:id/assignments/:assignmentId
router.delete('/:id/assignments/:assignmentId', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const template = await getOwnedTemplate(req.params.id, req.user.organizationId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { rows } = await db.query(
      'DELETE FROM template_assignments WHERE id = $1 AND template_id = $2 RETURNING *',
      [req.params.assignmentId, template.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Assignment not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
