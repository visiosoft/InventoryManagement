import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityBlock } from './runtime.js';

test('replies speak as the assigned rep, honestly, and quote the published offer', () => {
   const b = identityBlock('Randa Mustafa');
   assert.match(b, /Write as Randa from PurpleBox Storage/);
   assert.match(b, /wherever the instructions above give you another name/);
   assert.match(b, /answer honestly: you are PurpleBox's assistant writing on Randa's behalf/);
   assert.match(b, /first-month offers in the facts are published prices/);
   const none = identityBlock('');
   assert.doesNotMatch(none, /WHO YOU WRITE AS/, 'no owner yet: no name is invented');
   assert.match(none, /PRICES/);
});
