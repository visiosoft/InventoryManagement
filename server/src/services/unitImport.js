/**
 * Turn a pasted unit list into unit records.
 *
 * The floor plans arrive as a spreadsheet: a number, a measured area, the
 * dimensions in metres and again in feet, a size band and a price. Adding a
 * hundred and forty-five of those by hand is not work anyone should do, and a
 * one-off script would have to be written again for the next floor.
 *
 * Nothing here writes. It parses and reports, so the caller can show exactly
 * what would be created before anything is.
 *
 * Expected columns, tab or multi-space separated:
 *   number | area | lengthM | widthM | lengthFt | widthFt | size band | price
 *   1  77.7  2.724  2.560  8.937  8.399  75 sq ft  AED 1,300
 *
 * A row with only a number is a real unit that has not been measured or priced
 * yet — kept, not dropped, because the space exists whether or not the
 * spreadsheet has caught up.
 */

/** "AED 1,300" -> 1300; "" -> null. Never NaN. */
export function parseMoney(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "75 sq ft" -> 75; "50 sqft" -> 50. */
export function parseSize(raw) {
  const m = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function num(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Tabs where a spreadsheet gives them, runs of spaces where it does not. */
function splitCells(line) {
  return (line.includes('\t') ? line.split('\t') : line.split(/ {2,}|\s{2,}/))
    .map((c) => c.trim());
}

/**
 * @param {string} text   the pasted block
 * @param {object} opts   `floor` prefixes every unit number, e.g. 'F3' -> 'F3-1'
 * @returns {{ units: object[], problems: {line:number,text:string,reason:string}[] }}
 */
export function parseUnitRows(text, { floor = '' } = {}) {
  const units = [];
  const problems = [];
  const seen = new Set();

  const lines = String(text ?? '').split(/\r?\n/);

  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;

    const cells = splitCells(raw);
    const number = cells[0]?.trim();
    if (!number) return;

    // A header row, however it is worded, is not a unit.
    if (/^(no|num|number|unit|#)$/i.test(number) || !/^[\d]/.test(number)) {
      problems.push({ line: i + 1, text: raw.slice(0, 60), reason: 'Not a unit row — skipped' });
      return;
    }

    const unitNumber = floor ? `${floor}-${number}` : number;
    if (seen.has(unitNumber)) {
      // Two rows for one unit is a mistake worth naming, not a silent overwrite.
      problems.push({ line: i + 1, text: raw.slice(0, 60), reason: `${unitNumber} appears more than once — later row ignored` });
      return;
    }
    seen.add(unitNumber);

    const area = num(cells[1]);
    const sizeBand = parseSize(cells[6]);
    const price = parseMoney(cells[7]);

    units.push({
      unitNumber,
      floor,
      // The band, not the measured area: it is what the price is set against
      // and what every size filter in the app groups by.
      sizeSqf: sizeBand,
      price,
      lengthFt: num(cells[4]),
      widthFt: num(cells[5]),
      status: 'available',
      // The exact area would otherwise be lost, and it is the only record of
      // what was actually measured.
      notes: area != null ? `Measured area ${area} sq ft` : '',
      // Not stored; shown in the preview so a blank row is visibly blank.
      incomplete: sizeBand == null || price == null,
    });
  });

  return { units, problems };
}

/** What the preview says before anything is written. */
export function summariseImport(units = []) {
  const priced = units.filter((u) => u.price != null);
  const bySize = new Map();
  for (const u of units) {
    const key = u.sizeSqf == null ? 'unsized' : `${u.sizeSqf} sq ft`;
    bySize.set(key, (bySize.get(key) || 0) + 1);
  }
  return {
    total: units.length,
    priced: priced.length,
    incomplete: units.filter((u) => u.incomplete).length,
    monthlyTotal: Math.round(priced.reduce((s, u) => s + u.price, 0) * 100) / 100,
    bySize: [...bySize.entries()].map(([size, count]) => ({ size, count })),
  };
}
