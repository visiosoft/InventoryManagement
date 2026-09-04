import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFor, onTheClock, waitedMinutes, buildNudge, humanWait, SLA_DEFAULTS } from './leadSla.js';

const NOW = new Date('2026-09-04T10:00:00.000Z');
const minsAgo = (n) => new Date(NOW.getTime() - n * 60000);
const lead = (over = {}) => ({
   _id: 'l1', fullName: 'Nadia', phone: '+971551234567',
   owner: 'u1', assignedAt: minsAgo(20), firstResponseAt: null, status: 'new',
   slaNudgedAt: null, slaReassignedAt: null, ...over,
});

test('the clock only runs on a lead somebody was given and has not answered', () => {
   assert.equal(onTheClock(lead()), true);
   // Nobody chose them: every WhatsApp chat gets a default owner at birth.
   assert.equal(onTheClock(lead({ assignedAt: null })), false);
   assert.equal(onTheClock(lead({ owner: null })), false);
   // Answered, or finished.
   assert.equal(onTheClock(lead({ firstResponseAt: minsAgo(2) })), false);
   assert.equal(onTheClock(lead({ status: 'won' })), false);
   assert.equal(onTheClock(lead({ status: 'lost' })), false);
});

test('a reminder at the first mark, a move at the second', () => {
   assert.equal(actionFor(lead({ assignedAt: minsAgo(5) }), NOW, SLA_DEFAULTS), null);
   assert.equal(actionFor(lead({ assignedAt: minsAgo(16) }), NOW, SLA_DEFAULTS), 'nudge');
   assert.equal(actionFor(lead({ assignedAt: minsAgo(31) }), NOW, SLA_DEFAULTS), 'reassign');
});

test('neither happens twice', () => {
   const nudged = lead({ assignedAt: minsAgo(20), slaNudgedAt: minsAgo(5) });
   assert.equal(actionFor(nudged, NOW, SLA_DEFAULTS), null);

   /* One reassignment is a correction. A lead going round the team all
      afternoon is a system nobody trusts — so a lead that has already been
      moved is never moved again, however long the new owner takes.

      A move resets assignedAt and the nudge marker, which is why the new owner
      still gets their own reminder: the clock is theirs now, not the last
      person's. */
   const movedAndReminded = lead({ assignedAt: minsAgo(90), slaReassignedAt: minsAgo(60), slaNudgedAt: minsAgo(50) });
   assert.equal(actionFor(movedAndReminded, NOW, SLA_DEFAULTS), null);

   const movedNotYetReminded = lead({ assignedAt: minsAgo(20), slaReassignedAt: minsAgo(20) });
   assert.equal(actionFor(movedNotYetReminded, NOW, SLA_DEFAULTS), 'nudge');
});

test('either half can be switched off on its own', () => {
   const old = lead({ assignedAt: minsAgo(45) });
   assert.equal(actionFor(old, NOW, { nudgeMinutes: 15, reassignMinutes: 0 }), 'nudge');
   assert.equal(actionFor(old, NOW, { nudgeMinutes: 0, reassignMinutes: 30 }), 'reassign');
   assert.equal(actionFor(old, NOW, { nudgeMinutes: 0, reassignMinutes: 0 }), null);
});

test('how long it has been waiting', () => {
   assert.equal(waitedMinutes(lead({ assignedAt: minsAgo(42) }), NOW), 42);
   assert.equal(waitedMinutes(lead({ assignedAt: null }), NOW), 0);
});

test('the reminder says what happens next, and when it will not', () => {
   const soon = buildNudge({ leads: [{ lead: lead(), waited: 20 }], reassignMinutes: 30 });
   assert.match(soon.text, /has been yours for 20 minutes/);
   assert.match(soon.text, /next 10 minutes it goes to somebody else/);

   // With reassignment off there is no threat to make, so none is made.
   const quiet = buildNudge({ leads: [{ lead: lead(), waited: 20 }], reassignMinutes: 0 });
   assert.match(quiet.text, /They are still waiting\./);
   assert.ok(!quiet.text.includes('somebody else'));
});

test('a lead with no name is still referred to as somebody', () => {
   const anonymous = lead({ fullName: 'WhatsApp Contact 5521', whatsappProfileName: 'Sam' });
   assert.match(buildNudge({ leads: [{ lead: anonymous, waited: 16 }] }).subject, /Sam/);
});

test('a long wait is said in hours or days, not in minutes', () => {
   // "2962 minutes" is a number a machine produced; two days is what happened.
   assert.equal(humanWait(20), '20 minutes');
   assert.equal(humanWait(1), '1 minute');
   assert.equal(humanWait(180), '3 hours');
   assert.equal(humanWait(2962), '2 days');

   const stale = buildNudge({ leads: [{ lead: { _id: 'l1', fullName: 'Nadia' }, waited: 2962 }] });
   assert.match(stale.text, /has been yours for 2 days/);
   assert.ok(!stale.text.includes('2962'));
});

test('everything one person is due arrives as one message', () => {
   /* Per lead this sent 27 emails in a day to two inboxes, on top of the one
      each lead already sends when it is handed over. Two emails per lead is
      how an inbox rule gets written. */
   const many = buildNudge({
      leads: [
         { lead: lead({ _id: 'a', fullName: 'Nadia' }), waited: 20 },
         { lead: lead({ _id: 'b', fullName: 'Omar' }), waited: 300 },
      ],
      reassignMinutes: 30,
   });
   assert.equal(many.subject, '2 leads still waiting');
   // Longest wait first, whatever order they came in.
   assert.ok(many.text.indexOf('Omar') < many.text.indexOf('Nadia'));
   assert.match(many.push.body, /Longest: Omar, 5 hours/);
   // One link to the board, not one per lead.
   assert.equal(many.push.url, '/leads');
});
