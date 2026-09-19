const express = require('express');
const db = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { generateIssueDescription, suggestParts } = require('../services/claude');
const { generateSasUrl, uploadBuffer } = require('../services/azureBlob');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { generateFromTemplate } = require('../services/documentPdf');
const { resolveTemplateAssignment } = require('../services/documentTemplates');
const { notify, notifyReviewers } = require('../services/notifications');
const { logAction } = require('../services/auditLog');
const { allowsServiceCallFee } = require('../utils/industryTemplates');

const router = express.Router();

// Explicit column list, never `cost` — that column is exclusive to the
// internal part-purchases billing flow (routes/partPurchases.js) and must
// never reach the invoice editor or a generated PDF.
const LINE_ITEM_COLUMNS = 'id, invoice_id, description, quantity, unit, unit_price, total_price, created_at, updated_at';

async function resolveTemplate(organizationId, fieldTemplateId) {
  if (fieldTemplateId) {
    const { rows } = await db.query(
      'SELECT * FROM invoice_field_templates WHERE id = $1 AND organization_id = $2 AND NOT is_archived',
      [fieldTemplateId, organizationId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    'SELECT * FROM invoice_field_templates WHERE organization_id = $1 AND is_default AND NOT is_archived',
    [organizationId]
  );
  return rows[0] || null;
}

function snapshotFromTemplate(template) {
  return {
    template_id: template.id,
    name: template.name,
    industry_key: template.industry_key,
    logo_blob_url: template.logo_blob_url,
    contact_name: template.contact_name,
    contact_email: template.contact_email,
    contact_phone: template.contact_phone,
    contact_address: template.contact_address,
    payment_terms: template.payment_terms,
    optional_features: template.optional_features,
    fields: template.fields,
  };
}

// Every visible && required field in the snapshot must have a non-empty
// value before an invoice can be submitted for review.
function validateFieldValues(snapshot, fieldValues) {
  const missing = [];
  for (const f of snapshot?.fields || []) {
    if (!f.visible || !f.required) continue;
    const value = fieldValues?.[f.id];
    if (value === undefined || value === null || value === '') missing.push(f.label);
  }
  return missing;
}

// GET /api/invoices?claim_id=... — list invoices for a claim
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id } = req.query;
    let query, params;

    // technician_id is organization_members.id, not users.id — join through
    // the membership to get a display name. The lateral join adds a
    // computed line-item total per invoice (0 for an org/invoice that's
    // never used the template/line-items feature) — purely additive, every
    // existing consumer of this list just ignores the extra field.
    if (req.user.role === 'worker') {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title,
               c.customer_name, c.customer_phone, c.job_address, c.date_of_service,
               u.name AS technician_name, COALESCE(totals.total, 0) + i.service_call_fee AS invoice_total,
               COALESCE(pay.paid, 0) AS amount_paid
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT SUM(total_price) AS total FROM invoice_line_items WHERE invoice_id = i.id
        ) totals ON true
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id = i.id
        ) pay ON true
        WHERE i.organization_id = $1 AND i.technician_id = $2 ${claim_id ? 'AND i.claim_id = $3' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.organizationId, req.user.membershipId, claim_id] : [req.user.organizationId, req.user.membershipId];
    } else {
      query = `
        SELECT i.*, c.claim_number, c.title AS claim_title,
               c.customer_name, c.customer_phone, c.job_address, c.date_of_service,
               u.name AS technician_name, COALESCE(totals.total, 0) + i.service_call_fee AS invoice_total,
               COALESCE(pay.paid, 0) AS amount_paid
        FROM invoices i
        JOIN claims c ON i.claim_id = c.id
        LEFT JOIN organization_members om ON i.technician_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT SUM(total_price) AS total FROM invoice_line_items WHERE invoice_id = i.id
        ) totals ON true
        LEFT JOIN LATERAL (
          SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id = i.id
        ) pay ON true
        WHERE i.organization_id = $1 ${claim_id ? 'AND i.claim_id = $2' : ''}
        ORDER BY i.created_at DESC`;
      params = claim_id ? [req.user.organizationId, claim_id] : [req.user.organizationId];
    }

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/stats — org-wide billing summary for the manager's
// Invoices page (Outstanding / Overdue / Paid this month cards). Registered
// before GET /:id so "stats" is never swallowed as an :id param.
router.get('/stats', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { rows: outstandingRows } = await db.query(
      `WITH inv AS (
         SELECT i.due_date,
                COALESCE(li.total, 0) + i.service_call_fee - COALESCE(pay.paid, 0) AS balance_due
         FROM invoices i
         LEFT JOIN LATERAL (SELECT SUM(total_price) AS total FROM invoice_line_items WHERE invoice_id = i.id) li ON true
         LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id = i.id) pay ON true
         WHERE i.organization_id = $1 AND i.status = 'approved'
       )
       SELECT
         COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0), 0) AS outstanding,
         COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0 AND due_date < CURRENT_DATE), 0) AS overdue
       FROM inv`,
      [req.user.organizationId]
    );

    const { rows: paidRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid_this_month
       FROM invoice_payments
       WHERE organization_id = $1 AND recorded_at >= date_trunc('month', CURRENT_DATE)`,
      [req.user.organizationId]
    );

    res.json({
      outstanding: outstandingRows[0].outstanding,
      overdue: outstandingRows[0].overdue,
      paid_this_month: paidRows[0].paid_this_month,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, c.title AS claim_title,
              c.customer_name, c.customer_phone, c.job_address,
              c.type_brand, c.date_of_service,
              u.name AS technician_name,
              t.name AS template_name, t.prompt_text AS template_prompt
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       LEFT JOIN organization_members om ON i.technician_id = om.id
       LEFT JOIN users u ON om.user_id = u.id
       LEFT JOIN invoice_templates t ON i.template_id = t.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fetch associated photos, parts, and line items — safe to scope by
    // invoice_id alone, since the invoice itself was already confirmed to
    // belong to this org above.
    const [photosResult, partsResult, lineItemsResult, paymentsResult] = await Promise.all([
      db.query('SELECT * FROM invoice_photos WHERE invoice_id = $1 ORDER BY uploaded_at', [req.params.id]),
      db.query(
        `SELECT p.*, json_agg(psl.*) FILTER (WHERE psl.id IS NOT NULL) AS supplier_links
         FROM parts p
         LEFT JOIN part_supplier_links psl ON p.id = psl.part_id
         WHERE p.invoice_id = $1
         GROUP BY p.id
         ORDER BY p.created_at`,
        [req.params.id]
      ),
      db.query(
        `SELECT ${LINE_ITEM_COLUMNS} FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at`,
        [req.params.id]
      ),
      db.query(
        `SELECT ip.*, u.name AS recorded_by_name
         FROM invoice_payments ip
         LEFT JOIN organization_members om ON ip.recorded_by = om.id
         LEFT JOIN users u ON om.user_id = u.id
         WHERE ip.invoice_id = $1
         ORDER BY ip.recorded_at DESC`,
        [req.params.id]
      ),
    ]);

    // Attach a short-lived SAS URL to each photo so the frontend can display it directly
    const photos = photosResult.rows.map((p) => ({
      ...p,
      sas_url: generateSasUrl(p.blob_url, 60),
    }));

    // The template snapshot's logo lives in a private Blob container like
    // every other upload — attach a short-lived SAS URL for on-screen
    // display without mutating what's actually stored on the invoice.
    const snapshot = rows[0].field_template_snapshot;
    const snapshotWithLogoSas = snapshot?.logo_blob_url
      ? { ...snapshot, logo_sas_url: generateSasUrl(snapshot.logo_blob_url, 60) }
      : snapshot;

    const lineItemsTotal = lineItemsResult.rows.reduce((sum, li) => sum + Number(li.total_price), 0);
    const invoiceTotal = lineItemsTotal + (Number(rows[0].service_call_fee) || 0);
    const amountPaid = paymentsResult.rows.reduce((sum, p) => sum + Number(p.amount), 0);

    res.json({
      ...rows[0], field_template_snapshot: snapshotWithLogoSas,
      photos, parts: partsResult.rows, line_items: lineItemsResult.rows,
      payments: paymentsResult.rows,
      invoice_total: invoiceTotal,
      amount_paid: amountPaid,
      balance_due: invoiceTotal - amountPaid,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/payments — owner/manager records a payment against
// an approved invoice
router.post('/:id/payments', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { amount, method, notes } = req.body;
    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (method !== undefined && method !== null && !['cash', 'card', 'check', 'other'].includes(method)) {
      return res.status(400).json({ error: 'method must be cash, card, check, or other' });
    }

    const { rows: invRows } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!invRows[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (invRows[0].status !== 'approved') {
      return res.status(409).json({ error: 'Only an approved invoice can take a payment' });
    }

    const { rows: lineItemsRows } = await db.query(
      'SELECT COALESCE(SUM(total_price), 0) AS total FROM invoice_line_items WHERE invoice_id = $1',
      [req.params.id]
    );
    const { rows: paidRows } = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = $1',
      [req.params.id]
    );
    const invoiceTotal = Number(lineItemsRows[0].total) + Number(invRows[0].service_call_fee);
    const alreadyPaid = Number(paidRows[0].paid);
    const remaining = invoiceTotal - alreadyPaid;
    if (numericAmount - remaining > 0.005) {
      return res.status(400).json({ error: `Amount exceeds the remaining balance of $${remaining.toFixed(2)}` });
    }

    const { rows } = await db.query(
      `INSERT INTO invoice_payments (organization_id, invoice_id, amount, method, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.organizationId, req.params.id, numericAmount, method || null, notes || null, req.user.membershipId]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'record_payment',
      performedBy: req.user.membershipId,
      metadata: { amount: numericAmount, method: method || null },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/invoices/:id/payments/:paymentId — owner only, corrects a
// mis-recorded payment
router.delete('/:id/payments/:paymentId', authenticate, authorize('owner'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `DELETE FROM invoice_payments
       WHERE id = $1 AND invoice_id = $2 AND organization_id = $3
       RETURNING *`,
      [req.params.paymentId, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'delete_payment',
      performedBy: req.user.membershipId,
      metadata: { amount: Number(rows[0].amount) },
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices — worker creates invoice for a claim
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { claim_id, template_id, field_template_id } = req.body;
    if (!claim_id) return res.status(400).json({ error: 'claim_id is required' });

    // Verify the claim exists in this organization, and is assigned to this
    // worker (or owner/manager creating on behalf)
    const { rows: claimRows } = await db.query(
      'SELECT * FROM claims WHERE id = $1 AND organization_id = $2',
      [claim_id, req.user.organizationId]
    );
    if (!claimRows[0]) return res.status(404).json({ error: 'Claim not found' });

    const claim = claimRows[0];
    if (req.user.role === 'worker' && claim.assigned_to !== req.user.membershipId) {
      return res.status(403).json({ error: 'This claim is not assigned to you' });
    }

    const technicianId = req.user.role === 'worker' ? req.user.membershipId : (claim.assigned_to || req.user.membershipId);

    // Resolves to the explicitly chosen template, else the org's default,
    // else null — an org that's never onboarded or set up a template gets
    // null here exactly like it always has, so its invoices behave
    // identically to before this feature existed.
    const template = await resolveTemplate(req.user.organizationId, field_template_id);
    const snapshot = template ? snapshotFromTemplate(template) : null;

    const { rows } = await db.query(
      `INSERT INTO invoices (organization_id, claim_id, template_id, technician_id, model_number, serial_number,
        issue_description, field_template_id, field_template_snapshot, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.organizationId, claim_id, template_id || null, technicianId,
        claim.model_number || null,
        claim.serial_number || null,
        claim.description || null,
        template ? template.id : null,
        snapshot ? JSON.stringify(snapshot) : null,
        template ? template.tax_rate : 0,
      ]
    );

    // Update claim status
    await db.query("UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1", [
      claim_id,
    ]);

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'create',
      performedBy: req.user.membershipId,
      metadata: { claim_id },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/invoices/:id — update invoice fields
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const {
      model_number, serial_number, issue_description, ai_generated_description,
      service_call_fee, payment_method, field_values, field_template_id,
    } = req.body;

    if (payment_method !== undefined && payment_method !== null && !['cash', 'card', 'check'].includes(payment_method)) {
      return res.status(400).json({ error: 'payment_method must be cash, card, or check' });
    }
    if (service_call_fee !== undefined && (Number.isNaN(Number(service_call_fee)) || Number(service_call_fee) < 0)) {
      return res.status(400).json({ error: 'service_call_fee must be a non-negative number' });
    }

    const { rows: existing } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && existing[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (existing[0].status === 'approved') {
      return res.status(409).json({ error: 'Cannot edit an approved invoice' });
    }
    // A service call fee only makes sense for trades that dispatch a
    // technician to a home or shop — reject it outright for any other
    // industry rather than silently accepting a value the UI never offers.
    if (service_call_fee !== undefined && Number(service_call_fee) > 0) {
      const industryKey = existing[0].field_template_snapshot?.industry_key;
      if (!allowsServiceCallFee(industryKey)) {
        return res.status(400).json({ error: 'A service call fee only applies to appliance, electrical, plumbing, HVAC, or auto repair invoices' });
      }
    }

    // Switching templates re-snapshots and preserves any field_values whose
    // key still exists on the new template — the frontend is expected to
    // warn the user before sending this when values would be dropped, but
    // the drop itself is enforced here so it can't be bypassed client-side.
    let newSnapshot;
    let newTaxRate;
    let mergedFieldValues = field_values
      ? { ...(existing[0].field_values || {}), ...field_values }
      : undefined;

    if (field_template_id !== undefined) {
      const template = field_template_id ? await resolveTemplate(req.user.organizationId, field_template_id) : null;
      if (field_template_id && !template) return res.status(404).json({ error: 'Template not found' });
      newSnapshot = template ? snapshotFromTemplate(template) : null;
      newTaxRate = template ? template.tax_rate : 0;

      const allowedIds = new Set((newSnapshot?.fields || []).map((f) => f.id));
      const base = mergedFieldValues || existing[0].field_values || {};
      mergedFieldValues = Object.fromEntries(Object.entries(base).filter(([key]) => allowedIds.has(key)));
    }

    const { rows } = await db.query(
      `UPDATE invoices SET
        model_number = COALESCE($1, model_number),
        serial_number = COALESCE($2, serial_number),
        issue_description = COALESCE($3, issue_description),
        ai_generated_description = COALESCE($4, ai_generated_description),
        service_call_fee = COALESCE($5, service_call_fee),
        payment_method = COALESCE($6, payment_method),
        field_values = COALESCE($7, field_values),
        field_template_id = CASE WHEN $8 THEN $9 ELSE field_template_id END,
        field_template_snapshot = CASE WHEN $8 THEN $10 ELSE field_template_snapshot END,
        tax_rate = CASE WHEN $8 THEN $11 ELSE tax_rate END,
        updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        model_number, serial_number, issue_description, ai_generated_description,
        service_call_fee !== undefined ? Number(service_call_fee) : null,
        payment_method,
        mergedFieldValues ? JSON.stringify(mergedFieldValues) : null,
        field_template_id !== undefined,
        field_template_id || null,
        newSnapshot ? JSON.stringify(newSnapshot) : null,
        newTaxRate,
        req.params.id,
      ]
    );

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'edit',
      performedBy: req.user.membershipId,
      metadata: { model_number, serial_number },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/submit — worker submits for manager review
router.post('/:id/submit', authenticate, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role === 'worker' && existing[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (existing[0].field_template_snapshot) {
      const missing = validateFieldValues(existing[0].field_template_snapshot, existing[0].field_values);
      if (missing.length) {
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      }
    }

    const { rows } = await db.query(
      "UPDATE invoices SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'pending_approval', updated_at = NOW() WHERE id = $1 RETURNING claim_number, customer_name, customer_phone, job_address, type_brand, insurance_company",
      [existing[0].claim_id]
    );

    await notifyReviewers({
      organizationId: req.user.organizationId,
      type: 'invoice_submitted',
      message: `Invoice for claim ${claimRows[0].claim_number} needs your review`,
      link: `/invoices/${rows[0].id}`,
    });

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'submit',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number },
    });

    // Best-effort PDF generation — never blocks the submit itself. A
    // failure here just leaves pdf_blob_url null; the frontend offers a
    // "Generate PDF" retry via POST /:id/generate-pdf.
    if (rows[0].field_template_snapshot) {
      try {
        await generateAndStorePdf(rows[0], claimRows[0], req.user.organizationId);
      } catch (pdfErr) {
        console.warn('Invoice PDF generation skipped at submit time:', pdfErr.message);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Real invoice/claim/line-item data behind each fixed Trackly field key a
// document template field can be mapped to (utils/documentTemplateFields.js
// on the frontend is the matching catalog of these same keys). A field
// mapped to anything else (a raw "custom:<label>" from AI detection that was
// never assigned to a real key) simply has nothing to auto-fill — same as
// leaving a field unmapped.
function resolveDocumentFieldValue(fieldKey, { invoice, claim, lineItems, subtotal, tax, total }) {
  const values = {
    invoice_number: invoice.id?.slice(0, 8).toUpperCase(),
    invoice_date: new Date(invoice.created_at).toLocaleDateString(),
    due_date: invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : null,
    job_number: claim.claim_number,
    claim_number: claim.claim_number,
    customer_name: claim.customer_name,
    customer_phone: claim.customer_phone,
    customer_email: claim.customer_email || null,
    service_address: claim.job_address,
    billing_address: claim.job_address,
    technician: invoice.technician_name || null,
    work_performed: invoice.ai_generated_description || invoice.issue_description,
    diagnosis: invoice.issue_description,
    parts: lineItems,
    labor: lineItems,
    tax: tax.toFixed(2),
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
    balance_due: total.toFixed(2),
    notes: invoice.manager_notes || null,
  };
  return values[fieldKey] ?? null;
}

async function generateAndStorePdf(invoice, claim, organizationId) {
  const { rows: lineItemsRows } = await db.query(
    `SELECT ${LINE_ITEM_COLUMNS} FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at`,
    [invoice.id]
  );

  // A document template — the business's own uploaded form — takes priority
  // over the generic Trackly-styled layout when one is actually assigned to
  // this invoice's context (most-specific-wins: insurance > service >
  // industry > organization default). Falls straight through to the
  // existing generic renderer when nothing matches, so an org that's never
  // touched this feature sees zero behavior change.
  const templateId = await resolveTemplateAssignment({
    organizationId,
    category: 'invoice',
    serviceType: claim.type_brand || null,
    industryKey: invoice.field_template_snapshot?.industry_key || null,
    insuranceCompany: claim.insurance_company || null,
  });

  if (templateId) {
    const { rows: activeVersionRows } = await db.query(
      `SELECT * FROM template_versions WHERE template_id = $1 AND status = 'active'`,
      [templateId]
    );
    if (activeVersionRows[0]) {
      const version = activeVersionRows[0];
      const { rows: pages } = await db.query('SELECT * FROM template_pages WHERE version_id = $1', [version.id]);
      const { rows: fields } = await db.query('SELECT * FROM template_fields WHERE version_id = $1', [version.id]);

      const subtotal = lineItemsRows.reduce((sum, li) => sum + Number(li.total_price), 0);
      const taxRate = Number(invoice.tax_rate) || 0;
      const tax = subtotal * (taxRate / 100);
      const total = subtotal + tax + (Number(invoice.service_call_fee) || 0);

      const fieldValuesByFieldId = {};
      for (const f of fields) {
        fieldValuesByFieldId[f.id] = resolveDocumentFieldValue(f.field_key.startsWith('custom:') ? null : f.field_key, { invoice, claim, lineItems: lineItemsRows, subtotal, tax, total });
      }

      const pdfBuffer = await generateFromTemplate({ pages, fields, fieldValuesByFieldId });
      const blobUrl = await uploadBuffer(pdfBuffer, `invoice-${invoice.id}.pdf`, `invoice-pdfs/${organizationId}`);

      await db.query(
        `UPDATE invoices SET pdf_blob_url = $1, pdf_generated_at = NOW(),
          due_date = COALESCE(due_date, CURRENT_DATE + INTERVAL '30 days')
         WHERE id = $2`,
        [blobUrl, invoice.id]
      );
      await db.query(
        `INSERT INTO generated_documents (organization_id, template_id, version_id, claim_id, invoice_id, pdf_blob_url, field_values, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [organizationId, templateId, version.id, invoice.claim_id || null, invoice.id, blobUrl, JSON.stringify(fieldValuesByFieldId), invoice.reviewed_by || null]
      );
      return blobUrl;
    }
  }

  const pdfBuffer = await generateInvoicePdf({
    invoice,
    claim,
    lineItems: lineItemsRows,
    snapshot: invoice.field_template_snapshot,
    fieldValues: invoice.field_values,
  });

  const blobUrl = await uploadBuffer(pdfBuffer, `invoice-${invoice.id}.pdf`, `invoice-pdfs/${organizationId}`);

  // due_date marks the invoice as actually issued to the customer (billing
  // status "ready to send" -> "unpaid" hinges on it being set) — stamped the
  // first time a PDF exists, net-30 from that moment, and never overwritten
  // by a later regeneration.
  await db.query(
    `UPDATE invoices SET pdf_blob_url = $1, pdf_generated_at = NOW(),
      due_date = COALESCE(due_date, CURRENT_DATE + INTERVAL '30 days')
     WHERE id = $2`,
    [blobUrl, invoice.id]
  );

  return blobUrl;
}

// POST /api/invoices/:id/generate-pdf — on-demand (re)generation, e.g. a
// retry after the best-effort attempt at submit time failed.
router.post('/:id/generate-pdf', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, c.customer_name, c.customer_phone, c.job_address, c.type_brand, c.insurance_company
       FROM invoices i JOIN claims c ON i.claim_id = c.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (rows[0].status === 'draft') {
      return res.status(400).json({ error: 'Submit the invoice before generating a PDF' });
    }

    const blobUrl = await generateAndStorePdf(rows[0], rows[0], req.user.organizationId);
    res.json({ pdf_url: generateSasUrl(blobUrl, 60) });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id/pdf — short-lived SAS URL to the already-generated PDF.
router.get('/:id/pdf', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT pdf_blob_url, technician_id FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (req.user.role === 'worker' && rows[0].technician_id !== req.user.membershipId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!rows[0].pdf_blob_url) return res.status(404).json({ error: 'PDF not generated yet' });

    res.json({ pdf_url: generateSasUrl(rows[0].pdf_blob_url, 60) });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/approve — manager approves
router.post('/:id/approve', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body || {};
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'approved',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [manager_notes || null, req.user.membershipId, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING claim_number",
      [rows[0].claim_id]
    );

    if (rows[0].technician_id) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].technician_id,
        type: 'invoice_approved',
        message: `Your invoice for claim ${claimRows[0].claim_number} was approved`,
        link: `/invoices/${rows[0].id}`,
      });
    }

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'approve',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number, manager_notes: manager_notes || null },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/reject — manager rejects
router.post('/:id/reject', authenticate, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { manager_notes } = req.body || {};
    const { rows } = await db.query(
      `UPDATE invoices SET
        status = 'rejected',
        manager_notes = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [manager_notes || null, req.user.membershipId, req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: claimRows } = await db.query(
      "UPDATE claims SET status = 'in_progress', updated_at = NOW() WHERE id = $1 RETURNING claim_number",
      [rows[0].claim_id]
    );

    if (rows[0].technician_id) {
      await notify({
        organizationId: req.user.organizationId,
        recipientMemberId: rows[0].technician_id,
        type: 'invoice_rejected',
        message: `Your invoice for claim ${claimRows[0].claim_number} was rejected`,
        link: `/invoices/${rows[0].id}`,
      });
    }

    await logAction({
      organizationId: req.user.organizationId,
      entityType: 'invoice',
      entityId: rows[0].id,
      action: 'reject',
      performedBy: req.user.membershipId,
      metadata: { claim_number: claimRows[0].claim_number, manager_notes: manager_notes || null },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/ai/describe — Claude generates issue description
router.post('/:id/ai/describe', authenticate, async (req, res, next) => {
  try {
    const { techNotes } = req.body;
    const { rows } = await db.query(
      `SELECT i.*, c.claim_number, t.prompt_text
       FROM invoices i
       JOIN claims c ON i.claim_id = c.id
       LEFT JOIN invoice_templates t ON i.template_id = t.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    let description;
    try {
      description = await generateIssueDescription({
        techNotes,
        modelNumber: invoice.model_number,
        serialNumber: invoice.serial_number,
        claimNumber: invoice.claim_number,
        templatePrompt: invoice.prompt_text,
      });
    } catch (aiErr) {
      console.error('AI describe error:', aiErr.message);
      return res.status(500).json({ error: 'AI service unavailable — check your Anthropic API key' });
    }

    await db.query(
      'UPDATE invoices SET ai_generated_description = $1, updated_at = NOW() WHERE id = $2',
      [description, req.params.id]
    );

    res.json({ description });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/ai/parts — Claude suggests parts
router.post('/:id/ai/parts', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user.organizationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = rows[0];
    let result;
    try {
      result = await suggestParts({
        issueDescription: invoice.issue_description || invoice.ai_generated_description,
        modelNumber: invoice.model_number,
        serialNumber: invoice.serial_number,
      });
    } catch (aiErr) {
      console.error('AI parts error:', aiErr.message);
      return res.status(500).json({ error: 'AI service unavailable — check your Anthropic API key' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
