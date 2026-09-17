import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AuditLog } from '../models/index.js';

/* The wording is versioned rather than edited in place: a signature already
 * recorded stores which version it saw (see signingRecordSchema), so a later
 * change to this text can never quietly reinterpret what an old signer
 * actually agreed to. Bump the version whenever the wording changes.
 *
 * Mirrors the consent checkbox copy in client/src/pages/SignContract.tsx and
 * SignMovingJob.tsx — same convention services/movingTotals.js already uses
 * ("the client mirror computes the same figures"): kept in sync by hand
 * rather than shared code, since client and server don't share a package. */
export const CONSENT_TEXT_VERSION = 'v1';
export function consentText(signerName) {
  return `I, ${signerName}, confirm that I have read and agree to all terms and conditions of this document. I understand that this electronic signature is legally binding under UAE Federal Decree-Law No. 46 of 2021 on Electronic Transactions and Trust Services.`;
}

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Pure: assembles the structured record signingRecordSchema expects. */
export function buildSigningRecord({
  method, signerName, signedAt, req, documentHash, signedPdfHash,
  signatureMode = 'typed', consentTextVersion = CONSENT_TEXT_VERSION, consentText: consentTextOverride,
}) {
  return {
    method,
    signerName,
    signedAt,
    ipAddress: req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || '',
    consentTextVersion,
    consentText: consentTextOverride ?? consentText(signerName),
    signatureMode,
    documentHash,
    signedPdfHash,
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
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
 * Appends a DocuSign-style Certificate of Completion as the final page of an
 * already-built signed PDF. Must be called with the hash of the PDF as it
 * stood BEFORE this page is added (signingRecord.signedPdfHash) — the
 * certificate always describes exactly the document it is physically
 * attached to, never a moving target.
 */
export async function appendSigningCertificate(pdfBuffer, record, documentLabel) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const marginX = 56;
  const maxWidth = width - marginX * 2;
  const ink = rgb(0.08, 0.05, 0.2);
  const gray = rgb(0.42, 0.42, 0.42);
  let y = height - 70;

  const draw = (text, { size = 10, useBold = false, color = ink, gap = 18 } = {}) => {
    page.drawText(text, { x: marginX, y, size, font: useBold ? bold : font, color });
    y -= gap;
  };
  const drawWrapped = (text, opts = {}) => {
    for (const line of wrapText(text, opts.useBold ? bold : font, opts.size ?? 9, maxWidth)) {
      draw(line, { ...opts, gap: opts.lineGap ?? 14 });
    }
  };

  draw('Certificate of Completion', { size: 18, useBold: true, gap: 34 });
  draw(documentLabel, { size: 11, useBold: true, gap: 24 });

  draw(`Signer: ${record.signerName}`, { gap: 16 });
  draw(`Signed: ${record.signedAt.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'long', timeStyle: 'medium' })} (Asia/Dubai)`, { gap: 16 });
  draw(`Signature method: ${record.method === 'in_house_token' ? `Electronic signature (${record.signatureMode})` : record.method === 'zoho_sign' ? 'Zoho Sign' : 'Recorded outside the system (paper/in-person)'}`, { gap: 16 });
  if (record.ipAddress) draw(`IP address: ${record.ipAddress}`, { gap: 16 });
  if (record.userAgent) drawWrapped(`Browser/device: ${record.userAgent}`, { size: 8.5, color: gray, gap: 28 });
  else y -= 12;

  draw('Consent statement agreed to:', { useBold: true, gap: 16 });
  drawWrapped(record.consentText, { size: 8.5, color: gray, lineGap: 12 });
  y -= 16;

  draw('Document integrity (SHA-256)', { useBold: true, gap: 16 });
  drawWrapped(`Signed document: ${record.signedPdfHash}`, { size: 8, color: gray, lineGap: 11 });
  drawWrapped(`Presented (unsigned) document: ${record.documentHash}`, { size: 8, color: gray, lineGap: 11 });
  y -= 8;
  drawWrapped('These hashes were computed at the moment of signing. Comparing them against a later copy of this document confirms whether it has since been altered.', { size: 8, color: gray, lineGap: 11 });
  y -= 16;

  drawWrapped('This certificate is provided pursuant to UAE Federal Decree-Law No. 46 of 2021 on Electronic Transactions and Trust Services.', { size: 8, color: gray, lineGap: 11 });

  return Buffer.from(await pdfDoc.save());
}

/**
 * The full in-house token-signing flow: hashes the document the signer was
 * shown, builds the signed PDF, hashes that too, appends the certificate,
 * and records everything onto the document (Contract or MovingJob) and the
 * audit log. Does NOT save() the document or handle upload/archival — the
 * caller still owns those, since what gets archived (Document vs
 * MovingDocument) and what else changes (contract status, unit sync, ...)
 * differs per document type.
 */
export async function recordSignature({
  doc, entityType, documentLabel, timelineText, req,
  signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode,
  buildUnsignedPdf, buildSignedPdf,
}) {
  const unsignedPdf = await buildUnsignedPdf();
  const documentHash = sha256Hex(unsignedPdf);

  const signedAt = new Date();
  const signedPdfBuffer = await buildSignedPdf(signedAt, {
    signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode,
  });
  const signedPdfHash = sha256Hex(signedPdfBuffer);

  const record = buildSigningRecord({
    method: 'in_house_token',
    signerName,
    signedAt,
    req,
    documentHash,
    signedPdfHash,
    signatureMode: signMode === 'draw' ? 'drawn' : 'typed',
  });

  const finalPdf = await appendSigningCertificate(signedPdfBuffer, record, documentLabel);

  doc.signingRecord = record;
  if (Array.isArray(doc.timeline)) doc.timeline.push({ at: signedAt, text: timelineText, author: 'Customer' });

  try {
    await AuditLog.create({
      action: 'document_signed',
      entity: entityType,
      entityId: String(doc._id),
      detail: `${signerName} signed via in_house_token from ${record.ipAddress || 'unknown IP'}`,
    });
  } catch (err) {
    console.error('AuditLog write failed for signing event:', err);
  }

  return { finalPdf, record };
}
