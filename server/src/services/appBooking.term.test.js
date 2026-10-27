import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTerm } from './appBooking.js';
import { termWeeks } from './quoteLines.js';

test('4 weeks is 28 days: check-in and check-out days both count', () => {
   const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
   const { start, end, weeks } = parseTerm({ startDate: day, weeks: 4 });
   const days = Math.round((end - start) / 86400000) + 1;
   assert.equal(days, 28);
   assert.equal(weeks, 4);
   assert.equal(termWeeks({ startDate: start, endDate: end }), 4, 'still billed as 4 weeks');
   assert.equal(termWeeks({ startDate: '2026-10-27', endDate: '2026-11-24' }), 4, 'contracts made before the fix keep their 4 weeks');
});
