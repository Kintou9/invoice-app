const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const { generateSasUrl } = require('../services/azureBlob');

const router = express.Router();

// GET /api/documents — aggregates every blob-backed file a user has
// generated across the app (equipment photos, purchase receipts,
// generated invoice PDFs) into one feed. A worker sees only their own
// (technician_id / claim assignment); owner/manager see the whole org —
// same role-scoping pattern used by every other list route in this app.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const isWorker = req.user.role === 'worker';
    const orgParams = isWorker ? [req.user.organizationId, req.user.membershipId] : [req.user.organizationId];
    const techFilter = isWorker ? 'AND i.technician_id = $2' : '';
    const claimAssigneeFilter = isWorker ? 'AND c.assigned_to = $2' : '';

    const [photos, receipts, pdfs] = await Promise.all([
      db.query(
        `SELECT ip.id, ip.blob_url, ip.uploaded_at AS doc_date, c.claim_number, c.title AS claim_title
         FROM invoice_photos ip
         JOIN invoices i ON ip.invoice_id = i.id
         JOIN claims c ON i.claim_id = c.id
         WHERE i.organization_id = $1 ${techFilter}
         ORDER BY ip.uploaded_at DESC`,
        orgParams
      ),
      db.query(
        `SELECT pp.id, pp.receipt_blob_url AS blob_url, pp.created_at AS doc_date, c.claim_number, c.title AS claim_title
         FROM part_purchases pp
         JOIN claims c ON pp.claim_id = c.id
         WHERE c.organization_id = $1 AND pp.receipt_blob_url IS NOT NULL ${claimAssigneeFilter}
         ORDER BY pp.created_at DESC`,
        orgParams
      ),
      db.query(
        `SELECT i.id, i.pdf_blob_url AS blob_url, i.pdf_generated_at AS doc_date, c.claim_number, c.title AS claim_title
         FROM invoices i
         JOIN claims c ON i.claim_id = c.id
         WHERE i.organization_id = $1 AND i.pdf_blob_url IS NOT NULL ${techFilter}
         ORDER BY i.pdf_generated_at DESC`,
        orgParams
      ),
    ]);

    const documents = [
      ...photos.rows.map((r) => ({ ...r, type: 'photo', label: 'Job photo' })),
      ...receipts.rows.map((r) => ({ ...r, type: 'receipt', label: 'Purchase receipt' })),
      ...pdfs.rows.map((r) => ({ ...r, type: 'invoice_pdf', label: 'Invoice PDF' })),
    ]
      .sort((a, b) => new Date(b.doc_date) - new Date(a.doc_date))
      .map((d) => ({ ...d, sas_url: generateSasUrl(d.blob_url, 60) }));

    res.json(documents);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
