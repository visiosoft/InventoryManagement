import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TOOLS, PROPOSAL_TOOLS, holdProposal, registerRunner, runAction, takeProposal } from './actions.js';
import { toolByName } from './tools.js';
import './staffTools.js';

/* The staff-app tools keep the assistant's one rule: anything that reaches a
   customer or moves money is a card first, and Confirm is what runs it. */

test('sending, invoicing and payments are proposals; lead housekeeping is an immediate write', () => {
   for (const name of ['propose_whatsapp_message', 'propose_invoice', 'propose_send_invoice', 'propose_record_payment', 'propose_extend_contract']) {
      assert.ok(PROPOSAL_TOOLS.includes(name), `${name} must wait for Confirm`);
   }
   for (const name of ['set_lead_status', 'schedule_site_visit', 'add_lead_note']) {
      assert.ok(ACTION_TOOLS.includes(name) && !PROPOSAL_TOOLS.includes(name), `${name} is a write that runs straight away`);
   }
   // Hidden from anyone who may not act, same as the original actions.
   assert.ok(ACTION_TOOLS.includes('propose_whatsapp_message'));
});

test('the connector does not list the app-only tools twice', () => {
   assert.equal(toolByName('lead_file')?.appOnly, true);
   assert.equal(toolByName('units_available')?.appOnly, undefined);
});

test('a held proposal is only taken by the person it was prepared for, once, and Confirm runs its runner', async () => {
   const ran = [];
   registerRunner('test_kind', async (spec, { authHeader }) => { ran.push({ spec, authHeader }); return { ok: true, message: 'done' }; });
   const { proposalId } = holdProposal({ user: { id: 'u1' }, kind: 'test_kind', summary: ['x'], spec: { a: 1 } });

   assert.equal(takeProposal(proposalId, 'someone-else'), null);
   const p = takeProposal(proposalId, 'u1');
   assert.ok(p);
   assert.equal(takeProposal(proposalId, 'u1'), null, 'it cannot run twice');

   const out = await runAction(p, { authHeader: 'Bearer rep-token' });
   assert.deepEqual(out, { ok: true, message: 'done' });
   assert.deepEqual(ran, [{ spec: { a: 1 }, authHeader: 'Bearer rep-token' }], 'runs with the confirming person’s own token');
});

test('a runner that fails says so instead of throwing', async () => {
   registerRunner('test_fail', async () => { throw new Error('No invoice INV-1'); });
   const { proposalId } = holdProposal({ user: { id: 'u1' }, kind: 'test_fail', summary: [], spec: {} });
   const out = await runAction(takeProposal(proposalId, 'u1'), { authHeader: 'x' });
   assert.equal(out.ok, false);
   assert.match(out.message, /No invoice INV-1/);
});
