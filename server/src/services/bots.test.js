import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSchedule, emailSummary, fillTemplate, isBotDue, pickRecipients, runBot } from './bots.js';

// Monday 26 Oct 2026, 09:05 in Dubai.
const MON_0905 = new Date('2026-10-26T05:05:00Z');

test('a bot runs at its hour on its day, once', () => {
   const weekly = { enabled: true, schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1 }, lastRunDay: '' };
   assert.equal(isBotDue(weekly, MON_0905), true);
   assert.equal(isBotDue({ ...weekly, lastRunDay: '2026-10-26' }, MON_0905), false, 'already ran today');
   assert.equal(isBotDue({ ...weekly, schedule: { ...weekly.schedule, dayOfWeek: 2 } }, MON_0905), false, 'not its day');
   assert.equal(isBotDue({ ...weekly, schedule: { ...weekly.schedule, hour: 10 } }, MON_0905), false, 'too early');
   assert.equal(isBotDue({ ...weekly, schedule: { ...weekly.schedule, hour: 7 } }, MON_0905), true, 'a restart after its hour still runs it');
   assert.equal(isBotDue({ ...weekly, enabled: false }, MON_0905), false);
   assert.equal(isBotDue({ enabled: true, schedule: { cadence: 'manual' } }, MON_0905), false);
   assert.equal(describeSchedule(weekly.schedule), 'Every Monday 09:00');
   assert.equal(describeSchedule({ cadence: 'monthly', hour: 8, dayOfMonth: 2 }), 'Monthly on the 2nd 08:00');
});

const contracts = [
   { _id: 'k1', contractNo: 'C-1', endDate: new Date('2026-11-18T00:00:00Z'), customer: { _id: 'c1', fullName: 'Sara Ahmed', email: 'sara@example.com' }, unit: { unitNumber: 'B-214' } },
   { _id: 'k2', endDate: new Date('2026-11-20T00:00:00Z'), customer: { _id: 'c2', fullName: 'No Email' }, unit: { unitNumber: 'A-1' } },
   { _id: 'k3', endDate: new Date('2026-11-21T00:00:00Z'), renewalIntent: 'renewing', customer: { _id: 'c3', fullName: 'Renewing', email: 'r@example.com' } },
   { _id: 'k4', endDate: new Date('2026-11-22T00:00:00Z'), customer: { _id: 'c4', fullName: 'Emailed Already', email: 'e@example.com' } },
];

test('renewal emails go to who needs one, filled in', () => {
   const items = pickRecipients(contracts, { recentlyEmailed: new Set(['k4']), now: MON_0905 });
   assert.deepEqual(items.map((i) => i.email), ['sara@example.com']);
   assert.equal(items[0].subject, 'Your PurpleBox storage ends on 18 November 2026');
   assert.match(items[0].body, /^Hi Sara,/);
   assert.match(items[0].body, /unit B-214/);
   assert.equal(fillTemplate('Hi {name}, {nope}', {}), 'Hi there, {nope}');
   assert.equal(emailSummary([{ status: 'pending' }, { status: 'sent' }, { status: 'sent' }]), '1 to approve · 2 sent');
   assert.equal(emailSummary([]), 'Nobody to email this time.');
});

function deps(extra = {}) {
   const mails = [];
   const saved = [];
   return {
      mails, saved,
      deps: {
         expiring: async () => contracts,
         recentlyEmailed: async () => new Set(),
         sentToday: async () => 0,
         owner: async () => ({ _id: 'u1', name: 'Mase', role: 'admin' }),
         sendMail: async (m) => { mails.push(m); },
         saveRun: async (r) => { saved.push(r); return r; },
         ...extra,
      },
   };
}

test('"ask me first": the run prepares the emails and sends none', async () => {
   const { mails, deps: d } = deps();
   const run = await runBot({ _id: 'b1', name: 'Renewals', kind: 'contract_emails', days: 30, sendMode: 'review' }, { now: MON_0905, deps: d });
   assert.equal(mails.length, 0);
   assert.equal(run.status, 'waiting');
   assert.equal(run.items.length, 2);
   assert.equal(run.summary, '2 to approve');
});

test('"send by itself": sends, within the daily cap', async () => {
   const { mails, deps: d } = deps({ sentToday: async () => 49 });
   const run = await runBot({ _id: 'b1', name: 'Renewals', kind: 'contract_emails', days: 30, sendMode: 'auto', dailyCap: 50 }, { now: MON_0905, deps: d });
   assert.equal(mails.length, 1, 'one left under the cap');
   assert.equal(mails[0].context.kind, 'reminder');
   assert.equal(run.summary, '1 to approve · 1 sent');
});

test('an AI report asks the assistant as its owner, with the web only if allowed', async () => {
   let asked = null;
   const { deps: d } = deps({ ask: async (a) => { asked = a; return { answer: 'Competitor A: AED 1,200 for 50 sq ft.\nMore lines', grounded: true, sources: [{ label: 'A', url: 'https://a.example' }] }; } });
   const run = await runBot({ _id: 'b2', name: 'Competitor watch', kind: 'ai_report', instruction: 'Competitor prices for 50 sq ft', web: true, createdBy: 'u1' }, { now: MON_0905, deps: d });
   assert.equal(asked.web, true);
   assert.equal(asked.user.role, 'admin');
   assert.match(asked.question, /^Competitor prices for 50 sq ft/);
   assert.equal(run.summary, 'Competitor A: AED 1,200 for 50 sq ft.');
   assert.deepEqual(run.sources, [{ label: 'A', url: 'https://a.example' }]);
});

test('a failed run says so instead of throwing', async () => {
   const { deps: d } = deps({ expiring: async () => { throw new Error('db down'); } });
   const run = await runBot({ _id: 'b1', kind: 'contract_emails', sendMode: 'review' }, { deps: d });
   assert.equal(run.status, 'failed');
   assert.equal(run.error, 'db down');
});

test('a bot is saved only with what it may hold', async () => {
   const { cleanBot } = await import('../routes/bots.js');
   const { bot, errors } = cleanBot({ name: ' Renewals ', kind: 'contract_emails', days: 999, sendMode: 'yolo', schedule: { cadence: 'weekly', hour: 30 }, extra: 1 });
   assert.deepEqual(errors, []);
   assert.equal(bot.name, 'Renewals');
   assert.equal(bot.days, 120);
   assert.equal(bot.sendMode, 'review', 'anything but "auto" asks first');
   assert.equal(bot.schedule.hour, 23);
   assert.equal(bot.extra, undefined);
   assert.match(cleanBot({ name: 'x', kind: 'ai_report' }).errors.join(), /what it should find out/);
   assert.match(cleanBot({ kind: 'nope' }).errors.join(), /name.*what it does/);
});

test('the recommended bots are all valid, and only the emails reach customers — asking first', async () => {
   const { RECOMMENDED_BOTS } = await import('./bots.js');
   const { cleanBot } = await import('../routes/bots.js');
   assert.equal(RECOMMENDED_BOTS.length, 7);
   assert.ok(!RECOMMENDED_BOTS.some((b) => b.name === 'Past check-out watch'), 'taken out at the admin\'s request');
   for (const b of RECOMMENDED_BOTS) assert.deepEqual(cleanBot(b).errors, [], b.name);
   const emailers = RECOMMENDED_BOTS.filter((b) => b.kind === 'contract_emails');
   assert.equal(emailers.length, 1);
   assert.equal(cleanBot(emailers[0]).bot.sendMode, 'review');
   assert.deepEqual(RECOMMENDED_BOTS.filter((b) => b.web).map((b) => b.name), ['Why leads don\'t convert', 'Competitor watch']);
});

test('quiet good leads: open, far along or warm, silent a few days, nothing planned, not messaged this week', async () => {
   const { pickQuietLeads } = await import('./bots.js');
   const now = new Date('2026-10-28T06:00:00Z');
   const ago = (d) => new Date(now.getTime() - d * 864e5);
   const leads = [
      { _id: 'q', fullName: 'Quoted Quiet', phone: '+971501', phoneNormalized: '971501', status: 'quotation_sent', temperature: '' },
      { _id: 'h', fullName: 'Hot Quiet', phone: '+971502', phoneNormalized: '971502', status: 'contacted', temperature: 'hot' },
      { _id: 'c', fullName: 'Cold', phone: '+971503', phoneNormalized: '971503', status: 'contacted', temperature: 'cold' },
      { _id: 'f', fullName: 'Talking', phone: '+971504', phoneNormalized: '971504', status: 'quotation_sent', temperature: 'hot' },
      { _id: 'p', fullName: 'Planned', phone: '+971505', phoneNormalized: '971505', status: 'follow_up_scheduled', followUpAt: ago(-2) },
      { _id: 'o', fullName: 'Old', phone: '+971506', phoneNormalized: '971506', status: 'quotation_sent' },
      { _id: 'm', fullName: 'Messaged', phone: '+971507', phoneNormalized: '971507', status: 'quotation_sent' },
   ];
   const activity = new Map([
      ['971501', { lastIn: ago(5), lastAny: ago(4) }],
      ['971502', { lastIn: ago(3), lastAny: ago(3) }],
      ['971503', { lastIn: ago(5), lastAny: ago(5) }],
      ['971504', { lastIn: ago(1), lastAny: ago(1) }],
      ['971505', { lastIn: ago(6), lastAny: ago(6) }],
      ['971506', { lastIn: ago(60), lastAny: ago(60) }],
      ['971507', { lastIn: ago(6), lastAny: ago(6) }],
   ]);
   const picked = pickQuietLeads(leads, activity, { quietDays: 3, maxQuietDays: 30, recentlyMessaged: new Set(['m']), now });
   assert.deepEqual(picked.map((p) => p.lead._id), ['q', 'h']);
   assert.equal(picked[0].why, 'Quotation sent · quiet 4 days');
});

test('the quiet-leads bot fills the template with the first name and waits for a person', async () => {
   const sent = [];
   const now = new Date('2026-10-28T06:00:00Z');
   const run = await runBot({ _id: 'b9', name: 'Quiet leads', kind: 'quiet_leads', templateName: 'checking_in', quietDays: 3, sendMode: 'review' }, { now, deps: {
      template: async () => ({ name: 'checking_in', status: 'APPROVED', variableCount: 1, bodyText: 'Hi {{1}}, still looking for storage?' }),
      quietCandidates: async () => ({
         leads: [{ _id: 'q', fullName: 'Sara Ahmed', phone: '+971501', phoneNormalized: '971501', status: 'quotation_sent' }],
         activity: new Map([['971501', { lastIn: new Date(now - 5 * 864e5), lastAny: new Date(now - 5 * 864e5) }]]),
      }),
      recentlyMessaged: async () => new Set(),
      sendWhatsApp: async (i) => sent.push(i),
      saveRun: async (r) => r,
   } });
   assert.equal(sent.length, 0);
   assert.equal(run.status, 'waiting');
   assert.equal(run.items[0].body, 'Hi Sara, still looking for storage?');
   assert.equal(run.items[0].channel, 'whatsapp');
   const noTemplate = await runBot({ _id: 'b9', kind: 'quiet_leads', templateName: '' }, { deps: { saveRun: async (r) => r } });
   assert.match(noTemplate.error, /Choose the WhatsApp template/);
});
