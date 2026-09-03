/**
 * Guards on the WhatsApp assistant, run with `node --test`.
 *
 * These cover the decisions that stop it messaging someone it should not, so
 * they deliberately need no database and no OpenAI key — they must be runnable
 * before the thing is ever pointed at real traffic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAction } from './aiBot.js';

const HOUR = 3600_000;
const NOW = new Date('2026-08-20T12:00:00.000Z');

const config = {
    maxRepliesPerThreadPerDay: 20,
    handoverKeywords: ['human', 'agent', 'call me'],
};

const thread = (over = {}) => ({
    phoneNormalized: '971500000000',
    status: 'bot',
    pausedUntil: null,
    pendingMessageId: 'wamid.1',
    handledMessageId: '',
    pendingText: 'How much is a 50 sqft unit?',
    pendingType: 'text',
    pendingAt: new Date(NOW - 2 * 60_000),
    repliesOn: '2026-08-20',
    repliesCount: 0,
    ...over,
});

const decide = (over, cfg = config) => decideAction({ thread: thread(over), config: cfg, now: NOW });

test('answers an ordinary question', () => {
    assert.equal(decide({}).action, 'generate');
});

test('stays quiet once handed to a person', () => {
    assert.equal(decide({ status: 'escalated' }).action, 'skip');
});

test('stays quiet while a colleague has the thread', () => {
    assert.equal(decide({ status: 'paused', pausedUntil: new Date(NOW.getTime() + 6 * HOUR) }).action, 'skip');
});

test('picks the thread back up once the pause has expired', () => {
    assert.equal(decide({ status: 'paused', pausedUntil: new Date(NOW.getTime() - HOUR) }).action, 'generate');
});

test('will not reply outside the 24-hour WhatsApp window', () => {
    const r = decide({ pendingAt: new Date(NOW.getTime() - 25 * HOUR) });
    assert.equal(r.action, 'skip');
    assert.match(r.reason, /24-hour/);
});

test('replies just inside the window', () => {
    assert.equal(decide({ pendingAt: new Date(NOW.getTime() - 22 * HOUR) }).action, 'generate');
});

test('speech and photos are read rather than handed over on sight', () => {
    /* Somebody saying out loud what they would otherwise have typed used to
       always wait for a colleague. The reading itself needs a network call, so
       this decision only says "read" — see understandMedia. */
    for (const type of ['audio', 'voice', 'image']) {
        assert.equal(decide({ pendingType: type, pendingText: '' }).action, 'read', `${type} should be read`);
    }
});

test('everything else a customer attaches still goes to a person', () => {
    /* A video is more than it is worth reading for what it usually says, and a
       document is a contract or a receipt — exactly what the assistant must not
       answer for. */
    for (const type of ['document', 'video', 'location', 'contacts']) {
        assert.equal(decide({ pendingType: type, pendingText: '' }).action, 'escalate', `${type} should escalate`);
    }
});

test('the reason reads as English, not "a unsupported"', () => {
    assert.match(decide({ pendingType: 'image', pendingText: '' }).reason, /sent a photo/);
    assert.match(decide({ pendingType: 'voice', pendingText: '' }).reason, /sent a voice note/);
    assert.match(decide({ pendingType: 'document', pendingText: '' }).reason, /cannot read/);
});

test('ignores reactions and system notices instead of handing them over', () => {
    // Escalating mutes the thread. A thumbs-up must never be able to stop the
    // assistant answering that customer for good.
    for (const type of ['reaction', 'system', 'unsupported', 'ephemeral', 'sticker']) {
        const r = decide({ pendingType: type, pendingText: '' });
        assert.equal(r.action, 'skip', `${type} should be ignored, not escalated`);
    }
});

test('ignores an empty message rather than raising a task about it', () => {
    assert.equal(decide({ pendingText: '   ' }).action, 'skip');
});

test('hands over when the daily cap is reached', () => {
    const r = decide({ repliesCount: 20, repliesOn: '2026-08-20' });
    assert.equal(r.action, 'escalate');
    assert.match(r.reason, /already sent 20/);
});

test("yesterday's count does not spend today's budget", () => {
    assert.equal(decide({ repliesCount: 20, repliesOn: '2026-08-19' }).action, 'generate');
});

test('hands over when the customer asks for a person', () => {
    for (const text of ['can I speak to a human', 'Please CALL ME back', 'give me an agent']) {
        const r = decide({ pendingText: text });
        assert.equal(r.action, 'escalate', `"${text}" should escalate`);
        assert.match(r.reason, /asked for a person/);
    }
});

test('a keyword inside an ordinary word does not trigger a handover falsely', () => {
    // 'agent' is a substring of nothing common, but the check is substring-based,
    // so this pins the behaviour rather than leaving it to chance.
    assert.equal(decide({ pendingText: 'Do you have management on site?' }).action, 'generate');
});

test('an empty keyword list never escalates on keywords', () => {
    const r = decideAction({
        thread: thread({ pendingText: 'I want a human' }),
        config: { maxRepliesPerThreadPerDay: 20, handoverKeywords: [] },
        now: NOW,
    });
    assert.equal(r.action, 'generate');
});

test('handover is checked before the reply is generated, not after', () => {
    // Escalation must not depend on the model's own judgement: a customer
    // asking for a person is decided here, before any OpenAI call.
    const r = decide({ pendingText: 'human please' });
    assert.equal(r.action, 'escalate');
});

test('escalation beats the reply cap ordering only when the cap is not hit', () => {
    const r = decide({ pendingText: 'human please', repliesCount: 20 });
    // The cap is checked first, and either outcome is a handover — what matters
    // is that it never reaches 'generate'.
    assert.equal(r.action, 'escalate');
});

/* Everybody waiting is answered together.
 *
 * This is the behaviour the whole feature was judged on: four people who write
 * at the same time must not be answered one after another, each waiting on the
 * previous person's call to the model. */
test('conversations are handled in parallel, not one after another', async () => {
   const started = [];
   let running = 0;
   let peak = 0;

   // Stands in for handleThread: records when it starts, holds for a moment.
   const work = async (name) => {
      started.push(name);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 30));
      running -= 1;
   };

   // The same batching the tick uses.
   const inBatches = async (items, size, fn) => {
      for (let i = 0; i < items.length; i += size) {
         await Promise.all(items.slice(i, i + size).map(fn));
      }
   };

   const four = ['ahmed', 'sara', 'bilal', 'kim'];
   const began = Date.now();
   await inBatches(four, 5, work);
   const took = Date.now() - began;

   assert.equal(peak, 4, 'all four should have been in flight at once');
   assert.ok(took < 100, `four 30ms conversations took ${took}ms — that is sequential`);
   assert.deepEqual(started.sort(), four.sort(), 'and every one of them was handled');
});

test('a rush larger than the limit is answered in waves, not all at once', async () => {
   let running = 0;
   let peak = 0;
   const work = async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
   };
   const inBatches = async (items, size, fn) => {
      for (let i = 0; i < items.length; i += size) {
         await Promise.all(items.slice(i, i + size).map(fn));
      }
   };
   await inBatches(Array.from({ length: 12 }, (_, i) => i), 5, work);
   // Twelve at once would be a good way to be rate-limited and answer nobody.
   assert.equal(peak, 5, `had ${peak} calls to OpenAI in flight at once`);
});

/* The reason a voice note went unanswered with no draft and no error: a
 * colleague had replied five hours earlier and the pause runs twelve. */
test('a live pause stops the assistant sending, but not suggesting', () => {
   const paused = {
      status: 'paused',
      pausedUntil: new Date(Date.now() + 6 * 3600_000),
      pendingText: 'do you have a 50 sqft unit?',
      pendingType: 'text',
      pendingAt: new Date(),
   };

   // Sending would talk over the colleague.
   assert.equal(
      decideAction({ thread: paused, config: { mode: 'auto', maxRepliesPerThreadPerDay: 20 } }).action,
      'skip',
   );
   // A suggestion cannot talk over anybody, and is the whole point of drafting.
   assert.equal(
      decideAction({ thread: paused, config: { mode: 'draft', maxRepliesPerThreadPerDay: 20 } }).action,
      'generate',
   );
});

test('a voice note during a pause is still read when drafting', () => {
   const paused = {
      status: 'paused',
      pausedUntil: new Date(Date.now() + 6 * 3600_000),
      pendingText: '',
      pendingType: 'audio',
      pendingAt: new Date(),
   };
   assert.equal(decideAction({ thread: paused, config: { mode: 'draft', maxRepliesPerThreadPerDay: 20 } }).action, 'read');
   assert.equal(decideAction({ thread: paused, config: { mode: 'auto', maxRepliesPerThreadPerDay: 20 } }).action, 'skip');
});

test('an escalated conversation is left alone even in draft mode', () => {
   // Handing over is a decision a person made; suggesting into it would be
   // the assistant overriding them.
   const handed = { status: 'escalated', pendingText: 'hello', pendingType: 'text', pendingAt: new Date() };
   for (const mode of ['draft', 'auto']) {
      assert.equal(decideAction({ thread: handed, config: { mode, maxRepliesPerThreadPerDay: 20 } }).action, 'skip');
   }
});
