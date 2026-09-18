const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { downloadBuffer } = require('./azureBlob');

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders a customer-facing invoice PDF from scratch (no source document to
 * fill — pdf-lib is used here purely for page/text/image primitives).
 *
 * Reads only customer-visible data: shared invoice/claim fields, line items
 * (already cost-free — the caller's SELECT never includes invoice_line_items.cost),
 * and snapshot fields filtered to visible && customerVisible. Never touches
 * invoice_line_items.cost or part_purchases — those tables aren't passed in
 * and aren't queried here, so there is no code path by which internal
 * cost/margin data could end up on this PDF.
 */
async function generateInvoicePdf({ invoice, claim, lineItems, snapshot, fieldValues }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const drawLine = (text, { size = 10, f = font, color = rgb(0, 0, 0), x = MARGIN, gap = 16 } = {}) => {
    page.drawText(String(text), { x, y, size, font: f, color });
    y -= gap;
  };

  // Logo (top-left) — best-effort, never fails PDF generation if the blob
  // can't be fetched/embedded.
  if (snapshot?.logo_blob_url) {
    try {
      const logoBuffer = await downloadBuffer(snapshot.logo_blob_url);
      const isPng = snapshot.logo_blob_url.toLowerCase().includes('.png');
      const image = isPng ? await doc.embedPng(logoBuffer) : await doc.embedJpg(logoBuffer);
      const logoHeight = 48;
      const logoWidth = (image.width / image.height) * logoHeight;
      page.drawImage(image, { x: MARGIN, y: y - logoHeight + 10, width: logoWidth, height: logoHeight });
      y -= logoHeight - 4;
    } catch (err) {
      console.warn('PDF logo embed skipped:', err.message);
    }
  }

  drawLine(snapshot?.contact_name || 'Invoice', { size: 18, f: bold, gap: 22 });
  if (snapshot?.contact_email) drawLine(snapshot.contact_email, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  if (snapshot?.contact_phone) drawLine(snapshot.contact_phone, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  if (snapshot?.contact_address) drawLine(snapshot.contact_address, { size: 9, color: rgb(0.35, 0.35, 0.35) });

  y -= 10;
  drawLine(`Invoice #${invoice.id.slice(0, 8).toUpperCase()}`, { size: 12, f: bold });
  drawLine(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, { size: 10 });
  const optionalFeatures = snapshot?.optional_features || {};
  if (optionalFeatures.claim_number && claim?.claim_number) {
    drawLine(`Claim #: ${claim.claim_number}`, { size: 10 });
  }
  if (optionalFeatures.po_reference && fieldValues?.po_reference) {
    drawLine(`PO Reference: ${fieldValues.po_reference}`, { size: 10 });
  }

  y -= 8;
  drawLine('Customer', { size: 11, f: bold, gap: 15 });
  if (claim?.customer_name) drawLine(claim.customer_name, { size: 10 });
  if (claim?.job_address) drawLine(claim.job_address, { size: 10 });
  if (claim?.customer_phone) drawLine(claim.customer_phone, { size: 10 });

  // Template fields — only ones both visible and explicitly customer-visible.
  const visibleFields = (snapshot?.fields || []).filter((f) => f.visible && f.customerVisible);
  if (visibleFields.length) {
    y -= 8;
    drawLine('Job Details', { size: 11, f: bold, gap: 15 });
    for (const f of visibleFields.sort((a, b) => (a.order || 0) - (b.order || 0))) {
      const value = fieldValues?.[f.id];
      if (value === undefined || value === null || value === '') continue;
      const lines = wrapText(`${f.label}: ${value}`, font, 10, contentWidth);
      for (const line of lines) drawLine(line, { size: 10 });
    }
  }

  // Line items table
  y -= 8;
  drawLine('Line Items', { size: 11, f: bold, gap: 15 });
  drawLine('Description', { size: 9, f: bold, x: MARGIN, gap: 0 });
  page.drawText('Qty', { x: MARGIN + 260, y, size: 9, font: bold });
  page.drawText('Unit Price', { x: MARGIN + 320, y, size: 9, font: bold });
  page.drawText('Total', { x: MARGIN + 420, y, size: 9, font: bold });
  y -= 14;

  let subtotal = 0;
  for (const item of lineItems || []) {
    const total = Number(item.total_price);
    subtotal += total;
    const desc = item.unit ? `${item.description} (${item.quantity} ${item.unit})` : item.description;
    page.drawText(desc.slice(0, 45), { x: MARGIN, y, size: 9, font });
    page.drawText(String(item.quantity), { x: MARGIN + 260, y, size: 9, font });
    page.drawText(`$${Number(item.unit_price).toFixed(2)}`, { x: MARGIN + 320, y, size: 9, font });
    page.drawText(`$${total.toFixed(2)}`, { x: MARGIN + 420, y, size: 9, font });
    y -= 14;
  }

  const taxRate = Number(invoice.tax_rate) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  y -= 8;
  drawLine(`Subtotal: $${subtotal.toFixed(2)}`, { size: 10, x: MARGIN + 320 });
  if (taxRate > 0) drawLine(`Tax (${taxRate}%): $${tax.toFixed(2)}`, { size: 10, x: MARGIN + 320 });
  drawLine(`Total: $${total.toFixed(2)}`, { size: 12, f: bold, x: MARGIN + 320 });

  if (snapshot?.payment_terms) {
    y -= 10;
    drawLine('Payment Terms', { size: 11, f: bold, gap: 15 });
    for (const line of wrapText(snapshot.payment_terms, font, 10, contentWidth)) drawLine(line, { size: 10 });
  }

  if (optionalFeatures.notes && fieldValues?.notes) {
    y -= 10;
    drawLine('Notes', { size: 11, f: bold, gap: 15 });
    for (const line of wrapText(fieldValues.notes, font, 10, contentWidth)) drawLine(line, { size: 10 });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateInvoicePdf };
