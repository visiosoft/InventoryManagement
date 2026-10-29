import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFromMatches, knowledgeFor } from './trainerKnowledge.js';
import { refFor } from '../routes/trainingConnector.js';

test('the approved-answers block: answers, the authority note, and hand-overs', () => {
   const b = blockFromMatches([
      { question: 'How much is 50 sqft?', answer: 'A 50 sqft unit is AED 975 per 4 weeks.', followUp: 'How long do you need it?' },
      { question: 'My box was damaged', answer: 'x', escalate: true, escalationNote: 'damage claims go to the manager' },
   ]);
   assert.match(b, /Approved answer: A 50 sqft unit is AED 975 per 4 weeks\.\n  Then: How long do you need it\?/);
   assert.match(b, /live data wins/);
   assert.match(b, /"My box was damaged" must go to a person: set needsHuman true \(damage claims go to the manager\)/);
   assert.equal(blockFromMatches([]), '');
});

test('Aisha is never held up: no key, or the Training Center failing, means no block', async () => {
   delete process.env.TRAINER_API_KEY;
   assert.equal((await knowledgeFor('price?')).text, '');
   process.env.TRAINER_API_KEY = 'tq_0123456789ab_abcdefghijklmnopqrstuvwxyz';
   const down = await knowledgeFor('is it open on friday?', { post: async () => { throw new Error('ECONNREFUSED'); } });
   assert.equal(down.text, '');
   const up = await knowledgeFor('how much for 50 sqft', { post: async (url, body, opts) => {
      assert.match(url, /\/match$/); assert.equal(body.message, 'how much for 50 sqft'); assert.match(opts.headers.Authorization, /^Bearer tq_/);
      return { data: { version: 4, matches: [{ id: 'k1', version: 2, score: 0.9, question: 'Price of 50 sqft', answer: 'AED 975 per 4 weeks' }] } };
   } });
   assert.match(up.text, /AED 975 per 4 weeks/);
   assert.equal(up.version, 4);
   delete process.env.TRAINER_API_KEY;
});

test('phone numbers leave the CRM only as an opaque, stable reference', () => {
   process.env.TRAINING_CONNECTOR_TOKEN = 'x'.repeat(40);
   const r = refFor('971501234567');
   assert.equal(r, refFor('971501234567'));
   assert.notEqual(r, refFor('971501234568'));
   assert.ok(!r.includes('971501234567') && /^wa_[0-9a-f]{24}$/.test(r));
});

test('the shared sales playbook leads the block, with or without matching answers', () => {
   const only = blockFromMatches([], 'Never offer an unauthorised discount.');
   assert.match(only, /^SALES PLAYBOOK/);
   assert.match(only, /unauthorised discount/);
   const both = blockFromMatches([{ question: 'Price?', answer: 'AED 1' }], 'Recommend, do not list.');
   assert.ok(both.indexOf('SALES PLAYBOOK') < both.indexOf('APPROVED ANSWERS'));
   assert.equal(blockFromMatches([], ''), '', 'nothing shared, nothing added');
});
