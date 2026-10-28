import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskIdKeys, restoreMasked } from './piiGuard.js';

const EID = '784-1990-1234567-1';

test('responses carry identity numbers masked; text and other fields are untouched', () => {
   const out = maskIdKeys({ fullName: 'Test', emiratesId: EID, passportNumber: 'P9876543', agreementText: `ID ${EID}`, authorizedPersons: [{ name: 'A', idNumber: '784199012345671' }] });
   assert.equal(out.emiratesId, '****5671');
   assert.equal(out.passportNumber, '****6543');
   assert.equal(out.authorizedPersons[0].idNumber, '****5671');
   assert.equal(out.agreementText, `ID ${EID}`, 'agreement text is saved back by the editor, so it is not altered');
});

test('a masked value sent back by an edit form never overwrites the real one', () => {
   const existing = { emiratesId: EID, authorizedPersons: [{ name: 'A', phone: '1', idNumber: '784199012345671' }, { name: 'B', idNumber: 'X1' }] };
   const body = restoreMasked({ emiratesId: '****5671', nationality: 'AE', authorizedPersons: [{ name: 'B', idNumber: '****X1' }, { name: 'A', phone: '1', idNumber: '****5671' }, { name: 'C', idNumber: 'NEW1' }] }, existing, ['authorizedPersons']);
   assert.ok(!('emiratesId' in body));
   assert.equal(body.nationality, 'AE');
   assert.deepEqual(body.authorizedPersons.map((p) => p.idNumber), ['X1', '784199012345671', 'NEW1']);
});

test('a new number typed in is kept', () => {
   assert.equal(restoreMasked({ emiratesId: '784-2000-7654321-9' }, { emiratesId: EID }).emiratesId, '784-2000-7654321-9');
});
