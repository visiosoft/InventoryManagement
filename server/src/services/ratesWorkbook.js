/**
 * The Actual vs Leased report as a real Excel workbook.
 *
 * A CSV carries no design at all: no column widths, no bold totals, no
 * currency formatting, and no way to tell a floor subtotal from a unit row. So
 * this builds an actual .xlsx, styled to match the screen — purple headings,
 * the same block subtotals, and dirhams formatted as dirhams so a column can be
 * summed in Excel without cleaning it first.
 *
 * Built on the server so the library never reaches the browser bundle.
 */

import ExcelJS from 'exceljs';

/* The screen's tokens, as Excel wants them: ARGB, no hash. */
const PURPLE_600 = 'FF5B2BC9';
const PURPLE_50 = 'FFF7F3FF';
const PURPLE_700 = 'FF4A1FA0';
const INK = 'FF14081F';
const INK_3 = 'FF756E80';
const GOOD = 'FF1E8E5A';
const BAD = 'FFC0392B';
const PAPER = 'FFFBF8F2';

const MONEY = '#,##0;[Red]-#,##0';
const PERCENT = '0.0"%"';

const money = (cell, value) => {
  cell.value = value;
  cell.numFmt = MONEY;
};

/** Colour a variance the way the report does: green above asking, red below. */
const tone = (cell, value) => {
  if (value == null) return;
  cell.font = { ...(cell.font || {}), color: { argb: value >= 0 ? GOOD : BAD }, bold: true };
};

export async function buildRatesWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PurpleBox';
  wb.created = new Date();

  /* ── Sheet 1: the report ─────────────────────────────────────────────── */
  const ws = wb.addWorksheet('Actual vs leased', {
    views: [{ state: 'frozen', ySplit: 8 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { key: 'unit', width: 22 },
    { key: 'contract', width: 16 },
    { key: 'customer', width: 30 },
    { key: 'actual', width: 14 },
    { key: 'leased', width: 14 },
    { key: 'variance', width: 14 },
    { key: 'discount', width: 11 },
  ];

  const t = report.totals;

  const title = ws.addRow(['Actual vs leased']);
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: INK } };
  ws.mergeCells(title.number, 1, title.number, 7);

  const sub = ws.addRow([`${report.label} · what each unit is priced at, against what it actually let for`]);
  sub.font = { size: 10, color: { argb: INK_3 } };
  ws.mergeCells(sub.number, 1, sub.number, 7);
  ws.addRow([]);

  // The headline figures, so the sheet stands on its own away from the screen.
  const summary = [
    ['Units', t.units, 'Occupancy', t.occupancyPct == null ? '—' : t.occupancyPct / 100],
    ['Leased', t.leasedUnits, 'Monthly asking (all units)', t.actualAll],
    ['Vacant', t.vacantUnits, 'Monthly leased', t.leased],
    ['Unpriced', t.unpricedUnits, 'Asking price sitting empty', t.vacantValue],
  ];
  for (const [aLabel, aVal, bLabel, bVal] of summary) {
    const r = ws.addRow([aLabel, aVal, '', bLabel, bVal]);
    r.getCell(1).font = { bold: true, color: { argb: INK_3 }, size: 10 };
    r.getCell(4).font = { bold: true, color: { argb: INK_3 }, size: 10 };
    if (bLabel === 'Occupancy') r.getCell(5).numFmt = '0.0%';
    else r.getCell(5).numFmt = MONEY;
  }
  ws.addRow([]);

  const head = ws.addRow(['Unit', 'Contract', 'Customer', 'Actual', 'Leased', 'Variance', 'Discount']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_600 } };
    c.alignment = { vertical: 'middle', horizontal: c.col > 3 ? 'right' : 'left' };
  });

  for (const f of report.floors) {
    const block = ws.addRow([
      `${f.floor} · ${f.units} units · ${f.leasedUnits} leased (${f.occupancyPct ?? 0}%)`,
      '', '', f.actualAll, f.leased, f.variance, f.discountPct == null ? null : f.discountPct,
    ]);
    block.font = { bold: true, color: { argb: PURPLE_700 } };
    block.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_50 } }; });
    block.getCell(4).numFmt = MONEY;
    block.getCell(5).numFmt = MONEY;
    block.getCell(6).numFmt = MONEY;
    block.getCell(7).numFmt = PERCENT;
    tone(block.getCell(6), f.variance);

    for (const r of f.rows) {
      const row = ws.addRow([
        r.sizeSqf ? `${r.unitNumber} · ${r.sizeSqf} sqft` : r.unitNumber,
        r.contractNo || 'vacant',
        r.customer || '—',
        r.priced ? r.actual : null,
        r.occupied ? r.leased : null,
        r.variance,
        r.discountPct,
      ]);
      row.getCell(4).numFmt = MONEY;
      row.getCell(5).numFmt = MONEY;
      row.getCell(6).numFmt = MONEY;
      row.getCell(7).numFmt = PERCENT;
      // A vacant unit is greyed rather than dropped: the empty space is the
      // point of the report.
      if (!r.occupied) {
        row.font = { color: { argb: INK_3 }, italic: true };
        row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } }; });
      }
      tone(row.getCell(6), r.variance);
      if (r.discountPct != null) {
        row.getCell(7).font = { ...(row.getCell(7).font || {}), color: { argb: r.discountPct > 0 ? BAD : GOOD } };
      }
    }
  }

  ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: 7 } };

  /* ── Sheet 2: the trend ──────────────────────────────────────────────── */
  if (report.series?.length) {
    const ts = wb.addWorksheet('Monthly trend');
    ts.columns = [
      { key: 'month', width: 12 }, { key: 'actual', width: 16 }, { key: 'leased', width: 16 },
      { key: 'units', width: 10 }, { key: 'leasedUnits', width: 14 }, { key: 'gap', width: 16 },
    ];
    const th = ts.addRow(['Month', 'Asking', 'Leased', 'Units', 'Leased units', 'Gap']);
    th.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    th.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_600 } }; });

    for (const p of report.series) {
      const row = ts.addRow([p.monthISO, p.actual, p.leased, p.units, p.leasedUnits, p.leased - p.actual]);
      for (const col of [2, 3, 6]) row.getCell(col).numFmt = MONEY;
      tone(row.getCell(6), p.leased - p.actual);
    }

    const note = ts.addRow([]);
    ts.addRow(['Leased is what the contracts running each month were worth.']).font = { size: 9, color: { argb: INK_3 } };
    ts.addRow(["Asking uses today's prices, counting only units that existed by then."]).font = { size: 9, color: { argb: INK_3 } };
    note.height = 8;
  }

  return wb.xlsx.writeBuffer();
}
