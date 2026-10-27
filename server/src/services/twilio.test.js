import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164 } from './twilio.js';

test('phone numbers as Twilio wants them, UAE assumed without a country code', () => {
   assert.equal(toE164('0501234567'), '+971501234567');
   assert.equal(toE164('+971 50 123 4567'), '+971501234567');
   assert.equal(toE164('00971501234567'), '+971501234567');
   assert.equal(toE164('+44 7700 900123'), '+447700900123');
   assert.equal(toE164('123'), '');
});

test('a text asked for before Twilio is connected asks for the connection, once, on its own form', async () => {
   await import('./assistant/staffTools.js');
   const { toolByName } = await import('./assistant/tools.js');
   const { ACTION_TOOLS } = await import('./assistant/actions.js');
   const saved = { ...process.env };
   delete process.env.TWILIO_ACCOUNT_SID;
   try {
      const out = await toolByName('propose_sms').run({ to: ['0501234567'], message: 'Hi' }, { user: { id: 'u1' } });
      assert.equal(out.setup, 'twilio');
      assert.ok(ACTION_TOOLS.includes('propose_sms'), 'only offered to people who may act');
   } finally {
      Object.assign(process.env, saved);
   }
});

test('a template is prepared for a Confirm, never sent straight away', async () => {
   await import('./assistant/staffTools.js');
   const { toolByName } = await import('./assistant/tools.js');
   const { PROPOSAL_TOOLS } = await import('./assistant/actions.js');
   assert.ok(toolByName('whatsapp_templates'));
   assert.ok(PROPOSAL_TOOLS.includes('propose_whatsapp_template'));
});
