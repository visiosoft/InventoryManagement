import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdFields, diffAgainstCustomer } from './documentExtract.js';

// Fixed so "plausible expiry" does not drift with the calendar.
const NOW = new Date('2026-08-25T00:00:00Z');
const at = (raw) => parseIdFields(raw, { now: NOW });

test('a clean reading passes through', () => {
  const r = at({
    fullName: 'Zulfiqar Khan',
    emiratesId: '784-1990-1234567-1',
    eidExpiry: '2028-04-30',
    nationality: 'Pakistan',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, {
    fullName: 'Zulfiqar Khan',
    emiratesId: '784-1990-1234567-1',
    eidExpiry: '2028-04-30',
    nationality: 'Pakistan',
  });
  assert.deepEqual(r.rejected, []);
});

test('an Emirates ID is stored one way however it was printed', () => {
  for (const printed of ['784 1990 1234567 1', '784199012345671', '784-1990-1234567-1']) {
    assert.equal(at({ emiratesId: printed }).fields.emiratesId, '784-1990-1234567-1');
  }
});

test('a malformed Emirates ID is refused, not repaired', () => {
  for (const bad of ['123-1990-1234567-1', '784-1990-1234567', '784', 'not a number']) {
    const r = at({ emiratesId: bad });
    assert.equal(r.fields.emiratesId, undefined, `accepted ${bad}`);
    assert.equal(r.rejected[0].field, 'emiratesId');
  }
});

// The one JavaScript quietly gets wrong: new Date('2026-02-31') rolls into
// March rather than failing, so a misread day would be stored as a real date.
test('a date that does not exist is refused', () => {
  const r = at({ eidExpiry: '2026-02-31' });
  assert.equal(r.fields.eidExpiry, undefined);
  assert.equal(r.rejected[0].reason, 'not a plausible date');
});

test('an implausible expiry is refused', () => {
  for (const bad of ['1974-01-01', '2099-01-01', '28-04-2026', '2026-4-5']) {
    const r = at({ eidExpiry: bad });
    assert.equal(r.fields.eidExpiry, undefined, `accepted ${bad}`);
  }
});

test('null from the model is a failure to read, not an empty document', () => {
  for (const nothing of [null, undefined, 'text', [], 42]) {
    const r = at(nothing);
    assert.equal(r.ok, false);
    assert.deepEqual(r.fields, {});
    assert.deepEqual(r.rejected, []);
  }
});

test('an absent field is normal and is not reported as rejected', () => {
  // A passport carries no Emirates ID. That is not an error.
  const r = at({ fullName: 'Ela Ojani', passportNumber: 'X1234567', emiratesId: '' });
  assert.deepEqual(Object.keys(r.fields).sort(), ['fullName', 'passportNumber']);
  assert.deepEqual(r.rejected, []);
});

test('one bad field does not discard the good ones', () => {
  const r = at({ fullName: 'Yuriy Beck', emiratesId: 'garbage', eidExpiry: '2029-01-15' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { fullName: 'Yuriy Beck', eidExpiry: '2029-01-15' });
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].field, 'emiratesId');
});

test('a name has to contain letters', () => {
  assert.equal(at({ fullName: '---- ///' }).fields.fullName, undefined);
  assert.equal(at({ fullName: 'A' }).fields.fullName, undefined);
  assert.equal(at({ fullName: '  Marta   Justyna  Grzyska ' }).fields.fullName, 'Marta Justyna Grzyska');
});

test('a passport number is normalised, and rubbish refused', () => {
  assert.equal(at({ passportNumber: 'x123 4567' }).fields.passportNumber, 'X1234567');
  assert.equal(at({ passportNumber: 'AB' }).fields.passportNumber, undefined);
});

test('the diff shows what would be replaced', () => {
  const rows = diffAgainstCustomer(
    { fullName: 'Ela Ojani', eidExpiry: '2028-04-30', nationality: 'Albania' },
    { fullName: 'Ela Ojani', eidExpiry: new Date('2027-01-01T00:00:00Z'), nationality: '' },
  );
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));

  assert.equal(by.fullName.changed, false);
  assert.equal(by.eidExpiry.changed, true);
  assert.equal(by.eidExpiry.current, '2027-01-01');
  assert.equal(by.nationality.isNew, true);
});
