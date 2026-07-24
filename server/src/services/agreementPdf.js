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

const calcWeeks = (start, end) => {
  const ms = new Date(end) - new Date(start);
  return Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
};

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
  draw(page1, `${customer.fullName}  (${contract.contractNo})`, 240, 952); // Full Name + Contract No
  draw(page1, customer.address, 240, 888);                        // Address
  draw(page1, customer.phone, 240, 824);                          // Contact Number
  draw(page1, customer.email, 755, 824);                          // Email Address
  draw(page1, customer.emergencyNumber || '', 240, 760);          // Emergency Number
  draw(page1, fmtDate(contract.startDate), 240, 694);             // Move In Date
  draw(page1, fmtDate(contract.endDate), 755, 694);               // Move Out Date
  const allUnits = contract.units?.length > 1 ? contract.units : [unit];
  const weeks = calcWeeks(contract.startDate, contract.endDate);
  const unitLine = allUnits.length > 1
    ? `Units: ${allUnits.map((u) => `${u.unitNumber} (${u.sizeSqf ?? '—'} sqft)`).join(', ')} (${weeks} weeks)`
    : `${unit.sizeSqf ?? '—'} sq ft — Unit ${unit.unitNumber} (${weeks} weeks)`;
  draw(page1, unitLine, 240, 630);                                                              // App. Unit Size
  // Access row: contract no + authorized persons across the 4 cells
  const accessNames = [];
  for (const ap of contract.authorizedPersons || []) {
    const label = ap.name || '';
    const id = ap.idNumber ? `${ap.idType || 'ID'}: ${ap.idNumber}` : '';
    accessNames.push([label, id].filter(Boolean).join(' — '));
  }
  const cellXs = [240, 460, 680, 900];
  accessNames.slice(0, 4).forEach((txt, i) => {
    draw(page1, txt, cellXs[i], 566, { size: 11 });
  });

  // --- Last page: signature block ---
  const last = doc.getPage(doc.getPageCount() - 1);
  draw(last, customer.fullName, 190, 1022);                       // Name (print)
  if (signedDate) {
    draw(last, fmtDate(signedDate), 190, 964);                    // Date Signed
  }

  return Buffer.from(await doc.save());
}
