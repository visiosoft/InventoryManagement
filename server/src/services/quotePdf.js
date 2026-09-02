import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

/* The letterhead now comes from the facility the units are in — see
   services/companyIdentity.js. FALLBACK_CO is the literal this file used to
   carry, so a quote for a facility nobody has filled in prints unchanged. */
import { FALLBACK_CO } from './companyIdentity.js';
import { quoteLines, quoteTotals } from './quoteLines.js';

// ── Palette ─────────────────────────────────────────────────────────────────
const DARK = '#1F2937';
const GRAY = '#6B7280';
const LGRAY = '#9CA3AF';
const BLACK = '#111827';
const TH_BG = '#374151';
const WHITE = '#FFFFFF';
const BORDER = '#E5E7EB';
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

export function renderQuotePdf({ quote, co }) {
   const CO = co ?? FALLBACK_CO;
   return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: quote.quoteNo || 'Quote' } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW = 595.28;
      const PH = 841.89;
      const M = 50;

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

      // Company logo
      drawCompanyLogo(doc, RX, ry, 44, CO.logo);
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
      if (CO.trn) {
         ry += 11;
         doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text(`TRN: ${CO.trn}`, RX, ry, { width: RW });
      }

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
      const TX = M;
      const TW = PW - 2 * M;   // 495.28
      const nW = 32;            // #
      const qW = 45;            // Qty
      const rW = 80;            // Rate
      const aW = 80;            // Amount
      const iW = TW - nW - qW - rW - aW; // Item & Description

      // Header row
      const hH = 26;
      doc.rect(TX, y, TW, hH).fill(TH_BG);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
      doc.text('#', TX + 8, y + 8, { width: nW - 8 });
      doc.text('Item & Description', TX + nW + 6, y + 8, { width: iW - 12 });
      doc.text('Weeks', TX + nW + iW, y + 8, { width: qW, align: 'right' });
      doc.text('Rate/wk', TX + nW + iW + qW, y + 8, { width: rW, align: 'right' });
      doc.text('Amount', TX + nW + iW + qW + rW, y + 8, { width: aW - 8, align: 'right' });
      y += hH;

      // Build display rows: units first (name + rental period), then add-ons, then legacy items.
      const rows = quoteLines(quote);

      rows.forEach((r, idx) => {
         doc.font('Helvetica-Bold').fontSize(9);
         const titleH = doc.heightOfString(r.title, { width: iW - 12 });
         doc.font('Helvetica').fontSize(8);
         const subH = r.sub ? doc.heightOfString(r.sub, { width: iW - 12 }) : 0;
         const rH = Math.max(26, titleH + subH + 14);

         if (idx % 2 === 1) doc.rect(TX, y, TW, rH).fill(ROW_ALT);
         doc.font('Helvetica').fontSize(9).fillColor(BLACK);
         doc.text(String(idx + 1), TX + 8, y + 8, { width: nW - 8 });
         doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
            .text(r.title, TX + nW + 6, y + 8, { width: iW - 12 });
         if (r.sub) {
            doc.font('Helvetica').fontSize(8).fillColor(GRAY)
               .text(r.sub, TX + nW + 6, y + 8 + titleH + 2, { width: iW - 12 });
         }
         doc.font('Helvetica').fontSize(9).fillColor(BLACK);
         doc.text(String(r.qty), TX + nW + iW, y + 8, { width: qW, align: 'right' });
         doc.text(num(r.rate), TX + nW + iW + qW, y + 8, { width: rW, align: 'right' });
         doc.text(num(r.amount), TX + nW + iW + qW + rW, y + 8, { width: aW - 8, align: 'right' });
         y += rH;
      });

      // Table bottom line
      doc.moveTo(TX, y).lineTo(TX + TW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 16;

      // ── TOTALS BLOCK ──────────────────────────────────────────────────────
      // Aligned to Qty+Rate+Amount columns on the right
      const tX = TX + nW + iW;       // start of Qty column
      const lblW = qW + rW;            // label spans Qty+Rate
      const valX = tX + lblW;          // value starts at Amount column
      const valW = aW - 8;

      // Sub Total (recomputed from rows)
      const grandSubTotal = rows.reduce((s, r) => s + r.amount, 0);
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Sub Total', tX, y, { width: lblW, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(BLACK)
         .text(num(grandSubTotal), valX, y, { width: valW, align: 'right' });
      y += 16;

      // Adjustment (only if non-zero)
      if (quote.adjustment && quote.adjustment !== 0) {
         doc.font('Helvetica').fontSize(9).fillColor(GRAY)
            .text('Adjustment', tX, y, { width: lblW, align: 'right' });
         doc.font('Helvetica').fontSize(9).fillColor(BLACK)
            .text(num(quote.adjustment), valX, y, { width: valW, align: 'right' });
         y += 16;
      }

      const adjustment = Number(quote.adjustment || 0);

      /* VAT, on the taxable rows only.
         *
         * The sub total above is every row, and two of those rows — the
         * security deposit and the refundable advance — are money held and
         * given back rather than sold, so they are outside the tax base.
         * Taxing the sub total would bill the customer 5% of a sum they are
         * owed, and would print a figure the system does not hold. Each row
         * carries its own `taxable` flag so this cannot drift from the list
         * above it. */
      const { vatRate, vatAmount } = quoteTotals(quote, rows);
      if (vatRate > 0) {
         doc.font('Helvetica').fontSize(9).fillColor(GRAY)
            .text(`VAT (${vatRate}%)`, tX, y, { width: lblW, align: 'right' });
         doc.font('Helvetica').fontSize(9).fillColor(BLACK)
            .text(num(vatAmount), valX, y, { width: valW, align: 'right' });
         y += 16;
      }

      // Total (bold)
      const grandTotal = grandSubTotal + adjustment + vatAmount;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
         .text('Total', tX, y, { width: lblW, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BLACK)
         .text(aed(grandTotal), valX, y, { width: valW, align: 'right' });
      y += 16;
      y += 14;

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

      // ── TERMS & CONDITIONS ────────────────────────────────────────────────
      // A quotation that does not carry its terms is a price with nothing
      // behind it, so these are printed rather than referred to.
      const terms = String(quote.termsAndConditions || '')
         .split('\n').map((t) => t.trim()).filter(Boolean);
      if (terms.length) {
         // Start a page rather than run the terms off the bottom of this one:
         // half a clause is worse than a clean page break.
         const needed = 26 + terms.length * 22;
         if (y + needed > PH - 60) { doc.addPage(); y = M; }

         doc.moveTo(M, y).lineTo(PW - M, y).strokeColor(BORDER).lineWidth(0.5).stroke();
         y += 12;
         doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text('Terms & Conditions', M, y);
         y += 14;

         for (const line of terms) {
            doc.font('Helvetica').fontSize(7.5).fillColor(DARK)
               .text('\u2022', M, y, { width: 10 })
               .text(line, M + 10, y, { width: PW - 2 * M - 10 });
            y = doc.y + 4;
         }
         y += 8;
      }

      // ── PAGE FOOTER ───────────────────────────────────────────────────────
      doc.moveTo(M, PH - 35).lineTo(PW - M, PH - 35).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(LGRAY)
         .text('1', M, PH - 24, { width: PW - 2 * M, align: 'right' });

      doc.end();
   });
}
