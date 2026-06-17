import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { agreementTemplateExists } from './agreementPdf.js';

export async function stampSignature(pdfBuffer, {
  signerName,
  signatureDataUrl,
  signMode,
  initialsText,
  initialsDataUrl,
  initialsMode = 'type',
  signedAt = new Date(),
}) {
  const isTemplate = agreementTemplateExists();
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages  = pdfDoc.getPages();
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const ink  = rgb(0.05, 0.05, 0.15);
  const gray = rgb(0.45, 0.45, 0.45);
  const dateStr = signedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Embed initials image once (if drawn)
  let initialsImg = null;
  if (initialsMode === 'draw' && initialsDataUrl?.startsWith('data:image/png;base64,')) {
    initialsImg = await pdfDoc.embedPng(
      Buffer.from(initialsDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
    );
  }
  const initialsLabel = initialsText?.trim() ||
    signerName.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('');

  // Embed signature image once (if drawn) — reused on every page
  let sigImg = null;
  if (signMode === 'draw' && signatureDataUrl?.startsWith('data:image/png;base64,')) {
    sigImg = await pdfDoc.embedPng(
      Buffer.from(signatureDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
    );
  }

  // ── Stamp initials + mini-signature on every page except the last ──────────
  for (let i = 0; i < pages.length - 1; i++) {
    const page = pages[i];
    const { width } = page.getSize();

    const ix      = isTemplate ? width - 220 : width - 145;
    const dateY   = isTemplate ? 55  : 28;
    const initY   = isTemplate ? 69  : 38;
    const labelSz = isTemplate ? 8   : 6;
    const initSz  = isTemplate ? 18  : 13;

    // Initials
    if (initialsImg) {
      const maxW = isTemplate ? 90 : 65;
      const maxH = isTemplate ? 38 : 26;
      const scale = Math.min(maxW / initialsImg.width, maxH / initialsImg.height);
      page.drawImage(initialsImg, { x: ix, y: initY, width: initialsImg.width * scale, height: initialsImg.height * scale });
    } else {
      page.drawText(initialsLabel, { x: ix, y: initY, size: initSz, font: bold, color: ink });
    }

    // Date label under initials
    page.drawText(dateStr, { x: ix, y: dateY, size: labelSz, font, color: gray });

    // Mini signature under the date label
    const miniY = isTemplate ? 30 : 12;
    if (sigImg) {
      const miniMaxW = isTemplate ? 80 : 60;
      const miniMaxH = isTemplate ? 20 : 14;
      const scale = Math.min(miniMaxW / sigImg.width, miniMaxH / sigImg.height);
      page.drawImage(sigImg, { x: ix, y: miniY, width: sigImg.width * scale, height: sigImg.height * scale });
    } else {
      // Typed name in italic as mini-signature
      const miniSz = isTemplate ? 10 : 7;
      page.drawText(signerName, { x: ix, y: miniY, size: miniSz, font: italic, color: ink });
    }
  }

  // ── Full signature on the last page ───────────────────────────────────────
  const last   = pages.at(-1);
  const sigX   = isTemplate ? 180  : 56;
  const sigY   = isTemplate ? 1060 : 148;
  const maxW   = isTemplate ? 260  : 195;
  const maxH   = isTemplate ? 72   : 52;
  const nameSz = isTemplate ? 12   : 9;

  // White-out the entire signature area before stamping (template only)
  if (isTemplate) {
    last.drawRectangle({ x: sigX - 4, y: sigY - 4, width: maxW + 16, height: maxH + 40, color: rgb(1, 1, 1) });
  }

  if (sigImg) {
    const scale = Math.min(maxW / sigImg.width, maxH / sigImg.height);
    last.drawImage(sigImg, { x: sigX, y: sigY, width: sigImg.width * scale, height: sigImg.height * scale });
  } else {
    const sigFontSize = isTemplate ? 28 : 22;
    last.drawText(signerName, { x: sigX, y: sigY + 8, size: sigFontSize, font: italic, color: ink });
  }

  // For A4 fallback only: add printed name + date below signature (template has its own pre-filled fields)
  if (!isTemplate) {
    last.drawText(signerName, { x: sigX, y: sigY - nameSz - 4, size: nameSz, font, color: ink });
    last.drawText(dateStr, { x: sigX, y: sigY - nameSz - 16, size: nameSz - 1, font, color: gray });
  }

  return Buffer.from(await pdfDoc.save());
}
