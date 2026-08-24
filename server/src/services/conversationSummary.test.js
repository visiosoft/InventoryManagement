import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, parseSummary, MAX_TURNS } from './conversationSummary.js';

const msg = (over = {}) => ({
  direction: 'inbound',
  type: 'text',
  text: 'hello',
  occurredAt: new Date('2026-08-20T10:00:00Z'),
  ...over,
});

test('the transcript labels who said what, oldest first', () => {
  const out = buildTranscript([
    msg({ text: 'Do you have a small unit?' }),
    msg({ direction: 'outbound', text: 'We do, 25 sqft.' }),
    msg({ direction: 'outbound', text: 'Shall I hold it?', sentByAi: true }),
  ]);
  assert.equal(out, [
    '[2026-08-20] Customer: Do you have a small unit?',
    '[2026-08-20] Us: We do, 25 sqft.',
    '[2026-08-20] Assistant: Shall I hold it?',
  ].join('\n'));
});

// Putting a withdrawn message back in front of a colleague is the opposite of
// what deleting it meant.
test('deleted messages are left out', () => {
  const out = buildTranscript([
    msg({ text: 'ignore that' }),
    msg({ text: 'sent by mistake', deletedAt: new Date() }),
  ]);
  assert.equal(out.includes('sent by mistake'), false);
  assert.equal(out.includes('ignore that'), true);
});

test('reactions, stickers and empty messages carry nothing to summarise', () => {
  const out = buildTranscript([
    msg({ type: 'reaction', text: '👍' }),
    msg({ type: 'sticker', text: '' }),
    msg({ text: '   ' }),
    msg({ text: 'real question' }),
  ]);
  assert.equal(out, '[2026-08-20] Customer: real question');
});

test('a long thread is capped at the most recent turns', () => {
  const many = Array.from({ length: MAX_TURNS + 40 }, (_, i) => msg({ text: `line ${i}` }));
  const lines = buildTranscript(many).split('\n');
  assert.equal(lines.length, MAX_TURNS);
  // The recent end is what matters, so it is the start that gets dropped.
  assert.equal(lines.at(-1).endsWith(`line ${MAX_TURNS + 39}`), true);
  assert.equal(buildTranscript(many).includes('line 0:'), false);
});

test('an empty thread produces nothing rather than an empty shell', () => {
  assert.equal(buildTranscript([]), '');
  assert.equal(buildTranscript([msg({ text: '' })]), '');
});

test('a good summary passes through', () => {
  const s = parseSummary({
    headline: 'Wants a small unit from October',
    wants: 'A 25 sqft unit near the lift',
    budget: 'AED 500 a month',
    timing: 'From 1 October',
    nextAction: 'Send a quote for a 25 sqft on F2',
    temperature: 'hot',
    reason: 'Asked for a quote and gave a date',
    openQuestions: ['Is there parking?'],
  });
  assert.equal(s.temperature, 'hot');
  assert.equal(s.budget, 'AED 500 a month');
  assert.deepEqual(s.openQuestions, ['Is there parking?']);
});

test('a summary with no headline or no next action is not worth showing', () => {
  assert.equal(parseSummary({ headline: '', nextAction: 'Call them' }), null);
  assert.equal(parseSummary({ headline: 'Wants a unit', nextAction: '  ' }), null);
});

test('unusable model output is a failure, not an empty summary', () => {
  for (const bad of [null, undefined, 'text', [], 42]) {
    assert.equal(parseSummary(bad), null);
  }
});

// The two the model is most tempted to invent. An empty string shown as a
// known blank reads as "they have no budget", which is a different claim.
test('budget and timing are null when not said, never blank', () => {
  const s = parseSummary({ headline: 'Browsing', nextAction: 'Follow up', budget: '', timing: '   ' });
  assert.equal(s.budget, null);
  assert.equal(s.timing, null);
});

test('an invented temperature falls back to warm rather than being shown', () => {
  const s = parseSummary({ headline: 'h', nextAction: 'n', temperature: 'boiling' });
  assert.equal(s.temperature, 'warm');
});

test('open questions are always an array, and capped', () => {
  assert.deepEqual(parseSummary({ headline: 'h', nextAction: 'n' }).openQuestions, []);
  assert.deepEqual(parseSummary({ headline: 'h', nextAction: 'n', openQuestions: 'not a list' }).openQuestions, []);
  const many = parseSummary({ headline: 'h', nextAction: 'n', openQuestions: Array(9).fill('q?') });
  assert.equal(many.openQuestions.length, 5);
});
