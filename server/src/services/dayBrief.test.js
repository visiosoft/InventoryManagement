import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayBrief, lateness, daysLate, waitedFor, ESCALATE_AFTER_DAYS, LIST_LIMIT } from './dayBrief.js';

const NOW = new Date('2026-09-04T06:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5);
const task = (title, dueDate, extra = {}) => ({ taskNo: 'T-2026-0001', title, dueDate, ...extra });
const user = { name: 'Gilbert Etongwe', email: 'g@purplebox.ae', role: 'sales_rep' };

test('how late something is, said the way a person says it', () => {
   assert.equal(lateness(daysAgo(0), NOW), 'today');
   assert.equal(lateness(daysAgo(1), NOW), '1 day late');
   assert.equal(lateness(daysAgo(9), NOW), '9 days late');
   // Something due later today is not late at all.
   assert.equal(daysLate(new Date(NOW.getTime() + 36e5), NOW), 0);
});

test('a wait is measured in the unit that suits its length', () => {
   assert.equal(waitedFor(new Date(NOW.getTime() - 20 * 60000), NOW), '20m');
   assert.equal(waitedFor(new Date(NOW.getTime() - 5 * 36e5), NOW), '5h');
   assert.equal(waitedFor(daysAgo(3), NOW), '3d');
});

test('a morning with nothing in it is not sent', () => {
   const brief = buildDayBrief({ user, now: NOW });
   assert.equal(brief.empty, true);
});

test('the subject carries the numbers, because that is all a phone shows', () => {
   const brief = buildDayBrief({
      user,
      overdue: [task('Call back Ahmed', daysAgo(2))],
      today: [task('Send the quote', NOW)],
      waiting: [{ name: 'Nadia', since: daysAgo(1) }],
      now: NOW,
   });
   assert.equal(brief.subject, 'Your morning: 1 overdue, 1 due today, 1 waiting on a reply');
   assert.equal(brief.empty, false);
});

test('overdue work is listed oldest first and says how late it is', () => {
   const brief = buildDayBrief({
      user,
      overdue: [task('Oldest', daysAgo(9)), task('Newer', daysAgo(1))],
      now: NOW,
   });
   const oldestAt = brief.text.indexOf('Oldest');
   const newerAt = brief.text.indexOf('Newer');
   assert.ok(oldestAt > -1 && oldestAt < newerAt, 'the oldest debt comes first');
   assert.match(brief.text, /9 days late/);
});

test('a long list is cut short rather than scrolling forever', () => {
   const many = Array.from({ length: LIST_LIMIT + 5 }, (_, i) => task(`Task ${i}`, daysAgo(i + 1)));
   const brief = buildDayBrief({ user, overdue: many, now: NOW });
   assert.match(brief.text, /and 5 more/);
   assert.ok(!brief.text.includes(`Task ${LIST_LIMIT + 2}`), 'nothing past the limit is spelled out');
});

test('the team section only appears when there is one', () => {
   const stuck = [{ ...task('Chase the deposit', daysAgo(ESCALATE_AFTER_DAYS + 1)), who: 'mohammed emad' }];
   const forRep = buildDayBrief({ user, today: [task('Something', NOW)], now: NOW });
   assert.ok(!forRep.text.includes('Across the team'));

   const forManager = buildDayBrief({ user: { ...user, role: 'admin' }, stuck, now: NOW });
   assert.match(forManager.text, /Across the team, stuck 3\+ days/);
   assert.match(forManager.text, /mohammed emad/);
   // "All clear" over a list of late work would read as a lie.
   assert.equal(forManager.subject, 'Your morning: 1 stuck 3+ days across the team');
});

test('the push line leads with the worst thing, not a summary', () => {
   const withOverdue = buildDayBrief({ user, overdue: [task('Call back Ahmed', daysAgo(4))], now: NOW });
   assert.match(withOverdue.push.body, /Call back Ahmed — 4 days late/);

   const onlyWaiting = buildDayBrief({ user, waiting: [{ name: 'Nadia', since: daysAgo(2) }], now: NOW });
   assert.match(onlyWaiting.push.body, /Nadia has been waiting 2d/);
});

test('a customer name with markup in it cannot break the email', () => {
   const brief = buildDayBrief({ user, waiting: [{ name: '<script>alert(1)</script>', since: NOW }], now: NOW });
   assert.ok(!brief.html.includes('<script>'), 'it is escaped');
   assert.match(brief.html, /&lt;script&gt;/);
});
