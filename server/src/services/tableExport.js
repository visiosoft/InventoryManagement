/**
 * Turning a table on screen into a file somebody can send.
 *
 * The rows come from the page rather than being re-queried here, so the file
 * matches what was on screen — the same filters, the same window, the same
 * order. Re-running the query would quietly produce a different document from
 * the one the person was looking at when they pressed the button, which is the
 * kind of difference nobody notices until it is in a customer's inbox.
 *
 * Two formats, because they are asked for different reasons: the workbook is
 * for somebody who wants to sort and total it, the PDF for somebody who wants
 * to send or print it.
 */

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const PURPLE = '#5B2BC9';
const INK = '#14081F';
const GRAY = '#756E80';
const LINE = '#E6E0F0';
const ROW_ALT = '#FBF8F3';

/** A cell as text. Numbers stay numbers in the workbook; here they are shown. */
const asText = (v) => (v == null ? '' : String(v));

export async function tableWorkbook({ title, subtitle, columns, rows }) {
   const wb = new ExcelJS.Workbook();
   wb.creator = 'PurpleBox';
   wb.created = new Date();
   const ws = wb.addWorksheet(String(title || 'Export').slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));

   ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF14081F' } };
   if (subtitle) ws.addRow([subtitle]).font = { size: 10, color: { argb: 'FF756E80' } };
   ws.addRow([]);

   const header = ws.addRow(columns.map((c) => c.label ?? c));
   header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
   header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B2BC9' } };
      cell.alignment = { vertical: 'middle' };
   });

   for (const r of rows) {
      /* A number stays a number so the spreadsheet can total it — the whole
         reason somebody asks for Excel rather than a PDF. */
      ws.addRow(columns.map((c, i) => {
         const v = Array.isArray(r) ? r[i] : r[c.key ?? c];
         return typeof v === 'number' ? v : asText(v);
      }));
   }

   columns.forEach((c, i) => {
      const width = Math.min(48, Math.max(
         10,
         String(c.label ?? c).length + 2,
         ...rows.slice(0, 400).map((r) => asText(Array.isArray(r) ? r[i] : r[c.key ?? c]).length + 2),
      ));
      ws.getColumn(i + 1).width = width;
      if (c.numeric) ws.getColumn(i + 1).numFmt = '#,##0.00';
   });

   ws.views = [{ state: 'frozen', ySplit: 4 }];
   ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };

   return Buffer.from(await wb.xlsx.writeBuffer());
}

export function tablePdf({ title, subtitle, columns, rows, company }) {
   return new Promise((resolve, reject) => {
      // Landscape: these are wide tables, and a portrait page turns eight
      // columns into eight slivers.
      // bufferPages, so the page count is known when the footers are written.
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, bufferPages: true, info: { Title: String(title || 'Export') } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW = 841.89;
      const PH = 595.28;
      const M = 32;
      const TW = PW - 2 * M;

      const widths = (() => {
         const weights = columns.map((c, i) => Math.max(
            String(c.label ?? c).length,
            ...rows.slice(0, 200).map((r) => Math.min(28, asText(Array.isArray(r) ? r[i] : r[c.key ?? c]).length)),
         ));
         const total = weights.reduce((s, w) => s + w, 0) || 1;
         return weights.map((w) => Math.max(48, (w / total) * TW));
      })();
      const scale = TW / widths.reduce((s, w) => s + w, 0);
      const W = widths.map((w) => w * scale);

      let y = 0;
      let page = 0;

      const header = () => {
         page += 1;
         doc.rect(0, 0, PW, 4).fill(PURPLE);
         doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(String(title || ''), M, 26);
         let sy = doc.y + 2;
         if (subtitle) {
            doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(subtitle, M, sy, { width: TW - 210 });
            sy = doc.y;
         }
         doc.font('Helvetica').fontSize(8).fillColor(GRAY)
            .text(`${company?.name || 'PurpleBox'} · ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' })}`,
               PW - M - 260, 28, { width: 260, align: 'right' });
         y = Math.max(sy, 46) + 10;
         columnHeader();
      };

      const columnHeader = () => {
         const h = 20;
         doc.rect(M, y, TW, h).fill(PURPLE);
         doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
         let x = M;
         columns.forEach((c, i) => {
            doc.text(String(c.label ?? c), x + 5, y + 6, { width: W[i] - 10, ellipsis: true, lineBreak: false });
            x += W[i];
         });
         y += h;
      };

      header();

      doc.font('Helvetica').fontSize(8.5);
      rows.forEach((r, idx) => {
         const cells = columns.map((c, i) => asText(Array.isArray(r) ? r[i] : r[c.key ?? c]));
         const h = Math.max(18, ...cells.map((t, i) => doc.heightOfString(t, { width: W[i] - 10 }) + 8));

         // A row is never split across two pages: half a row at a fold reads
         // as a different record.
         if (y + h > PH - 30) { doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 }); header(); doc.font('Helvetica').fontSize(8.5); }

         if (idx % 2 === 1) doc.rect(M, y, TW, h).fill(ROW_ALT);
         doc.fillColor(INK);
         let x = M;
         cells.forEach((t, i) => {
            doc.text(t, x + 5, y + 5, { width: W[i] - 10, ellipsis: true });
            x += W[i];
         });
         doc.moveTo(M, y + h).lineTo(M + TW, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
         y += h;
      });

      if (!rows.length) {
         doc.font('Helvetica').fontSize(10).fillColor(GRAY).text('Nothing to show.', M, y + 16, { width: TW, align: 'center' });
      }

      // Page numbers last, when the count is known.
      const range = doc.bufferedPageRange?.() ?? { start: 0, count: page };
      for (let i = 0; i < range.count; i++) {
         doc.switchToPage?.(range.start + i);
         doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
            .text(`${rows.length} row${rows.length === 1 ? '' : 's'} · page ${i + 1} of ${range.count}`,
               M, PH - 22, { width: TW, align: 'right' });
      }

      doc.end();
   });
}
