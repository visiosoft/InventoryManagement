import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRecentAsk, RECENT_LIMIT } from './recentAsks.js';

test('a question goes first, a repeat moves up instead of showing twice', () => {
   const t = new Date('2026-10-27T08:00:00Z');
   let list = addRecentAsk([], 'Who is on shift now?', t);
   list = addRecentAsk(list, "  Today's   leads as a PDF ", t);
   assert.deepEqual(list.map((x) => x.q), ["Today's leads as a PDF", 'Who is on shift now?']);
   list = addRecentAsk(list, 'who is on SHIFT now?', t);
   assert.deepEqual(list.map((x) => x.q), ['who is on SHIFT now?', "Today's leads as a PDF"]);
});

test('too short is not kept, and the list stays capped', () => {
   assert.deepEqual(addRecentAsk([], ' a '), []);
   let list = [];
   for (let i = 0; i < RECENT_LIMIT + 5; i += 1) list = addRecentAsk(list, `question ${i}`);
   assert.equal(list.length, RECENT_LIMIT);
   assert.equal(list[0].q, `question ${RECENT_LIMIT + 4}`);
   assert.equal(addRecentAsk(null, 'x'.repeat(500))[0].q.length, 300);
});
