import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeCursorFilter } from './messageCursor.js';

test('filters out everything strictly after the cursor timestamp', () => {
   const filter = beforeCursorFilter({ occurredAt: 1000, _id: 'm5' });
   assert.deepEqual(filter, {
      $or: [
         { occurredAt: { $lt: 1000 } },
         { occurredAt: 1000, _id: { $lt: 'm5' } },
      ],
   });
});

test('same-timestamp tie-break: a message with an equal occurredAt but a lower id still counts as older', () => {
   // Two messages landed in the same webhook batch, sharing occurredAt=1000,
   // with ids 'a' (lower) and 'b' (the cursor). 'a' must be included.
   const filter = beforeCursorFilter({ occurredAt: 1000, _id: 'b' });
   const matchesA = filter.$or.some((clause) => {
      if (clause.occurredAt?.$lt !== undefined) return 1000 < clause.occurredAt.$lt;
      return clause.occurredAt === 1000 && 'a' < clause._id.$lt;
   });
   assert.equal(matchesA, true);
});

test('same-timestamp tie-break: a message sharing the cursor id itself is excluded', () => {
   // The cursor message's own id must never be re-returned as "before itself".
   const filter = beforeCursorFilter({ occurredAt: 1000, _id: 'b' });
   const selfMatches = filter.$or.some((clause) => {
      if (clause.occurredAt?.$lt !== undefined) return 1000 < clause.occurredAt.$lt;
      return clause.occurredAt === 1000 && 'b' < clause._id.$lt;
   });
   assert.equal(selfMatches, false);
});

test('a message strictly earlier in time matches regardless of id ordering', () => {
   const filter = beforeCursorFilter({ occurredAt: 1000, _id: 'a' });
   const matches = filter.$or.some((clause) => {
      if (clause.occurredAt?.$lt !== undefined) return 900 < clause.occurredAt.$lt;
      return false;
   });
   assert.equal(matches, true);
});
