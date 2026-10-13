import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentFilter, SEGMENT_LABELS } from './campaignStats.js';

test('every retargeting group has a filter and a label', () => {
  for (const seg of Object.keys(SEGMENT_LABELS)) {
    const f = segmentFilter('abc', seg);
    assert.ok(f, seg);
    assert.equal(f.campaign, 'abc');
    assert.equal(f.channel, 'whatsapp');
  }
});
test('"read, no reply" needs a read time and no reply time', () => {
  const f = segmentFilter('c', 'read_no_reply');
  assert.deepEqual(f.readAt, { $ne: null });
  assert.equal(f.repliedAt, null);
});
test('an unknown group has no filter', () => {
  assert.equal(segmentFilter('c', 'everyone'), null);
});
