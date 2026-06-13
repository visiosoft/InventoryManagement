import PDFDocument from 'pdfkit';

// ── Company constants ───────────────────────────────────────────────────────
const CO = {
  name: 'PurpleBox',
  tagline: 'powered by short term storage',
  addr1: 'Al Quoz 2, Warehouse 12, ABA Avenue',
  addr2: ' Dubai 333759',
  country: 'U.A.E',
  phone: '0097143293924',
  email: 'contact@purplebox.ae',
};

// ── Palette ─────────────────────────────────────────────────────────────────
const PURPLE  = '#5B2D8E';
const DARK    = '#1F2937';
const GRAY    = '#6B7280';
const LGRAY   = '#9CA3AF';
const BLACK   = '#111827';
const TH_BG   = '#374151';
const WHITE   = '#FFFFFF';
const BORDER  = '#E5E7EB';
const ROW_ALT = '#F9FAFB';

// ── Helpers ──────────────────────────────────────────────────────────────────
function num(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function aed(n) { return `AED${num(n)}`; }
function dt(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function renderQuotePdf({ quote }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: quote.quoteNo || 'Quote' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = 595.28;
    const PH = 841.89;
    const M  = 50;

    // Column layout
    const LX = M;
    const LW = 245;
    const RX = LX + LW + 35;
    const RW = PW - M - RX;

    // ── TOP-RIGHT: quote number + date ────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
       .text(quote.quoteNo || '', M, 38, { width: PW - 2 * M, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text(dt(quote.quoteDate), M, 52, { width: PW - 2 * M, align: 'right' });

    // ── TITLE ─────────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(36).fillColor(DARK)
       .text('QUOTE', M, 68, { width: PW - 2 * M, align: 'center' });

    // ── LEFT COLUMN ───────────────────────────────────────────────────────
    let ly = 132;

    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Bill To', LX, ly);
    ly += 13;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLACK)
       .text(quote.customer?.fullName || '-', LX, ly, { width: LW });
    ly = doc.y + 8;

    // Billing address (from quote or customer)
    const billAddr = quote.billingAddress || quote.customer?.address;
    if (billAddr) {
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(billAddr, LX, ly, { width: LW });
      ly = doc.y + 8;
    }

    // Quote date
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Quote Date :', LX, ly, { width: LW });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(dt(quote.quoteDate), LX + 95, ly, { width: LW - 95 });
    ly += 16;

    // Expiry date
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Expiry Date :', LX, ly, { width: LW });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(dt(quote.expiryDate), LX + 95, ly, { width: LW - 95 });
    ly += 16;

    // Salesperson
    if (quote.salesperson) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Salesperson :', LX, ly, { width: LW });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(quote.salesperson, LX + 95, ly, { width: LW - 95 });
      ly += 16;
    }

    // ── RIGHT COLUMN ──────────────────────────────────────────────────────
    let ry = 132;

    // Purple box logo
    doc.roundedRect(RX, ry, 44, 44, 6).fill(PURPLE);
    doc.font('Helvetica-Bold').fontSize(17).fillColor(WHITE)
       .text('PB', RX, ry + 13, { width: 44, align: 'center' });
    ry += 52;

    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK)
       .text(CO.name, RX, ry, { width: RW });
    ry += 14;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
       .text(CO.tagline, RX, ry, { width: RW });
    ry += 12;
    doc.font('Helvetica').fontSize(8).fillColor(BLACK)
       .text(CO.addr1, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.addr2, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.country, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.phone, RX, ry, { width: RW });
    ry += 11;
    doc.text(CO.email, RX, ry, { width: RW });

    // ── SUBJECT (full width, below header) ────────────────────────────────
    let y = Math.max(ly + 12, ry + 12);

    if (quote.subject) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 10;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Subject: ', M, y, { continued: true });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text(quote.subject);
      y = doc.y + 10;
    }

    // ── ITEMS TABLE ───────────────────────────────────────────────────────
    const TX  = M;
    const TW  = PW - 2 * M;   // 495.28
    const nW  = 32;            // #
    const qW  = 45;            // Qty
    const rW  = 80;            // Rate
    const aW  = 80;            // Amount
    const iW  = TW - nW - qW - rW - aW; // Item & Description

    // Header row
    const hH = 26;
    doc.rect(TX, y, TW, hH).fill(TH_BG);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
    doc.text('#',                  TX + 8,                  y + 8, { width: nW - 8 });
    doc.text('Item & Description', TX + nW + 6,             y + 8, { width: iW - 12 });
    doc.text('Qty',                TX + nW + iW,            y + 8, { width: qW,     align: 'right' });
    doc.text('Rate',               TX + nW + iW + qW,       y + 8, { width: rW,     align: 'right' });
    doc.text('Amount',             TX + nW + iW + qW + rW,  y + 8, { width: aW - 8, align: 'right' });
    y += hH;

    // Item rows
    (quote.items || []).forEach((it, idx) => {
      const rH = 26;
      if (idx % 2 === 1) doc.rect(TX, y, TW, rH).fill(ROW_ALT);
      doc.font('Helvetica').fontSize(9).fillColor(BLACK);
      doc.text(String(idx + 1),      TX + 8,                  y + 8, { width: nW - 8 });
      doc.text(it.itemDetails || '-', TX + nW + 6,            y + 8, { width: iW - 12 });
      doc.text(String(it.quantity ?? 0), TX + nW + iW,        y + 8, { width: qW,     align: 'right' });
      doc.text(num(it.rate),          TX + nW + iW + qW,      y + 8, { width: rW,     align: 'right' });
      doc.text(num(it.amount),        TX + nW + iW + qW + rW, y + 8, { width: aW - 8, align: 'right' });
      y += rH;
    });

    // Table bottom line
    doc.moveTo(TX, y).lineTo(TX + TW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 16;

    // ── TOTALS BLOCK ──────────────────────────────────────────────────────
    // Aligned to Qty+Rate+Amount columns on the right
    const tX   = TX + nW + iW;       // start of Qty column
    const lblW = qW + rW;            // label spans Qty+Rate
    const valX = tX + lblW;          // value starts at Amount column
    const valW = aW - 8;

    // Sub Total
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Sub Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(num(quote.subTotal), valX, y, { width: valW, align: 'right' });
    y += 16;

    // Adjustment (only if non-zero)
    if (quote.adjustment && quote.adjustment !== 0) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Adjustment', tX, y, { width: lblW, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(num(quote.adjustment), valX, y, { width: valW, align: 'right' });
      y += 16;
    }

    // Total (bold)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text('Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text(aed(quote.total), valX, y, { width: valW, align: 'right' });
    y += 30;

    // ── NOTES ─────────────────────────────────────────────────────────────
    if (quote.notes) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Notes', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
         .text(quote.notes, M, y, { width: PW - 2 * M });
      y = doc.y + 12;
    }

    // ── PAGE FOOTER ───────────────────────────────────────────────────────
    doc.moveTo(M, PH - 35).lineTo(PW - M, PH - 35).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(LGRAY)
       .text('1', M, PH - 24, { width: PW - 2 * M, align: 'right' });

    doc.end();
  });
}
