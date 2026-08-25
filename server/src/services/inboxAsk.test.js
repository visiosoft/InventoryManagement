import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuestion, parseAsk, INTENTS, DEFAULT_QUIET_DAYS, replyGaps, summariseGaps, humanDuration } from './inboxAsk.js';

/* readQuestion is the half that keeps this cheap: every question it recognises
   is answered from the database, with no API call at all. */

test('the everyday questions are recognised without a model', () => {
  for (const q of [
    'what did we miss',
    'what have we missed?',
    'who is waiting for a reply',
    'unanswered chats',
    'nobody replied to these',
    'which ones are pending',
  ]) {
    assert.equal(readQuestion(q)?.intent, 'unanswered', `missed: ${q}`);
  }
});

test('gone-quiet questions carry their own window', () => {
  assert.deepEqual(readQuestion('who went quiet'), { intent: 'quiet', params: { days: DEFAULT_QUIET_DAYS } });
  assert.equal(readQuestion('no reply in 10 days').params.days, 10);
  assert.equal(readQuestion('gone cold for 2 weeks').params.days, 14);
  assert.equal(readQuestion('quiet for 1 month').params.days, 30);
});

test('an absurd window is clamped rather than queried', () => {
  assert.equal(readQuestion('quiet for 999 days').params.days, 120);
});

test('hot-lead questions are recognised', () => {
  for (const q of ['hot leads', 'who is ready to book', 'most interested customers', 'hottest right now']) {
    assert.equal(readQuestion(q)?.intent, 'hot', `missed: ${q}`);
  }
});

test('a topic question keeps the topic', () => {
  assert.deepEqual(readQuestion('who mentioned parking'), { intent: 'mentions', params: { text: 'parking' } });
  assert.equal(readQuestion('anyone asking about insurance?').params.text, 'insurance');
  assert.equal(readQuestion('who talked about the lift').params.text, 'the lift');
});

test('an unrecognised question is null, not a guess', () => {
  // Null is the signal to ask a model — guessing an intent here would run the
  // wrong query and present it as an answer.
  for (const q of ['', '   ', 'why is the sky blue', 'do the thing']) {
    assert.equal(readQuestion(q), null, `guessed at: ${q}`);
  }
});

/* parseAsk is the guard on the model's routing. */

test('a valid routing passes through', () => {
  const r = parseAsk({ intent: 'quiet', days: 7, text: null, unreadable: null });
  assert.equal(r.intent, 'quiet');
  assert.equal(r.params.days, 7);
});

test('an intent outside the list never becomes a query', () => {
  for (const bad of ['delete_all', 'send', '', null, 'HOT']) {
    assert.equal(parseAsk({ intent: bad }), null, `accepted: ${bad}`);
  }
});

test('unusable model output is refused', () => {
  for (const bad of [null, undefined, 'text', [], 42]) {
    assert.equal(parseAsk(bad), null);
  }
});

test('mentions and about are meaningless without something to look for', () => {
  assert.equal(parseAsk({ intent: 'mentions', text: '' }), null);
  assert.equal(parseAsk({ intent: 'about', text: '   ' }), null);
  assert.equal(parseAsk({ intent: 'mentions', text: 'parking' }).params.text, 'parking');
});

test('a nonsense day count falls back rather than querying on it', () => {
  for (const bad of [0, -5, 'soon', null, NaN]) {
    assert.equal(parseAsk({ intent: 'quiet', days: bad }).params.days, DEFAULT_QUIET_DAYS);
  }
  assert.equal(parseAsk({ intent: 'quiet', days: 5000 }).params.days, 120);
});

test('every intent the model is offered is one runAsk handles', () => {
  // The prompt lists these to the model; a name here that runAsk does not
  // implement would return an empty answer that looks like "nothing found".
  assert.deepEqual(INTENTS, ['unanswered', 'quiet', 'hot', 'mentions', 'about', 'stats']);
});

/* "How fast do we reply" is arithmetic, not language. These are the rules that
   decide the number, so they are checked rather than trusted. */

const at = (iso, over = {}) => ({ direction: 'inbound', occurredAt: new Date(iso), ...over });
const out = (iso, over = {}) => at(iso, { direction: 'outbound', ...over });

test('a reply time is measured from the first message of a run', () => {
  // Four messages then one answer is one wait, not four. Counting each would
  // quadruple the sample and drag the average toward zero.
  const gaps = replyGaps([
    at('2026-08-20T10:00:00Z'),
    at('2026-08-20T10:05:00Z'),
    at('2026-08-20T10:20:00Z'),
    out('2026-08-20T11:00:00Z'),
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].ms, 60 * 60 * 1000);
});

test('each round trip is counted once', () => {
  const gaps = replyGaps([
    at('2026-08-20T10:00:00Z'), out('2026-08-20T10:30:00Z'),
    at('2026-08-20T12:00:00Z'), out('2026-08-20T12:15:00Z'),
  ]);
  assert.deepEqual(gaps.map((g) => g.ms), [30 * 60 * 1000, 15 * 60 * 1000]);
});

test('an assistant reply is marked, not silently averaged in with ours', () => {
  const gaps = replyGaps([
    at('2026-08-20T10:00:00Z'), out('2026-08-20T10:00:04Z', { sentByAi: true }),
    at('2026-08-20T11:00:00Z'), out('2026-08-20T13:00:00Z'),
  ]);
  assert.deepEqual(gaps.map((g) => g.byAi), [true, false]);
});

test('a thread still waiting contributes no reply time', () => {
  assert.deepEqual(replyGaps([at('2026-08-20T10:00:00Z'), at('2026-08-20T11:00:00Z')]), []);
});

test('us writing first is not a reply to anything', () => {
  assert.deepEqual(replyGaps([out('2026-08-20T09:00:00Z'), out('2026-08-20T09:05:00Z')]), []);
});

test('deleted messages do not start or stop the clock', () => {
  const gaps = replyGaps([
    at('2026-08-20T10:00:00Z', { deletedAt: new Date() }),
    at('2026-08-20T10:30:00Z'),
    out('2026-08-20T11:00:00Z'),
  ]);
  assert.equal(gaps[0].ms, 30 * 60 * 1000);
});

// Back-filled history and clock skew produce these. A negative gap is not a
// fast reply and must not be averaged in as zero.
test('a negative gap is discarded rather than counted as instant', () => {
  assert.deepEqual(replyGaps([at('2026-08-20T12:00:00Z'), out('2026-08-20T11:00:00Z')]), []);
});

test('the median is reported alongside the mean, because one overnight gap moves a mean', () => {
  const gaps = [1, 2, 3, 4, 600].map((m) => ({ ms: m * 60000, byAi: false }));
  const s = summariseGaps(gaps);
  assert.equal(s.count, 5);
  assert.equal(s.medianMs, 3 * 60000);          // unmoved by the outlier
  assert.equal(s.meanMs, 122 * 60000);          // dragged by it
  assert.equal(s.slowestMs, 600 * 60000);
});

test('an even-sized sample averages the middle two', () => {
  assert.equal(summariseGaps([2, 4, 6, 8].map((m) => ({ ms: m * 60000 }))).medianMs, 5 * 60000);
});

test('no data gives nothing rather than a zero that reads as instant', () => {
  assert.equal(summariseGaps([]), null);
});

test('durations read as a person would say them', () => {
  assert.equal(humanDuration(4000), '4s');
  assert.equal(humanDuration(90 * 1000), '2m');
  assert.equal(humanDuration(72 * 60000), '1h 12m');
  assert.equal(humanDuration(3 * 3600 * 1000), '3h');
  assert.equal(humanDuration(50 * 3600 * 1000), '2d 2h');
});

test('asking how fast we reply never reaches a model', () => {
  for (const q of [
    'what is our average time of reply to customer',
    'how fast do we reply',
    'average response time',
    'median reply time last 30 days',
    'how long do we take to get back to people',
  ]) {
    const r = readQuestion(q);
    assert.equal(r?.intent, 'stats', `not routed: ${q}`);
  }
  assert.equal(readQuestion('median reply time last 30 days').params.days, 30);
  // No period named means all of it, not the three-day "gone quiet" default.
  assert.equal(readQuestion('average response time').params.days, 0);
});

test('asking who is waiting is still not a stats question', () => {
  assert.equal(readQuestion('who has not had a reply')?.intent, 'unanswered');
  assert.equal(readQuestion('which chats went quiet for 10 days')?.intent, 'quiet');
});
