import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

/**
 * Placeholders available in the agreement template. Each resolves from the
 * populated contract (customer/unit/units populated).
 */
export function agreementPlaceholders(contract) {
  const customer = contract.customer || {};
  const allUnits = contract.units?.length ? contract.units : contract.unit ? [contract.unit] : [];
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const weeks = contract.startDate && contract.endDate
    ? Math.max(1, Math.ceil(Math.round((new Date(contract.endDate) - new Date(contract.startDate)) / 86400000) / 7))
    : '';

  return {
    customerName: customer.fullName || '',
    customerEmail: customer.email || '',
    customerPhone: (customer.phones && customer.phones[0]) || customer.phone || '',
    customerAddress: customer.address || '',
    emiratesId: customer.emiratesId || '',
    passportNumber: customer.passportNumber || '',
    contractNo: contract.contractNo || '',
    startDate: fmt(contract.startDate),
    endDate: fmt(contract.endDate),
    todayDate: fmt(new Date()),
    weeks: String(weeks),
    unitNumbers: allUnits.map((u) => u.unitNumber).filter(Boolean).join(', '),
    unitSizes: allUnits.map((u) => (u.sizeSqf != null ? `${u.sizeSqf} sqft` : '')).filter(Boolean).join(', '),
    rate: money(contract.rate),
    leasedPrice: money(contract.leasedPrice || contract.rate),
    deposit: money(contract.deposit),
    totalQuotation: money(contract.totalQuotation),
  };
}

/** Replaces {{name}} tokens; unknown tokens are left visible so gaps show. */
export function mergeAgreementText(template, contract) {
  const values = agreementPlaceholders(contract);
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m,
  );
}

/**
 * Renders agreement text to a PDF. Light structure rules:
 *   line starting with "# "  → section heading (bold, larger)
 *   line starting with "## " → sub-heading (bold)
 *   blank line               → paragraph break
 * Ends with the signature block used by the signing flow.
 */
export function renderAgreementTextPdf({ text, contract, signedDate }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCompanyLogo(doc, 56, 44, 48);
    doc.fontSize(18).font('Helvetica-Bold').text('STORAGE AGREEMENT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10.5).font('Helvetica').fillColor('#555')
      .text(`Contract No: ${contract.contractNo || ''}`, { align: 'center' });
    doc.moveDown(1.2).fillColor('#000');

    for (const rawLine of String(text || '').split('\n')) {
      const line = rawLine.trimEnd();
      if (!line.trim()) { doc.moveDown(0.55); continue; }
      if (line.startsWith('## ')) {
        doc.moveDown(0.25);
        doc.fontSize(11).font('Helvetica-Bold').text(line.slice(3));
        doc.moveDown(0.2);
      } else if (line.startsWith('# ')) {
        doc.moveDown(0.4);
        doc.fontSize(12.5).font('Helvetica-Bold').text(line.slice(2));
        doc.moveDown(0.25);
      } else {
        doc.fontSize(10).font('Helvetica').text(line, { lineGap: 2 });
      }
    }

    // Signature block — same shape the signing flow stamps into
    doc.moveDown(2);
    const y = doc.y > 700 ? (doc.addPage(), doc.y) : doc.y;
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.fontSize(10).font('Helvetica-Bold').text('Tenant signature:', 56, y);
    doc.font('Helvetica').text('_________________________', 56, y + 28);
    doc.font('Helvetica-Bold').text('For PurpleBox Storage:', 320, y);
    doc.font('Helvetica').text('_________________________', 320, y + 28);
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9.5).fillColor('#555')
      .text(signedDate ? `Signed on ${fmt(signedDate)}` : `Generated on ${fmt(new Date())}`, 56);

    doc.end();
  });
}
