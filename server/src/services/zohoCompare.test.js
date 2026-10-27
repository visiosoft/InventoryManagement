import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWithZoho } from './zohoCompare.js';

const customers = [
   { _id: 'a', fullName: 'Sara Ahmed', email: 'Sara@Example.com', phone: '' },
   { _id: 'b', fullName: 'Omar Khalid', email: '', phone: '+971 50 123 4567' },
   { _id: 'c', fullName: 'Lina Haddad', email: 'lina@example.com', phone: '0551112222' },
   { _id: 'd', fullName: 'Ravi Kumar', email: 'ravi@new.com', phone: '0563334444' },
   { _id: 'e', fullName: 'Nobody Here', email: 'none@example.com', phone: '' },
   { _id: 'f', fullName: 'No Details', email: '', phone: '' },
];
const contacts = [
   { id: 'z1', name: 'Sara A.', email: 'sara@example.com', phone: '' },
   { id: 'z2', name: 'Omar', email: '', phone: '', mobile: '00971501234567' },
   { id: 'z3', name: 'Lina H', email: 'lina@example.com', phone: '' },
   { id: 'z4', name: 'Someone else', email: '', phone: '0551112222' },
   { id: 'z5', name: 'Ravi Kumar', email: 'ravi@old.com', phone: '0500000000' },
   { id: 'z6', name: 'Zoho Only', email: 'zo@example.com', outstanding: 1200 },
];

test('each CRM customer is matched by email or phone, never by name — and the gaps are named', () => {
   const { counts, rows } = compareWithZoho(customers, contacts);
   const of = (id) => rows.find((r) => r.crmId === id);
   assert.equal(of('a').status, 'matched');
   assert.equal(of('a').matchedBy, 'email', 'email compared without case');
   assert.equal(of('b').status, 'matched');
   assert.equal(of('b').matchedBy, 'phone', 'phone compared on the last 9 digits, Zoho mobile included');
   assert.equal(of('c').status, 'conflict');
   assert.match(of('c').note, /Someone else/);
   assert.equal(of('d').status, 'name_only', 'same name only: shown, but not treated as a match');
   assert.equal(of('d').zohoEmail, 'ravi@old.com');
   assert.equal(of('e').status, 'crm_only');
   assert.equal(of('f').status, 'no_details');
   const zo = rows.find((r) => r.status === 'zoho_only');
   assert.equal(zo.zohoName, 'Zoho Only');
   assert.match(zo.note, /Owes money/);
   assert.deepEqual(counts, { matched: 2, conflict: 1, name_only: 1, crm_only: 1, no_details: 1, zoho_only: 1 });
});
