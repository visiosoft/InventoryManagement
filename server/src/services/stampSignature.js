import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { agreementTemplateExists } from './agreementPdf.js';

/**
 * Stamps a drawn or typed signature onto the last page of a PDF buffer.
 * Returns a new Buffer with the signature embedded.
 *
 * Coordinates are calibrated for:
 *   - Agreement template (1119 × 1583 pt): sigX=180, sigY=1060
 *   - Fallback A4 generated PDF (595 × 842 pt): sigX=56, sigY=148
 */
export async function stampSignature(pdfBuffer, { signerName, signatureDataUrl, signMode, signedAt = new Date() }) {
  const isTemplate = agreementTemplateExists();

  const sigX = isTemplate ? 180 : 56;
  const sigY = isTemplate ? 1060 : 148;
  const maxW = isTemplate ? 260 : 195;
  const maxH = isTemplate ? 72  : 52;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const last   = pdfDoc.getPages().at(-1);
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const nameSize = isTemplate ? 12 : 9;
  const dateStr  = signedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  if (signMode === 'draw' && signatureDataUrl?.startsWith('data:image/png;base64,')) {
    const base64   = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
    const sigImg   = await pdfDoc.embedPng(Buffer.from(base64, 'base64'));
    const scale    = Math.min(maxW / sigImg.width, maxH / sigImg.height);

    // Blank the placeholder text on the template before drawing the image
    if (isTemplate) {
      last.drawRectangle({ x: sigX - 4, y: sigY - 4, width: maxW + 16, height: maxH + 24, color: rgb(1, 1, 1) });
    }

    last.drawImage(sigImg, { x: sigX, y: sigY, width: sigImg.width * scale, height: sigImg.height * scale });
    last.drawText(signerName,          { x: sigX, y: sigY - nameSize - 4,  size: nameSize,     font, color: rgb(0.05, 0.05, 0.15) });
    last.drawText(`Signed: ${dateStr}`,{ x: sigX, y: sigY - nameSize - 18, size: nameSize - 1, font, color: rgb(0.45, 0.45, 0.45) });

  } else {
    // Type mode — render the name in large italic as the visual signature
    const sigFontSize = isTemplate ? 28 : 22;

    if (isTemplate) {
      last.drawRectangle({ x: sigX - 4, y: sigY - 4, width: maxW + 16, height: maxH + 24, color: rgb(1, 1, 1) });
    }

    last.drawText(signerName, { x: sigX, y: sigY + 8, size: sigFontSize, font: italic, color: rgb(0.05, 0.05, 0.15) });
    last.drawText(signerName, { x: sigX, y: sigY - nameSize - 4,  size: nameSize,     font, color: rgb(0.05, 0.05, 0.15) });
    last.drawText(`Signed electronically: ${dateStr}`, { x: sigX, y: sigY - nameSize - 18, size: nameSize - 1, font, color: rgb(0.45, 0.45, 0.45) });
  }

  return Buffer.from(await pdfDoc.save());
}
