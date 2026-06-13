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
  draw(
    page1,
    `${unit.sizeSqf ?? '—'} sq ft — Unit ${unit.unitNumber} (${contract.billingPeriod} @ ${Number(contract.rate).toFixed(2)})`,
    240,
    630
  );                                                              // App. Unit Size
  draw(page1, `Contract No: ${contract.contractNo}`, 240, 566);   // Access row (left box)

  // --- Last page: signature block ---
  const last = doc.getPage(doc.getPageCount() - 1);
  draw(last, customer.fullName, 190, 1022);                       // Name (print)
  if (signedDate) {
    draw(last, fmtDate(signedDate), 190, 964);                    // Date Signed
    draw(last, `Signed electronically — ${contract.contractNo}`, 200, 1087, { size: 11 }); // Signature line
  }

  return Buffer.from(await doc.save());
}
