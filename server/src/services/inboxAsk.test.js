import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuestion, parseAsk, INTENTS, DEFAULT_QUIET_DAYS } from './inboxAsk.js';

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
  assert.deepEqual(INTENTS, ['unanswered', 'quiet', 'hot', 'mentions', 'about']);
});
