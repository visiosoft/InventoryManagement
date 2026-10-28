import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport } from './makeTools.js';
import { checkMade } from './index.js';

const usage = { tool: 'ai_usage', result: { total: { calls: 1084, inputTokens: 3908875, outputTokens: 349554, costUsd: 22.22 }, byProvider: [{ provider: 'anthropic', calls: 1005, inputTokens: 3733368, outputTokens: 338396 }, { provider: 'openai', calls: 79, inputTokens: 175507, outputTokens: 11158 }] } };
const card = {
   eyebrow: 'AI API USAGE · LAST 7 DAYS', headline: 'Anthropic drives most token use', badge: 'Estimate',
   kpis: [{ label: 'Est. cost', value: 22.22, format: 'money_usd' }, { label: 'AI calls', value: 1084 }, { label: 'Input tokens', value: 3908875 }, { label: 'Output tokens', value: 349554 }],
   breakdown: { title: 'By provider', columns: ['Calls', 'Input', 'Output'], rows: [{ label: 'Anthropic', tag: 'Most tokens', values: [1005, 3733368, 338396] }, { label: 'OpenAI', values: [79, 175507, 11158] }], shareOf: 1 },
   callout: 'Cutting what you send in is the biggest lever.',
   actions: [{ title: 'Shorten the context sent to Aisha', detail: '1005 calls', value: 3733368, of: 3908875, label: 'of input' }],
};

test('a report card keeps only clean, bounded parts', () => {
   const c = cleanReport(card);
   assert.equal(c.kpis.length, 4);
   assert.equal(c.breakdown.shareOf, 1);
   assert.equal(c.breakdown.rows[0].tag, 'Most tokens');
   assert.equal(cleanReport({ headline: 'x' }), null, 'a headline alone is not a report');
});

test('figures that match the tools pass; a made-up figure drops the card', () => {
   const ok = checkMade([usage, { tool: 'make_report', result: { report: cleanReport(card) } }]);
   assert.equal(ok.reports.length, 1);
   const bad = cleanReport({ ...card, kpis: [{ label: 'AI calls', value: 1200 }] });
   assert.equal(checkMade([usage, { tool: 'make_report', result: { report: bad } }]).reports.length, 0);
});

test('a sentence with an unchecked figure is left off, the card stays', () => {
   const c = cleanReport({ ...card, callout: 'Input is about 97x output.' });
   const out = checkMade([usage, { tool: 'make_report', result: { report: c } }]);
   assert.equal(out.reports[0].callout, '');
   assert.equal(out.reports[0].headline, 'Anthropic drives most token use');
});

test('report people: linked only when the phone came from a tool', () => {
   const leads = { tool: 'leads_list', result: { leads: [{ name: 'Marlene', phone: '+971 50 123 4567' }] } };
   const c = cleanReport({ headline: 'Follow-ups due', actions: [{ title: 'Reply to waiting chats', people: [
      { name: 'Marlene', phone: '971501234567' }, { name: 'Made up', phone: '971559999999' }, { name: 'No phone', phone: '' },
   ] }] });
   assert.equal(c.actions[0].people.length, 2, 'a person with no phone is dropped');
   const out = checkMade([leads, { tool: 'make_report', result: { report: c } }]);
   assert.deepEqual(out.reports[0].actions[0].people, [{ name: 'Marlene', phone: '971501234567' }]);
});
