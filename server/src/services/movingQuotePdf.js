import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

const CO = {
  name: 'PurpleBox Moving',
  tagline: 'Professional Moving Services — Dubai',
  addr1: 'Al Quoz 2, Warehouse 12, ABA Avenue',
  addr2: ' Dubai 333759',
  country: 'U.A.E',
  phone: '0097143293924',
  email: 'moving@purplebox.ae',
};

const DARK = '#1F2937';
const GRAY = '#6B7280';
const LGRAY = '#9CA3AF';
const BLACK = '#111827';
const TH_BG = '#374151';
const WHITE = '#FFFFFF';
const BORDER = '#E5E7EB';
const ROW_ALT = '#F9FAFB';

function num(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function aed(n) { return `AED ${num(n)}`; }
function dt(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function generateMovingQuotePdf(quote) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: quote.quoteNo || 'Moving Quote' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = 595.28;
    const PH = 841.89;
    const M = 50;
    const LX = M;
    const LW = 245;
    const RX = LX + LW + 35;
    const RW = PW - M - RX;

    // Header
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
      .text(quote.quoteNo || '', M, 38, { width: PW - 2 * M, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(dt(quote.quoteDate), M, 52, { width: PW - 2 * M, align: 'right' });
    doc.font('Helvetica').fontSize(36).fillColor(DARK)
      .text('QUOTE', M, 68, { width: PW - 2 * M, align: 'center' });

    // Left column
    let ly = 132;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Bill To', LX, ly);
    ly += 13;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLACK)
      .text(quote.customer?.fullName || '-', LX, ly, { width: LW });
    ly = doc.y + 8;

    if (quote.customer?.phone) {
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.customer.phone, LX, ly, { width: LW });
      ly = doc.y + 6;
    }
    if (quote.customer?.email) {
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.customer.email, LX, ly, { width: LW });
      ly = doc.y + 8;
    }

    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Quote Date :', LX, ly, { width: LW });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(dt(quote.quoteDate), LX + 95, ly, { width: LW - 95 });
    ly += 16;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Expiry Date :', LX, ly, { width: LW });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(dt(quote.expiryDate), LX + 95, ly, { width: LW - 95 });
    ly += 16;

    if (quote.job?.jobNo) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Job No :', LX, ly, { width: LW });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.job.jobNo, LX + 95, ly, { width: LW - 95 });
      ly += 16;
    }
    if (quote.salesperson) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Salesperson :', LX, ly, { width: LW });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.salesperson, LX + 95, ly, { width: LW - 95 });
      ly += 16;
    }

    // Right column — company info
    let ry = 132;
    drawCompanyLogo(doc, RX, ry, 44);
    ry += 52;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK).text(CO.name, RX, ry, { width: RW });
    ry += 14;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(CO.tagline, RX, ry, { width: RW });
    ry += 12;
    doc.font('Helvetica').fontSize(8).fillColor(BLACK).text(CO.addr1, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.addr2, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.country, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.phone, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.email, RX, ry, { width: RW });

    // Move details block (pickup / delivery)
    let y = Math.max(ly + 12, ry + 12);

    if (quote.job?.pickupAddress || quote.job?.deliveryAddress) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 10;
      const halfW = (PW - 2 * M - 20) / 2;
      if (quote.job?.pickupAddress) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('Pickup', M, y);
        doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.job.pickupAddress, M, doc.y + 2, { width: halfW });
      }
      if (quote.job?.deliveryAddress) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('Delivery', M + halfW + 20, y);
        doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.job.deliveryAddress, M + halfW + 20, y + 10, { width: halfW });
      }
      y = doc.y + 12;
    }

    // Items table
    const TX = M;
    const TW = PW - 2 * M;
    const nW = 32;
    const qW = 45;
    const rW = 80;
    const aW = 80;
    const iW = TW - nW - qW - rW - aW;

    const hH = 26;
    doc.rect(TX, y, TW, hH).fill(TH_BG);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
    doc.text('#', TX + 8, y + 8, { width: nW - 8 });
    doc.text('Description', TX + nW + 6, y + 8, { width: iW - 12 });
    doc.text('Qty', TX + nW + iW, y + 8, { width: qW, align: 'right' });
    doc.text('Rate', TX + nW + iW + qW, y + 8, { width: rW, align: 'right' });
    doc.text('Amount', TX + nW + iW + qW + rW, y + 8, { width: aW - 8, align: 'right' });
    y += hH;

    (quote.items || []).forEach((it, idx) => {
      const rH = 26;
      if (idx % 2 === 1) doc.rect(TX, y, TW, rH).fill(ROW_ALT);
      doc.font('Helvetica').fontSize(9).fillColor(BLACK);
      doc.text(String(idx + 1), TX + 8, y + 8, { width: nW - 8 });
      doc.text(it.description || '-', TX + nW + 6, y + 8, { width: iW - 12 });
      doc.text(String(it.qty ?? 1), TX + nW + iW, y + 8, { width: qW, align: 'right' });
      doc.text(num(it.rate), TX + nW + iW + qW, y + 8, { width: rW, align: 'right' });
      doc.text(num(it.amount), TX + nW + iW + qW + rW, y + 8, { width: aW - 8, align: 'right' });
      y += rH;
    });

    doc.moveTo(TX, y).lineTo(TX + TW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 16;

    // Totals
    const tX = TX + nW + iW;
    const lblW = qW + rW;
    const valX = tX + lblW;
    const valW = aW - 8;

    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sub Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(num(quote.subTotal), valX, y, { width: valW, align: 'right' });
    y += 16;

    if (quote.discount) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Discount', tX, y, { width: lblW, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(`-${num(quote.discount)}`, valX, y, { width: valW, align: 'right' });
      y += 16;
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK).text('Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK).text(aed(quote.total), valX, y, { width: valW, align: 'right' });
    y += 30;

    if (quote.depositRequired) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Deposit Required (${quote.depositPct}%)`, tX, y, { width: lblW, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(aed((quote.total * (quote.depositPct || 0)) / 100), valX, y, { width: valW, align: 'right' });
      y += 16;
    }

    // Notes
    if (quote.notes) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Notes', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(8).fillColor(DARK).text(quote.notes, M, y, { width: PW - 2 * M });
      y = doc.y + 12;
    }

    if (quote.termsAndConditions) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Terms & Conditions', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(8).fillColor(DARK).text(quote.termsAndConditions, M, y, { width: PW - 2 * M });
    }

    // Footer
    doc.moveTo(M, PH - 35).lineTo(PW - M, PH - 35).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(LGRAY).text('1', M, PH - 24, { width: PW - 2 * M, align: 'right' });

    doc.end();
  });
}
