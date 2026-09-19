const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { downloadBuffer } = require('./azureBlob');

const TARGET_PAGE_WIDTH = 612; // US Letter width in points, matches invoicePdf.js
const ROW_HEIGHT = 14;

// Sniffs the real file signature rather than trusting the blob URL's
// extension — a phone-camera photo uploaded straight through (no PDF
// rendering step) keeps its real filename/extension from the browser,
// which isn't guaranteed to match what the caller labeled the upload
// (e.g. a real JPEG saved under a page-N.png name), and pdf-lib's
// embedPng/embedJpg throw on a format mismatch.
function embedForMimeType(doc, buffer) {
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return isPng ? doc.embedPng(buffer) : doc.embedJpg(buffer);
}

/**
 * Renders a document from an uploaded template: the version's rasterized
 * page image(s) are embedded as a full-page background (exactly what the
 * owner saw and mapped fields onto in the Map Your Form workspace — the
 * original PDF stays kept as-is for provenance/download, but the generated
 * document always renders from this same visual source the mapping was
 * actually built against, so what you mapped is what you get), then every
 * field's value is drawn at its stored document-relative coordinates.
 *
 * fieldValuesByFieldId: { [template_fields.id]: string | Array<Record> }
 * (an array value is only meaningful for a 'table' field — one row per item).
 */
async function generateFromTemplate({ pages, fields, fieldValuesByFieldId }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const fieldsByPage = {};
  for (const f of fields) {
    (fieldsByPage[f.page_number] = fieldsByPage[f.page_number] || []).push(f);
  }

  for (const templatePage of pages.sort((a, b) => a.page_number - b.page_number)) {
    const imageBuffer = await downloadBuffer(templatePage.image_blob_url);
    const image = await embedForMimeType(doc, imageBuffer);

    const scale = TARGET_PAGE_WIDTH / image.width;
    const pageWidth = TARGET_PAGE_WIDTH;
    const pageHeight = image.height * scale;
    const page = doc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

    for (const field of fieldsByPage[templatePage.page_number] || []) {
      if (!field.placed) continue; // an unplaced field has no real coordinates to draw at
      const value = fieldValuesByFieldId[field.id];
      const boxX = Number(field.x) * pageWidth;
      const boxTopY = pageHeight - Number(field.y) * pageHeight;
      const boxWidth = Number(field.width) * pageWidth;

      if (field.field_type === 'table' && Array.isArray(value)) {
        let rowY = boxTopY - ROW_HEIGHT;
        for (const row of value) {
          const text = [row.description, row.quantity, row.unit_price, row.total_price]
            .filter((v) => v !== undefined && v !== null).join('   ');
          page.drawText(String(text).slice(0, 90), { x: boxX, y: rowY, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
          rowY -= ROW_HEIGHT;
        }
      } else if (value !== undefined && value !== null && value !== '') {
        const text = String(value).slice(0, Math.max(10, Math.floor(boxWidth / 4.5)));
        page.drawText(text, { x: boxX, y: boxTopY - 10, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
      }
    }
  }

  return Buffer.from(await doc.save());
}

module.exports = { generateFromTemplate };
