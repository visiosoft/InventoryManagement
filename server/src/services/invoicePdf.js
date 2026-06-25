import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

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

const DEFAULT_TC =
  'Storage Terms and Conditions\n' +
  '1. Payment - Fees are payable in advance for each 28-day period.\n' +
  '2. Risk & Insurance - All items are stored at the customer\'s sole risk. Insurance is the customer\'s responsibility.\n' +
  '3. Prohibited Goods - Illegal, hazardous, flammable, or perishable items are strictly prohibited.\n' +
  '4. Customer Responsibility - The customer is responsible for packing, locking, and securing all items.\n' +
  '5. Late Payment - Late payments may result in denied access and additional charges.\n' +
  '6. Liability - Short Term Storage LLC is not liable for any loss or damage unless caused by proven negligence.\n' +
  '7. Access - Access is allowed only during official working hours.';

// ── Palette ─────────────────────────────────────────────────────────────────
const DARK      = '#1F2937';
const GRAY      = '#6B7280';
const LGRAY     = '#9CA3AF';
const RED       = '#DC2626';
const BLACK     = '#111827';
const TH_BG     = '#374151';   // table header background
const WHITE     = '#FFFFFF';
const BORDER    = '#E5E7EB';
const ROW_ALT   = '#F9FAFB';

// ── Helpers ──────────────────────────────────────────────────────────────────
function num(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function aed(n) { return `AED${num(n)}`; }
function dt(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function consolidateItems(items) {
  // Merge legacy weekly items ("Week N: DD Mon YYYY · Unit X") into one monthly line
  const weekPattern = /^Week\s+\d+:\s+(.+?)\s+·\s+(.+)$/;
  const weekItems = (items || []).filter(it => weekPattern.test(it.itemDetails || ''));
  const otherItems = (items || []).filter(it => !weekPattern.test(it.itemDetails || ''));

  if (weekItems.length < 2) return items || [];

  const total = Math.round(weekItems.reduce((s, it) => s + Number(it.amount || 0), 0) * 100) / 100;
  // Use the single-week rate (not the sum) so Qty × Rate = Amount works in the table
  const singleWeekRate = Number(weekItems[0].rate || 0);
  const discountPct = weekItems.some(it => (it.discountPct ?? 0) > 0)
    ? weekItems.find(it => (it.discountPct ?? 0) > 0)?.discountPct ?? 0
    : 0;

  // Extract unit from first weekly item and build a date range from first→last week start
  const firstMatch = weekPattern.exec(weekItems[0].itemDetails);
  const lastMatch  = weekPattern.exec(weekItems[weekItems.length - 1].itemDetails);
  const unitNo = firstMatch?.[2] ?? '';
  const fromDate = firstMatch?.[1] ?? '';
  // End date: last week start + 6 days
  let toDate = lastMatch?.[1] ?? '';
  try {
    const d = new Date(toDate.replace(/(\d{2})\s(\w{3})\s(\d{4})/, '$1 $2 $3'));
    d.setDate(d.getDate() + 6);
    toDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { /* keep raw */ }

  const merged = {
    sortOrder: 0,
    itemDetails: `Storage Rent ${fromDate} – ${toDate} · ${unitNo}`,
    quantity: weekItems.length,
    rate: singleWeekRate,
    discountPct,
    amount: total,
  };

  return [merged, ...otherItems];
}

export function renderInvoicePdf({ invoice }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: invoice.invoiceNo || 'Invoice' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Consolidate legacy weekly line items into one monthly line
    invoice = { ...invoice.toObject ? invoice.toObject() : invoice, items: consolidateItems(invoice.items) };

    const PW = 595.28;
    const PH = 841.89;
    const M  = 50;           // page margin

    // Column layout
    const LX = M;
    const LW = 245;          // left column width
    const RX = LX + LW + 35; // right column start
    const RW = PW - M - RX;  // right column width

    // ── TOP-RIGHT: invoice number + date ─────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
       .text(invoice.invoiceNo || '', M, 38, { width: PW - 2 * M, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text(dt(invoice.invoiceDate), M, 52, { width: PW - 2 * M, align: 'right' });

    // ── TITLE ─────────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(36).fillColor(DARK)
       .text('INVOICE', M, 68, { width: PW - 2 * M, align: 'center' });

    // ── LEFT COLUMN ───────────────────────────────────────────────────────
    let ly = 132;

    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Bill To', LX, ly);
    ly += 13;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLACK)
       .text(invoice.customer?.fullName || '-', LX, ly, { width: LW });
    ly = doc.y + 8;

    if (invoice.customer?.address) {
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(invoice.customer.address, LX, ly, { width: LW });
      ly = doc.y + 8;
    }

    // Terms row
    if (invoice.terms) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Terms :', LX, ly, { width: LW });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(invoice.terms, LX + 95, ly, { width: LW - 95 });
      ly += 16;
    }

    // Due date row
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Due Date :', LX, ly, { width: LW });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(dt(invoice.dueDate), LX + 95, ly, { width: LW - 95 });
    ly += 16;

    // Bank information (may be multi-line)
    if (invoice.bankInformation) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Bank Information :', LX, ly, { width: 105 });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(invoice.bankInformation, LX + 110, ly, { width: LW - 110 });
      ly = doc.y + 8;
    }

    // ── RIGHT COLUMN ──────────────────────────────────────────────────────
    let ry = 132;

    // Company logo
    drawCompanyLogo(doc, RX, ry, 44);
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

    // ── TOTAL SUMMARY BAR (below left column, above table) ────────────────
    const hdrBottom = Math.max(ly + 12, ry + 12);
    doc.moveTo(LX, hdrBottom).lineTo(LX + LW, hdrBottom)
       .strokeColor(BORDER).lineWidth(0.5).stroke();
    const sumY = hdrBottom + 8;
    doc.font('Helvetica').fontSize(10).fillColor(GRAY)
       .text('Total', LX, sumY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text(aed(invoice.total), LX, sumY, { width: LW, align: 'right' });
    const sumBottom = sumY + 18;
    doc.moveTo(LX, sumBottom).lineTo(LX + LW, sumBottom)
       .strokeColor(BORDER).lineWidth(0.5).stroke();

    let y = sumBottom + 28;

    // ── ITEMS TABLE ───────────────────────────────────────────────────────
    const TX  = M;
    const TW  = PW - 2 * M;   // 495.28
    const nW  = 28;            // # column
    const qW  = 36;            // Qty column
    const aW  = 90;            // Amount column
    const hasDiscount = (invoice.items || []).some(it => (it.discountPct ?? 0) > 0);
    const dW  = hasDiscount ? 65 : 0;  // Discount column (only when needed)
    const rW  = hasDiscount ? 75 : 85; // Rate column
    const iW  = TW - nW - qW - rW - dW - aW; // Item & Description column

    // Header row
    const hH = 26;
    doc.rect(TX, y, TW, hH).fill(TH_BG);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
    doc.text('#',                  TX + 6,                         y + 8, { width: nW - 6 });
    doc.text('Item & Description', TX + nW + 6,                    y + 8, { width: iW - 12 });
    doc.text('Qty',                TX + nW + iW,                   y + 8, { width: qW,      align: 'right' });
    doc.text('Rate',               TX + nW + iW + qW,              y + 8, { width: rW,      align: 'right' });
    if (hasDiscount) doc.text('Discount', TX + nW + iW + qW + rW, y + 8, { width: dW, align: 'right' });
    doc.text('Amount',             TX + nW + iW + qW + rW + dW,   y + 8, { width: aW - 8,  align: 'right' });
    y += hH;

    // Item rows
    const AMBER_BG = '#FFFBEB';
    (invoice.items || []).forEach((it, idx) => {
      const rH = 26;
      const discounted = (it.discountPct ?? 0) > 0;
      if (discounted) {
        doc.rect(TX, y, TW, rH).fill(AMBER_BG);
      } else if (idx % 2 === 1) {
        doc.rect(TX, y, TW, rH).fill(ROW_ALT);
      }
      doc.font('Helvetica').fontSize(9).fillColor(BLACK);
      doc.text(String(idx + 1),       TX + 6,                         y + 8, { width: nW - 6 });
      doc.text(it.itemDetails || '-', TX + nW + 6,                    y + 8, { width: iW - 12 });
      const qty = Number(it.quantity ?? 1);
      doc.text(qty !== 1 ? `${qty} wk` : '—', TX + nW + iW,          y + 8, { width: qW, align: 'right' });
      doc.text(num(it.rate),           TX + nW + iW + qW,              y + 8, { width: rW, align: 'right' });
      if (hasDiscount) {
        if (discounted) {
          doc.fillColor('#D97706').font('Helvetica-Bold')
            .text(`${it.discountPct}% off`, TX + nW + iW + qW + rW, y + 8, { width: dW, align: 'right' });
          doc.fillColor(BLACK).font('Helvetica');
        } else {
          doc.fillColor('#94A3B8').text('—', TX + nW + iW + qW + rW, y + 8, { width: dW, align: 'right' });
          doc.fillColor(BLACK);
        }
      }
      doc.text(num(it.amount),         TX + nW + iW + qW + rW + dW,   y + 8, { width: aW - 8, align: 'right' });
      y += rH;
    });

    // Table bottom line
    doc.moveTo(TX, y).lineTo(TX + TW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 16;

    // ── TOTALS BLOCK (right-aligned under Rate+Amount columns) ────────────
    const tX  = TX + nW + iW;  // start of Rate column = 365
    const lblW = rW;            // label fills Rate column
    const valX = tX + lblW;    // value starts at Amount column
    const valW = aW - 8;       // value width

    const paymentMade = invoice.paymentMade != null
      ? Number(invoice.paymentMade)
      : (invoice.status === 'paid' ? Number(invoice.total || 0) : 0);
    const balanceDue = Number(invoice.total || 0) - paymentMade;

    // Sub Total
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Sub Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(num(invoice.subTotal), valX, y, { width: valW, align: 'right' });
    y += 16;

    // Total (bold)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text('Total', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text(aed(invoice.total), valX, y, { width: valW, align: 'right' });
    y += 16;

    // Payment Made (red)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Payment Made', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(RED)
       .text(`(-) ${num(paymentMade)}`, valX, y, { width: valW, align: 'right' });
    y += 16;

    // Balance Due (bold)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text('Balance Due', tX, y, { width: lblW, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
       .text(aed(balanceDue), valX, y, { width: valW, align: 'right' });
    y += 30;

    // ── FOOTER SECTIONS ───────────────────────────────────────────────────
    const tc = invoice.termsAndConditions || DEFAULT_TC;
    const hasFooter = !!(invoice.customerNotes || tc);

    if (hasFooter) {
      doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 12;
    }

    if (invoice.customerNotes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Notes', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
         .text(invoice.customerNotes, M, y, { width: PW - 2 * M });
      y = doc.y + 12;
    }

    if (tc) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Terms & Conditions', M, y);
      y += 13;
      doc.font('Helvetica').fontSize(8).fillColor(DARK)
         .text(tc, M, y, { width: PW - 2 * M });
    }

    // ── PAGE FOOTER ───────────────────────────────────────────────────────
    doc.moveTo(M, PH - 35).lineTo(PW - M, PH - 35).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(LGRAY)
       .text('1', M, PH - 24, { width: PW - 2 * M, align: 'right' });

    doc.end();
  });
}
