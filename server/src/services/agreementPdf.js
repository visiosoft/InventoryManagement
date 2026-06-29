import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Fills the official PurpleBox "Customer Agreement" template
// (server/templates/customer-agreement.pdf) with contract/customer data.
// The template is a flat PDF (no AcroForm fields), so values are drawn at
// fixed coordinates on the Licensee Information form (page 1) and the
// signature block (last page). Page size: 1119 x 1583 pt.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/customer-agreement.pdf');

export function agreementTemplateExists() {
  return fs.existsSync(TEMPLATE_PATH);
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export async function fillAgreementPdf({ contract, customer, unit, signedDate }) {
  const bytes = fs.readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.13, 0.12, 0.25);

  const page1 = doc.getPage(0);
  const size = 13;
  const draw = (page, text, x, y, opts = {}) => {
    if (!text) return;
    page.drawText(String(text), { x, y, size: opts.size || size, font, color: ink });
  };

  // --- Page 1: Licensee Information (box left edge ≈ x 229, label column to the left) ---
  draw(page1, customer.fullName, 240, 952);                       // Full Name
  draw(page1, customer.address, 240, 888);                        // Address
  draw(page1, customer.phone, 240, 824);                          // Contact Number
  draw(page1, customer.email, 755, 824);                          // Email Address
  draw(page1, customer.emergencyNumber || '', 240, 760);          // Emergency Number
  draw(page1, fmtDate(contract.startDate), 240, 694);             // Move In Date
  draw(page1, fmtDate(contract.endDate), 755, 694);               // Move Out Date
  const allUnits = contract.units?.length > 1 ? contract.units : [unit];
  const unitLine = allUnits.length > 1
    ? `Units: ${allUnits.map((u) => `${u.unitNumber} (${u.sizeSqf ?? '—'} sqft)`).join(', ')} @ ${Number(contract.rate).toFixed(2)} ${contract.billingPeriod}`
    : `${unit.sizeSqf ?? '—'} sq ft — Unit ${unit.unitNumber} (${contract.billingPeriod} @ ${Number(contract.rate).toFixed(2)})`;
  draw(page1, unitLine, 240, 630);                                                              // App. Unit Size
  draw(page1, `Contract No: ${contract.contractNo}`, 240, 566);   // Access row (left box)

  // --- Last page: signature block ---
  const last = doc.getPage(doc.getPageCount() - 1);
  draw(last, customer.fullName, 190, 1022);                       // Name (print)
  if (signedDate) {
    draw(last, fmtDate(signedDate), 190, 964);                    // Date Signed
  }

  // --- Shared unit: append Licence Agreement page ---
  const isShared = allUnits.some((u) => u.shared);
  if (isShared) {
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const extraPage = doc.addPage([595, 842]); // A4
    const { width, height } = extraPage.getSize();
    const margin = 56;
    let y = height - margin;

    extraPage.drawText('LICENCE AGREEMENT — SHARED STORAGE UNIT', {
      x: margin, y, size: 13, font: boldFont, color: ink,
    });
    y -= 28;

    const clauseText =
      'For shared storage units, clients will not have 24/7 access, and no key will be provided. ' +
      'Access to the facility and shared storage unit is permitted only during business hours, ' +
      'from 10:00 AM to 6:00 PM, by prior appointment and while accompanied by a Purplebox staff ' +
      'member. Clients must contact us in advance to schedule their visit.';

    // Word-wrap the clause text at ~75 chars per line
    const words = clauseText.split(' ');
    let line = '';
    const lineHeight = 18;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > 78 && line) {
        extraPage.drawText(line, { x: margin, y, size: 11, font, color: ink });
        y -= lineHeight;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      extraPage.drawText(line, { x: margin, y, size: 11, font, color: ink });
      y -= lineHeight * 2;
    }

    // Signature block
    extraPage.drawText('Tenant Signature: _______________________________', { x: margin, y, size: 11, font, color: ink });
    extraPage.drawText('Date: _______________________________', { x: margin + 350, y, size: 11, font, color: ink });
    y -= 22;
    extraPage.drawText(customer.fullName || '', { x: margin, y, size: 10, font, color: ink });
  }

  return Buffer.from(await doc.save());
}
