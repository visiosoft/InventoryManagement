import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

const CO = {
  name: 'PurpleBox',
  tagline: 'Box Unit Storage',
  addr1: 'Al Quoz 2, Warehouse 12, ABA Avenue',
  addr2: 'Dubai 333759, U.A.E.',
  phone: '009714 329 3924',
  email: 'contact@purplebox.ae',
};

const PURPLE = '#5B2D8E';
const DARK = '#1F2937';
const GRAY = '#6B7280';
const LGRAY = '#D1D5DB';
const GREEN = '#059669';
const WHITE = '#FFFFFF';
const ROW_BG = '#F9FAFB';

function aed(n) { return `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmt(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; }
function cap(s) { return s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'; }

// Returns the end of the period covered by this payment (next billing date).
function periodEnd(dueDate, billingPeriod) {
  const d = new Date(dueDate);
  if (billingPeriod === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else {
    const day = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() < day) d.setDate(0); // handle short months
  }
  return d;
}

export function renderReceiptPdf({ payment, contract, customer, unit, receiptNo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Receipt ${receiptNo}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = 595.28;
    const M = 50;
    const CW = PW - M * 2;  // content width

    // ── Purple header band ───────────────────────────────────────────────────
    doc.rect(0, 0, PW, 110).fill(PURPLE);

    // Logo
    drawCompanyLogo(doc, M, 18, 54);

    // Company name + tagline
    doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE)
      .text(CO.name, M + 66, 22);
    doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.8)')
      .text(CO.tagline, M + 67, 47);

    // RECEIPT label (right side of header)
    doc.font('Helvetica-Bold').fontSize(30).fillColor(WHITE)
      .text('RECEIPT', 0, 28, { width: PW - M, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.8)')
      .text(receiptNo, 0, 64, { width: PW - M, align: 'right' });

    // ── Sub-header: issued date + contract ref ───────────────────────────────
    doc.rect(0, 110, PW, 36).fill('#F3F0F8');
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(`Issued: ${fmt(payment.paidDate || new Date())}`, M, 122)
      .text(`Contract: ${contract.contractNo}`, 0, 122, { width: PW - M, align: 'right' });

    let y = 168;

    // ── Bill To + Payment Info columns ───────────────────────────────────────
    const colW = CW / 2 - 10;

    // Left: Bill To
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY)
      .text('BILL TO', M, y);
    y += 16;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK)
      .text(customer.fullName, M, y);
    y += 18;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY);
    if (customer.clientId) { doc.text(`Client ID: ${customer.clientId}`, M, y); y += 13; }
    const phone = customer.phones?.[0] || customer.phone;
    if (phone) { doc.text(phone, M, y); y += 13; }
    if (customer.email) { doc.text(customer.email, M, y); y += 13; }
    if (customer.address) { doc.text(customer.address, M, y, { width: colW }); }

    // Right: Payment details
    const rx = M + colW + 20;
    let ry = 168;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('PAYMENT DETAILS', rx, ry);
    ry += 16;

    const infoRows = [
      ['Unit', `${unit.unitNumber}${unit.sizeSqf != null ? ` (${unit.sizeSqf} sq ft)` : ''}`],
      ['Billing period', cap(contract.billingPeriod)],
      ['Period covered', `${fmt(payment.dueDate)} → ${fmt(periodEnd(payment.dueDate, contract.billingPeriod))}`],
      ['Payment method', cap(payment.method)],
      ['Paid on', fmt(payment.paidDate)],
    ];
    const labelW = 110;
    const valueW = colW - labelW - 6;
    infoRows.forEach(([label, val]) => {
      const valueText = String(val || '—');
      const lineH = doc.currentLineHeight();
      const valueH = doc.heightOfString(valueText, { width: valueW });
      const rowH = Math.max(lineH, valueH);

      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
        .text(`${label}:`, rx, ry, { width: labelW });
      doc.font('Helvetica-Bold').fillColor(DARK)
        .text(valueText, rx + labelW + 6, ry, { width: valueW });

      ry += rowH + 4;
    });

    y = Math.max(y, ry) + 30;

    // ── Amount box ───────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 66).fill(PURPLE).stroke();
    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.75)')
      .text('AMOUNT PAID', M, y + 12, { width: CW, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(28).fillColor(WHITE)
      .text(aed(payment.amount), M, y + 28, { width: CW, align: 'center' });
    y += 66 + 24;

    // ── PAID stamp (rotated) ─────────────────────────────────────────────────
    doc.save();
    doc.translate(PW - M - 80, y - 66 - 24 + 20);
    doc.rotate(-18);
    doc.rect(-48, -22, 96, 44).lineWidth(3).strokeColor(GREEN).stroke();
    doc.font('Helvetica-Bold').fontSize(24).fillColor(GREEN).text('PAID', -48, -10, { width: 96, align: 'center' });
    doc.restore();

    // ── Notes (if any) ───────────────────────────────────────────────────────
    if (payment.notes) {
      doc.roundedRect(M, y, CW, 'auto').lineWidth(0);
      doc.rect(M, y, CW, 1).fill(LGRAY);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('NOTES', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(payment.notes, M, y, { width: CW });
      y += doc.heightOfString(payment.notes, { width: CW }) + 16;
    }

    // ── Divider ──────────────────────────────────────────────────────────────
    doc.rect(M, y, CW, 1).fill(LGRAY);
    y += 16;

    // ── Thank you + company contact ──────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PURPLE)
      .text('Thank you for your payment!', M, y, { width: CW, align: 'center' });
    y += 18;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(`${CO.addr1}, ${CO.addr2}`, M, y, { width: CW, align: 'center' });
    y += 13;
    doc.text(`${CO.phone}  ·  ${CO.email}`, M, y, { width: CW, align: 'center' });

    // ── Footer band ──────────────────────────────────────────────────────────
    doc.rect(0, 841.89 - 28, PW, 28).fill(PURPLE);
    doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.7)')
      .text(`${CO.name}  ·  ${receiptNo}  ·  Generated ${new Date().toLocaleDateString('en-GB')}`,
        0, 841.89 - 18, { width: PW, align: 'center' });

    doc.end();
  });
}
