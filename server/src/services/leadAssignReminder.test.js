import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissed, reminderDue, buildAssignmentReminder, REMINDER_DEFAULTS } from './leadAssignReminder.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3600_000);
const lead = (over = {}) => ({
   _id: 'l1', fullName: 'Nadia', phone: '+971551234567',
   owner: 'u1', assignedAt: hoursAgo(4), firstResponseAt: null, status: 'new',
   assignmentReminderSentAt: null, ...over,
});

test('a lead only qualifies once it has genuinely sat untouched past the window', () => {
   assert.equal(isMissed(lead(), NOW, REMINDER_DEFAULTS.thresholdHours), true);
   assert.equal(isMissed(lead({ assignedAt: hoursAgo(1) }), NOW, REMINDER_DEFAULTS.thresholdHours), false, 'not long enough yet');
});

test('an attempt logged, a stage moved, or a WhatsApp reply — any of them counts as touched', () => {
   // firstResponseAt is the one field all three of those already write to
   // (see services/leadSla.js and services/aiBot.js's markFirstResponse).
   assert.equal(isMissed(lead({ firstResponseAt: hoursAgo(1) }), NOW), false);
});

test('nobody chosen yet, or the deal is already closed, is not a missed lead', () => {
   assert.equal(isMissed(lead({ owner: null }), NOW), false);
   assert.equal(isMissed(lead({ assignedAt: null }), NOW), false);
   assert.equal(isMissed(lead({ status: 'won' }), NOW), false);
   assert.equal(isMissed(lead({ status: 'lost' }), NOW), false);
});

test('the threshold is configurable, not hard-coded to the default', () => {
   assert.equal(isMissed(lead({ assignedAt: hoursAgo(2) }), NOW, 1), true);
   assert.equal(isMissed(lead({ assignedAt: hoursAgo(2) }), NOW, 6), false);
});

test('a lead never reminded is due; one reminded an hour ago is not', () => {
   assert.equal(reminderDue(lead(), NOW), true);
   assert.equal(reminderDue(lead({ assignmentReminderSentAt: hoursAgo(1) }), NOW), false);
});

test('at most one reminder per missed lead per day — due again only once a full day has passed', () => {
   assert.equal(reminderDue(lead({ assignmentReminderSentAt: hoursAgo(23) }), NOW), false);
   assert.equal(reminderDue(lead({ assignmentReminderSentAt: hoursAgo(25) }), NOW), true);
});

test('one missed lead reads as a plain sentence with its own deep link', () => {
   const n = buildAssignmentReminder({ leads: [{ leadId: 'l1', name: 'Nadia', phone: '+9715', waitedHours: 3.2 }] });
   assert.equal(n.push.title, 'Nadia is still waiting');
   assert.match(n.push.body, /3 hours ago/);
   assert.equal(n.push.url, '/leads/l1');
   assert.deepEqual(n.push.data, { type: 'lead_assigned', phone: '+9715', leadId: 'l1', name: 'Nadia' });
});

test('several missed leads collapse into one count, longest-waiting first, rather than stacking', () => {
   const n = buildAssignmentReminder({
      leads: [
         { leadId: 'l1', name: 'Nadia', phone: '+9715', waitedHours: 3 },
         { leadId: 'l2', name: 'Omar', phone: '+9716', waitedHours: 9 },
         { leadId: 'l3', name: 'Sara', phone: '+9717', waitedHours: 5 },
      ],
   });
   assert.equal(n.push.title, '3 leads are still waiting on you');
   assert.match(n.push.body, /Longest: Omar/);
   assert.equal(n.push.url, '/leads');
   assert.equal(n.push.data.type, 'lead_assigned_summary');
});

test('a lead with no saved name falls back to their number, never blank', () => {
   const n = buildAssignmentReminder({ leads: [{ leadId: 'l1', name: '', phone: '+9715', waitedHours: 3 }] });
   assert.match(n.push.title, /\+9715/);
});
