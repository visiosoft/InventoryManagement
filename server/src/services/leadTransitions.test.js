import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionError, recordLeadTransition, applyTransitionDetails } from './leadTransitions.js';

const now = new Date('2026-09-20T10:00:00Z');
test('administrative moves never start the response clock, and no-op moves add no history', () => {
  for (const status of ['new', 'contacted', 'lost', 'already_customer', 'won']) {
    const lead = { status: 'contact_attempted', firstResponseAt: null, timeline: [] };
    recordLeadTransition(lead, status, 'rep', 'Changed after review', now);
    assert.equal(lead.firstResponseAt, null);
    assert.equal(lead.timeline[0].fromStatus, 'contact_attempted');
    assert.equal(lead.timeline[0].toStatus, status);
    assert.equal(lead.timeline[0].user, 'rep');
    assert.equal(recordLeadTransition(lead, status, 'rep'), false);
    assert.equal(lead.timeline.length, 1);
  }
});
test('loss requires a known reason and validates an optional revisit date', () => {
  assert.match(transitionError({}, 'lost', {}, now), /loss reason/);
  assert.match(transitionError({}, 'lost', { lossReason: 'invented' }, now), /loss reason/);
  assert.equal(transitionError({}, 'lost', { lossReason: 'price' }, now), null);
  assert.match(transitionError({}, 'lost', { lossReason: 'price', reopenAt: 'invalid' }, now), /future/);
  assert.match(transitionError({}, 'lost', { lossReason: 'price', reopenAt: now }, now), /future/);
  assert.equal(transitionError({ reopenAt: now }, 'lost', { lossReason: 'price', reopenAt: now }, now), null, 'an unchanged revisit date may already be due');
});
test('scheduled actions require an owner and a valid future instant', () => {
  for (const [status, field] of [['follow_up_scheduled', 'followUpAt'], ['site_visit_scheduled', 'siteVisitAt']]) {
    assert.match(transitionError({}, status, { [field]: '2026-09-21T10:00:00Z' }, now), /owner/);
    assert.match(transitionError({ owner: 'rep' }, status, { [field]: 'bad' }, now), /future/);
    assert.match(transitionError({ owner: 'rep' }, status, { [field]: now }, now), /future/);
    assert.equal(transitionError({ owner: 'rep' }, status, { [field]: '2026-09-21T10:00:00Z' }, now), null);
  }
});
test('reopening clears current loss metadata; rescheduling rearms reminders', () => {
  const lead = { lossReason: 'price', lossCompetitor: 'Other storage', reopenAt: now, followUpNotifiedAt: now, followUpPushedAt: now };
  applyTransitionDetails(lead, 'follow_up_scheduled', { followUpAt: '2026-09-21T10:00:00Z', followUpNote: 'Call about quote' });
  assert.equal(lead.lossReason, '');
  assert.equal(lead.reopenAt, null);
  assert.equal(lead.followUpNotifiedAt, null);
  assert.equal(lead.followUpPushedAt, null);
  assert.equal(lead.followUpNote, 'Call about quote');
});
