import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnitRows, summariseImport, parseMoney, parseSize } from './unitImport.js';

const tabbed = (...cells) => cells.join('\t');

test('a price is read through its currency and separators', () => {
  assert.equal(parseMoney('AED 1,300'), 1300);
  assert.equal(parseMoney('950'), 950);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('—'), null);
});

test('a size band is read through its wording', () => {
  assert.equal(parseSize('75 sq ft'), 75);
  assert.equal(parseSize('50 sqft'), 50);
  assert.equal(parseSize(''), null);
});

test('a full row becomes a unit on the given floor', () => {
  const { units } = parseUnitRows(
    tabbed('1', '77.7', '2.724', '2.560', '8.937', '8.399', '75 sq ft', 'AED 1,300'),
    { floor: 'F3' },
  );
  assert.equal(units.length, 1);
  assert.deepEqual(
    { ...units[0], incomplete: undefined },
    {
      unitNumber: 'F3-1', floor: 'F3', sizeSqf: 75, price: 1300,
      lengthFt: 8.937, widthFt: 8.399, status: 'available',
      notes: 'Measured area 77.7 sq ft', incomplete: undefined,
    },
  );
});

// The band is what the price is set against and what the size filters group by;
// the measured figure would not match 25/35/50/75 anywhere else in the app.
test('the size is the band, and the measured area is kept in notes', () => {
  const { units } = parseUnitRows(
    tabbed('1', '77.7', '2.724', '2.560', '8.937', '8.399', '75 sq ft', 'AED 1,300'),
    { floor: 'F3' },
  );
  assert.equal(units[0].sizeSqf, 75);
  assert.match(units[0].notes, /77\.7/);
});

test('a split unit keeps its hyphen', () => {
  const { units } = parseUnitRows(
    tabbed('59-1', '11.8', '1.641', '0.668', '5.384', '2.192', '10 sq ft', 'AED 330'),
    { floor: 'F3' },
  );
  assert.equal(units[0].unitNumber, 'F3-59-1');
  assert.equal(units[0].price, 330);
});

// The space exists whether or not the spreadsheet has caught up with it.
test('a row with only a number is kept, unpriced and flagged', () => {
  const { units } = parseUnitRows('97-1\t\t\t\t\t\t\t', { floor: 'F3' });
  assert.equal(units.length, 1);
  assert.equal(units[0].unitNumber, 'F3-97-1');
  assert.equal(units[0].price, null);
  assert.equal(units[0].sizeSqf, null);
  assert.equal(units[0].incomplete, true);
  assert.equal(units[0].notes, '');
});

test('blank lines are ignored and a header is reported rather than imported', () => {
  const { units, problems } = parseUnitRows(
    ['No\tArea\tL\tW\tLft\tWft\tSize\tPrice', '', tabbed('1', '50.2', '2.5', '1.8', '8.3', '5.9', '50 sq ft', 'AED 950')].join('\n'),
    { floor: 'F3' },
  );
  assert.equal(units.length, 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /Not a unit row/);
});

test('a repeated number is reported, never silently overwritten', () => {
  const row = tabbed('5', '50.2', '2.5', '1.8', '8.3', '5.9', '50 sq ft', 'AED 950');
  const { units, problems } = parseUnitRows([row, row].join('\n'), { floor: 'F3' });
  assert.equal(units.length, 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /more than once/);
});

test('space-separated text works when tabs were lost in the paste', () => {
  const { units } = parseUnitRows('1   77.7   2.724   2.560   8.937   8.399   75 sq ft   AED 1,300', { floor: 'F3' });
  assert.equal(units[0].unitNumber, 'F3-1');
  assert.equal(units[0].price, 1300);
  assert.equal(units[0].sizeSqf, 75);
});

test('with no floor given the number stands alone', () => {
  const { units } = parseUnitRows(tabbed('7', '50', '2', '2', '6', '6', '50 sq ft', 'AED 950'));
  assert.equal(units[0].unitNumber, '7');
});

test('the summary counts what would be created, and what is not priced', () => {
  const { units } = parseUnitRows([
    tabbed('1', '77.7', '2.7', '2.5', '8.9', '8.3', '75 sq ft', 'AED 1,300'),
    tabbed('2', '50.2', '2.5', '1.8', '8.3', '5.9', '50 sq ft', 'AED 950'),
    '97-1',
  ].join('\n'), { floor: 'F3' });

  const s = summariseImport(units);
  assert.equal(s.total, 3);
  assert.equal(s.priced, 2);
  assert.equal(s.incomplete, 1);
  assert.equal(s.monthlyTotal, 2250);
  assert.deepEqual(
    s.bySize.sort((a, b) => a.size.localeCompare(b.size)),
    [{ size: '50 sq ft', count: 1 }, { size: '75 sq ft', count: 1 }, { size: 'unsized', count: 1 }],
  );
});

test('nothing pasted produces nothing, not an error', () => {
  assert.deepEqual(parseUnitRows(''), { units: [], problems: [] });
  assert.deepEqual(parseUnitRows(null), { units: [], problems: [] });
  assert.equal(summariseImport([]).total, 0);
});
