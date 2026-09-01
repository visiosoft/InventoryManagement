import test from 'node:test';
import assert from 'node:assert/strict';
import { awardsFor, rank, MIN_LEADS_FOR_RATE } from './awards.js';

const row = (o) => ({
   userId: 'x', closed: 0, value: 0, received: 0,
   medianResponseMins: 0, closedPreviously: 0, closedEverBefore: false, ...o,
});

test('the top closer is the one who closed the most', () => {
   const a = awardsFor([
      row({ userId: 'a', closed: 5, value: 100 }),
      row({ userId: 'b', closed: 2, value: 900 }),
   ]);
   assert.ok(a.a.includes('top_closer'));
   assert.ok(!(a.b ?? []).includes('top_closer'));
   // and value is its own award, so the bigger book still gets recognised
   assert.ok(a.b.includes('highest_value'));
});

test('a period where nobody closed anything awards nothing', () => {
   // A trophy for a zero is worth less than no trophy.
   const a = awardsFor([row({ userId: 'a' }), row({ userId: 'b' })]);
   assert.deepEqual(a, {});
});

test('an empty team does not crash or crown anybody', () => {
   assert.deepEqual(awardsFor([]), {});
   assert.deepEqual(awardsFor(), {});
});

test('equal people share the award rather than one being picked', () => {
   const a = awardsFor([
      row({ userId: 'a', closed: 3, value: 50 }),
      row({ userId: 'b', closed: 3, value: 50 }),
   ]);
   assert.ok(a.a.includes('top_closer'));
   assert.ok(a.b.includes('top_closer'));
});

test('conversion needs enough leads for the rate to mean anything', () => {
   const a = awardsFor([
      // a perfect record off one lead
      row({ userId: 'lucky', closed: 1, received: 1 }),
      // a real record off a real pipeline
      row({ userId: 'grafter', closed: 4, received: MIN_LEADS_FOR_RATE }),
   ]);
   assert.ok(!(a.lucky ?? []).includes('best_conversion'));
   assert.ok(a.grafter.includes('best_conversion'));
});

test('fastest reply ignores anybody who has never replied', () => {
   // 0 minutes means "no measurement", not "instant".
   const a = awardsFor([
      row({ userId: 'never', closed: 1, medianResponseMins: 0 }),
      row({ userId: 'quick', closed: 1, medianResponseMins: 4 }),
   ]);
   assert.ok(a.quick.includes('fastest_response'));
   assert.ok(!(a.never ?? []).includes('fastest_response'));
});

test('most improved needs an actual rise', () => {
   const a = awardsFor([
      row({ userId: 'up', closed: 5, closedPreviously: 1 }),
      row({ userId: 'flat', closed: 5, closedPreviously: 5 }),
      row({ userId: 'down', closed: 5, closedPreviously: 9 }),
   ]);
   assert.ok(a.up.includes('most_improved'));
   assert.ok(!(a.flat ?? []).includes('most_improved'));
   assert.ok(!(a.down ?? []).includes('most_improved'));
});

test('a first deal is awarded once, and not to somebody who had one before', () => {
   const a = awardsFor([
      row({ userId: 'new', closed: 1, closedEverBefore: false }),
      row({ userId: 'old', closed: 6, closedEverBefore: true }),
   ]);
   assert.ok(a.new.includes('first_deal'));
   assert.ok(!(a.old ?? []).includes('first_deal'));
});

test('ranking shares a position, and the next one skips', () => {
   const r = rank([
      row({ userId: 'a', closed: 3, value: 10 }),
      row({ userId: 'b', closed: 3, value: 10 }),
      row({ userId: 'c', closed: 1, value: 99 }),
   ]);
   assert.deepEqual(r.map((x) => [x.userId, x.position]), [['a', 1], ['b', 1], ['c', 3]]);
});

test('ranking breaks a tie on closes with the bigger book', () => {
   const r = rank([
      row({ userId: 'small', closed: 2, value: 100 }),
      row({ userId: 'big', closed: 2, value: 5000 }),
   ]);
   assert.deepEqual(r.map((x) => x.userId), ['big', 'small']);
   assert.deepEqual(r.map((x) => x.position), [1, 2]);
});
