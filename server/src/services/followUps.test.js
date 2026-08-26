import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyDayFor, isDue, taskFor, describeFollowUp, FOLLOW_UP_KINDS } from './followUps.js';

// 2026-08-26 is a Wednesday. Dubai is UTC+4.
const WED = '2026-08-26T09:00:00.000Z';

test('a specific date fires on that day', () => {
  assert.equal(notifyDayFor(WED, 'date'), '2026-08-26');
});

test('a week fires on its Monday', () => {
  assert.equal(notifyDayFor(WED, 'week'), '2026-08-24');
});

test('a Monday is its own week start, not the one before', () => {
  assert.equal(notifyDayFor('2026-08-24T09:00:00.000Z', 'week'), '2026-08-24');
});

test('a Sunday closes its week rather than opening the next', () => {
  // 2026-08-30 is a Sunday: it belongs to the week beginning Monday the 24th.
  assert.equal(notifyDayFor('2026-08-30T09:00:00.000Z', 'week'), '2026-08-24');
});

test('a week start can fall in the previous month', () => {
  // Tuesday 2026-09-01 sits in the week beginning Monday 2026-08-31.
  assert.equal(notifyDayFor('2026-09-01T09:00:00.000Z', 'week'), '2026-08-31');
});

test('a month fires on its first', () => {
  assert.equal(notifyDayFor(WED, 'month'), '2026-08-01');
});

test('late-evening Dubai stays on the local day, not tomorrow UTC', () => {
  // 22:00 Dubai on the 26th is 18:00 UTC the same day.
  assert.equal(notifyDayFor('2026-08-26T18:00:00.000Z', 'date'), '2026-08-26');
});

test('early-morning Dubai belongs to the local day, not yesterday UTC', () => {
  // 01:00 Dubai on the 27th is 21:00 UTC on the 26th.
  assert.equal(notifyDayFor('2026-08-26T21:00:00.000Z', 'date'), '2026-08-27');
});

test('an unknown kind is treated as an exact date rather than guessed at', () => {
  assert.equal(notifyDayFor(WED, 'quarter'), '2026-08-26');
});

test('nothing to go on gives nothing back', () => {
  assert.equal(notifyDayFor(null, 'date'), '');
  assert.equal(notifyDayFor('not a date', 'date'), '');
});

test('the three kinds are the three the UI offers', () => {
  assert.deepEqual(FOLLOW_UP_KINDS, ['date', 'week', 'month']);
});

const lead = (over = {}) => ({
  _id: 'l1', fullName: 'Kaoba', owner: 'u1', status: 'follow_up_scheduled',
  followUpAt: WED, followUpKind: 'date', followUpNotifiedAt: null, ...over,
});

test('due on the day itself', () => {
  assert.equal(isDue(lead(), '2026-08-26'), true);
});

test('not due before the day', () => {
  assert.equal(isDue(lead(), '2026-08-25'), false);
});

test('a reminder missed while the server was down still goes out', () => {
  assert.equal(isDue(lead(), '2026-09-04'), true);
});

test('it goes out once', () => {
  assert.equal(isDue(lead({ followUpNotifiedAt: new Date() }), '2026-08-26'), false);
});

test('a closed lead is not chased', () => {
  assert.equal(isDue(lead({ status: 'won' }), '2026-08-26'), false);
  assert.equal(isDue(lead({ status: 'lost' }), '2026-08-26'), false);
});

test('a lead nobody owns has nobody to remind', () => {
  assert.equal(isDue(lead({ owner: null }), '2026-08-26'), false);
});

test('no follow-up set is never due', () => {
  assert.equal(isDue(lead({ followUpAt: null }), '2026-08-26'), false);
});

test('a monthly follow-up is due from the first of that month', () => {
  const l = lead({ followUpKind: 'month' });
  assert.equal(isDue(l, '2026-07-31'), false);
  assert.equal(isDue(l, '2026-08-01'), true);
});

test('the task goes to the owner and says which lead it is', () => {
  const t = taskFor(lead(), '2026-08-26');
  assert.equal(t.assignedTo, 'u1');
  assert.equal(t.leadId, 'l1');
  assert.equal(t.leadType, 'storage');
  assert.match(t.title, /Kaoba/);
  assert.equal(t.status, 'todo');
});

test('a hot lead is raised above the rest', () => {
  assert.equal(taskFor(lead({ temperature: 'hot' }), '2026-08-26').priority, 'high');
  assert.equal(taskFor(lead({ temperature: 'cold' }), '2026-08-26').priority, 'medium');
});

test('a nameless lead is still identifiable by number', () => {
  const t = taskFor(lead({ fullName: '', phone: '971556285854' }), '2026-08-26');
  assert.match(t.title, /971556285854/);
});

test('a late reminder is dated today, not buried in the past', () => {
  // Raised on 4 Sep for a follow-up asked for on 26 Aug: due now.
  const t = taskFor(lead(), '2026-09-04');
  assert.equal(t.dueDate.toISOString(), '2026-09-03T20:00:00.000Z');
});

test('a task scheduled ahead is dated for the day it is meant to be done', () => {
  // Set on 20 Aug for 26 Aug: the task is due on the 26th, not on the 20th.
  const t = taskFor(lead(), '2026-08-20');
  assert.equal(t.dueDate.toISOString(), '2026-08-25T20:00:00.000Z');
});

test('the description says when, and carries the detail across', () => {
  const d = describeFollowUp(lead({ notes: 'Wants two units in F3.', temperature: 'hot' }));
  assert.match(d, /2026-08-26/);
  assert.match(d, /Wants two units in F3\./);
  assert.match(d, /hot/);
});

test('a weekly follow-up explains that it is raised on the Monday', () => {
  const d = describeFollowUp(lead({ followUpKind: 'week' }));
  assert.match(d, /week of 2026-08-24/);
  assert.match(d, /Monday/);
});

test('a monthly follow-up explains that it is raised on the 1st', () => {
  const d = describeFollowUp(lead({ followUpKind: 'month' }));
  assert.match(d, /2026-08/);
  assert.match(d, /1st/);
});

test('nothing scheduled describes nothing', () => {
  assert.equal(describeFollowUp(lead({ followUpAt: null })), '');
});

test('a lead with no notes still gets a usable description', () => {
  const d = describeFollowUp(lead({ notes: '', temperature: '' }));
  assert.match(d, /Follow up on 2026-08-26/);
  assert.ok(!d.includes('Notes:'));
});
