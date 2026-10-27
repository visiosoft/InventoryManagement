import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConnections } from './connections.js';

test('each connection says whether bots can read it, and Gmail that sends only says so', () => {
   const rows = describeConnections({ zohoBooks: true, gmail: { connected: true, canRead: false, account: 'contact@purplebox.ae' }, whatsapp: true, claude: true });
   const by = Object.fromEntries(rows.map((r) => [r.key, r]));
   assert.equal(by.zohoBooks.connected, true);
   assert.equal(by.gmail.connected, false, 'sending only is not readable');
   assert.equal(by.gmail.partly, true);
   assert.match(by.gmail.note, /sending only/);
   assert.equal(by.gmail.connect, 'oauth:gmail');
   assert.equal(by.stripe.connected, false);
   assert.equal(by.web.connected, true);
   assert.equal(describeConnections({ gmail: { connected: true, canRead: true } }).find((r) => r.key === 'gmail').connected, true);
});
