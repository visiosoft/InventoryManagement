import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormMessage, normaliseIncoming } from './metaLead.js';

const MSG = `Hello! I filled out your form and would like to know more about your business.
Full name: Dr Khalil
Phone number: 052 700 9622
Email: Khalil.laghari@icloud.com
What are you looking to store?: Household items/Furniture
Roughly how much space do you need?: Not sure
When do you need it: This Month`;

test('reads the answers out of a WhatsApp lead-form message', () => {
  const f = parseFormMessage(MSG);
  assert.equal(f.fullName, 'Dr Khalil');
  assert.equal(f.phone, '052 700 9622');
  assert.equal(f.email, 'Khalil.laghari@icloud.com');
  assert.deepEqual(f.extras.map((e) => e.answer), ['Household items/Furniture', 'Not sure', 'This Month']);
});
test('an ordinary chat message is not a form', () => {
  assert.equal(parseFormMessage('Hi, how much is a 50 sqft unit? Phone: later'), null);
});
test('accepts flat fields and Meta field_data', () => {
  const a = normaliseIncoming({ full_name: 'A B', phone_number: '0501234567', email: 'a@b.c', 'what are you looking to store?': 'Boxes', campaign_name: 'Oct' });
  assert.equal(a.fullName, 'A B'); assert.equal(a.extras[0].answer, 'Boxes'); assert.equal(a.meta.campaign, 'Oct');
  const b = normaliseIncoming({ field_data: [{ name: 'full_name', values: ['C D'] }, { name: 'phone_number', values: ['+971501112222'] }, { name: 'when_do_you_need_it', values: ['This Month'] }] });
  assert.equal(b.fullName, 'C D'); assert.equal(b.phone, '+971501112222'); assert.equal(b.extras[0].answer, 'This Month');
});
