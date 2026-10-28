import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateGroups, agingBucket, agingSummary } from './receivables.js';

const row = (id, o = {}) => ({ _id: id, contract: 'C1', amount: 500, dueDate: new Date('2026-06-01T08:00:00Z'), status: 'overdue', createdAt: new Date(`2026-05-0${id.length}T00:00:00Z`), ...o });

test('same contract, amount and Dubai due day is one group; the oldest row is kept', () => {
   const rows = [row('bbb'), row('a'), row('cc'), row('d', { amount: 501 }), row('e', { status: 'paid' })];
   const [g, ...rest] = duplicateGroups(rows);
   assert.equal(rest.length, 0);
   assert.equal(g.rows, 3);
   assert.equal(g.keepId, 'a');
   assert.deepEqual(g.extraIds.sort(), ['bbb', 'cc']);
   assert.equal(g.extraTotal, 1000);
});

test('due times on the same Dubai day match; across Dubai midnight they do not', () => {
   const a = row('a', { dueDate: new Date('2026-06-01T19:30:00Z') }); // 23:30 Dubai, 1 June
   const b = row('bb', { dueDate: new Date('2026-05-31T21:00:00Z') }); // 01:00 Dubai, 1 June
   const c = row('ccc', { dueDate: new Date('2026-06-01T20:30:00Z') }); // 00:30 Dubai, 2 June
   const groups = duplicateGroups([a, b, c]);
   assert.equal(groups.length, 1);
   assert.equal(groups[0].rows, 2);
});

test('aging buckets by Dubai day', () => {
   const now = new Date('2026-10-28T10:00:00Z');
   assert.equal(agingBucket(new Date('2026-11-02T00:00:00Z'), now), 'upcoming');
   assert.equal(agingBucket(new Date('2026-10-28T03:00:00Z'), now), 'current');
   assert.equal(agingBucket(new Date('2026-10-01T03:00:00Z'), now), '1-30');
   assert.equal(agingBucket(new Date('2026-06-01T03:00:00Z'), now), 'over 120');
});

test('summary keeps duplicates apart: confirmed and maximum overdue', () => {
   const now = new Date('2026-10-28T10:00:00Z');
   const s = agingSummary([row('a'), row('bb'), row('c', { contract: 'C2', amount: 200 })], now);
   assert.deepEqual(s.duplicate, { rows: 1, total: 500 });
   assert.equal(s.overdueExcludingDuplicates, 700);
   assert.equal(s.overdueMaximum, 1200);
});
