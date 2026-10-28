import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AGENT_DRAFT_DEBOUNCE_MS = '30';
const { scheduleDraft } = await import('./service.js');

test('a burst of messages makes one draft, from the last one', async () => {
   const runs = [];
   const run = async (phone, { text }) => { runs.push([phone, text]); };
   scheduleDraft('971500000001', { text: 'hi', now: new Date() }, run);
   scheduleDraft('971500000001', { text: 'how much is 50 sq ft', now: new Date() }, run);
   scheduleDraft('971500000001', { text: 'for 2 months', now: new Date() }, run);
   scheduleDraft('971500000002', { text: 'hello', now: new Date() }, run);
   await new Promise((r) => setTimeout(r, 80));
   assert.deepEqual(runs.sort(), [['971500000001', 'for 2 months'], ['971500000002', 'hello']]);
});
