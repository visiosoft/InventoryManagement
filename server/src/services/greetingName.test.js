import test from 'node:test';
import assert from 'node:assert/strict';
import { usableFirstName, stripUnusableNames } from './leadNames.js';
import { greetingNameFor } from './leadFollowUp.js';

test('real names are used, abbreviations and handles are not', () => {
  for (const [name, want] of [['Khalil Laghari', 'Khalil'], ['Dr Khalil', 'Khalil'], ['Sara', 'Sara'], ['mohammed emad', 'mohammed'], ['محمد علي', 'محمد'],
    ['DDM', ''], ['RS', ''], ['MJ', ''], ['AK Traders', ''], ['800 Movers LLC', ''], ["L'Atelier Five FZ-LLC", ''], ['☠️', ''], ['WhatsApp Contact 4387', ''], ['971547379274', ''], ['', '']]) {
    assert.equal(usableFirstName(name), want, name);
  }
});
test('an abbreviation is taken out of a draft, a real name is left alone', () => {
  assert.equal(stripUnusableNames('Thanks for letting us know, DDM! If you need storage, message us.', { fullName: 'DDM' }), 'Thanks for letting us know! If you need storage, message us.');
  assert.equal(stripUnusableNames('Hi DDM, the unit is free.', { whatsappProfileName: 'DDM' }), 'Hi, the unit is free.');
  assert.equal(stripUnusableNames('Thanks, Sara! See you.', { fullName: 'Sara' }), 'Thanks, Sara! See you.');
});
test('template greeting falls back to "there" for an abbreviation', () => {
  assert.equal(greetingNameFor({ fullName: 'DDM' }), 'there');
  assert.equal(greetingNameFor({ fullName: 'DDM', whatsappProfileName: 'Karthik' }), 'Karthik');
});
