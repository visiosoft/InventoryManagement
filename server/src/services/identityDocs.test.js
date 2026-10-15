import test from 'node:test';
import assert from 'node:assert/strict';
import { idComplete, latestPerSlot, slotOf } from './identityDocs.js';

const d = (type, side, at) => ({ type, side, createdAt: at });

test('both sides of an Emirates ID make ID complete', () => {
  assert.equal(idComplete([d('emirates_id', 'front', '2026-10-01')]), false);
  assert.equal(idComplete([d('emirates_id', 'front', '2026-10-01'), d('emirates_id', 'back', '2026-10-01')]), true);
});

test('a passport page alone is enough', () => {
  assert.equal(idComplete([d('passport', 'page', '2026-10-01')]), true);
  assert.equal(idComplete([d('passport', undefined, '2026-10-01')]), true);
});

test('other document types do not count as ID', () => {
  assert.equal(idComplete([d('visa', 'page', '2026-10-01'), d('other', 'front', '2026-10-01')]), false);
});

test('re-uploading a side replaces the older file in that slot', () => {
  const latest = latestPerSlot([d('emirates_id', 'front', '2026-10-01'), d('emirates_id', 'front', '2026-10-05'), d('emirates_id', 'back', '2026-10-02')]);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((x) => slotOf(x) === 'emirates_id:front').createdAt, '2026-10-05');
});
