import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, estimateCost, shouldReuse, carriedState } from './engine.js';
import { suffix, windowOpen, daysBetween, estimateValue, isPlaceholderName } from './shared.js';
import { scoreUnanswered } from './types/unansweredChats.js';
import { scoreRenewal } from './types/renewalsAtRisk.js';
import { scoreDebt } from './types/debt.js';
import { scoreRep } from './types/repCoaching.js';

const NOW = new Date('2026-09-06T10:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000);

/* ── identity ─────────────────────────────────────────────────────────────── */

test('the same person is recognised however their number was stored', () => {
   const forms = ['+971501234567', '00971501234567', '0501234567', '971 50 123 4567'];
   const keys = new Set(forms.map(suffix));
   assert.equal(keys.size, 1, 'every form should reduce to one key');
   assert.equal([...keys][0], '501234567');
});

test('a name the sync invented is not treated as a name', () => {
   assert.equal(isPlaceholderName('WhatsApp Contact 4821'), true);
   assert.equal(isPlaceholderName(''), true);
   assert.equal(isPlaceholderName('Mahmoud Gohar'), false);
});

/* ── the 24-hour window ───────────────────────────────────────────────────── */

test('the reply window is exact at 24 hours', () => {
   assert.equal(windowOpen(hoursAgo(23), NOW), true);
   assert.equal(windowOpen(hoursAgo(24.01), NOW), false);
   // Never written to us at all: there is no window to be inside.
   assert.equal(windowOpen(null, NOW), false);
});

/* ── value ────────────────────────────────────────────────────────────────── */

const PRICES = new Map([[10, 330], [25, 635], [50, 952], [100, 1647], [150, 2662]]);

test('an unknown value is null, never zero', () => {
   // Zero would sort a serious enquiry to the bottom and read as a fact.
   const v = estimateValue({ lead: { storageSizeValue: 0 } }, PRICES);
   assert.equal(v.aed, null);
   assert.match(v.basis, /not enough/);
});

test('a stated size is priced from the nearest size we actually stock', () => {
   const v = estimateValue({ lead: { storageSizeValue: 90, unitsNeeded: 1 } }, PRICES);
   assert.equal(v.aed, 1647);
   assert.match(v.basis, /90 sq ft/);
});

test('a quotation beats a guess, and a past contract beats a size', () => {
   assert.equal(estimateValue({ quote: { total: 1450, quoteNo: 'QT-000150' }, lead: { storageSizeValue: 50 } }, PRICES).aed, 1450);
   assert.equal(estimateValue({ contracts: [{ leasedPrice: 900 }], lead: { storageSizeValue: 50 } }, PRICES).aed, 900);
});

/* ── ranking ──────────────────────────────────────────────────────────────── */

test('a long wait outranks a short one, and every point is explained', () => {
   const old = scoreUnanswered({ waitedDays: 6, value: null, inbound: 1, hasOwner: true });
   const fresh = scoreUnanswered({ waitedDays: 1, value: null, inbound: 1, hasOwner: true });
   assert.ok(old.score > fresh.score);
   // A score nobody can argue with is a score nobody trusts.
   assert.ok(old.factors.length > 0);
   assert.match(old.factors[0], /Waiting 6 days/);
});

test('a chat nobody owns outranks an owned one of the same age', () => {
   const orphan = scoreUnanswered({ waitedDays: 2, value: null, inbound: 1, hasOwner: false });
   const owned = scoreUnanswered({ waitedDays: 2, value: null, inbound: 1, hasOwner: true });
   assert.ok(orphan.score > owned.score);
   assert.ok(orphan.factors.some((f) => /not assigned/i.test(f)));
});

/* ── the guard rail ───────────────────────────────────────────────────────── */

const TEMPLATES = [
   { name: 'quote_followup_hold_unit', variableCount: 1 },
   { name: 'final_nudge_closing', variableCount: 1 },
];
const SOURCES = ['first_name', 'offer_days'];
const opts = { templates: TEMPLATES, allowedSources: SOURCES, prose: ['whatWentWrong', 'angle'] };

test('an invented template name is rejected, not repaired', () => {
   const out = validatePlan({ template: 'storage_mega_deal', variables: [{ source: 'first_name' }] }, opts);
   assert.equal(out.ok, false);
   assert.match(out.reason, /unknown template/);
});

test('the wrong number of values is caught here, not by Meta', () => {
   const out = validatePlan({ template: 'quote_followup_hold_unit', variables: [] }, opts);
   assert.equal(out.ok, false);
   assert.match(out.reason, /needs 1 value/);
});

test('a literal variable is refused — that is where an invented price enters', () => {
   const out = validatePlan(
      { template: 'quote_followup_hold_unit', variables: [{ source: 'literal', text: 'AED 1,200' }] },
      opts,
   );
   assert.equal(out.ok, false);
   assert.match(out.reason, /not allowed/);
});

test('a figure stated in the prose drops the whole plan', () => {
   const out = validatePlan({ whatWentWrong: 'They balked at AED 1,200 a month.', angle: 'Try again' }, opts);
   assert.equal(out.ok, false);
   assert.match(out.reason, /stated a figure/);
});

test('a clean plan passes', () => {
   const out = validatePlan({
      whatWentWrong: 'Quotation went out and nobody followed it up.',
      angle: 'They asked about a discount and never got an answer.',
      template: 'quote_followup_hold_unit',
      variables: [{ source: 'first_name' }],
   }, opts);
   assert.equal(out.ok, true);
});

test('a plan with no template at all is fine — sometimes none fits', () => {
   assert.equal(validatePlan({ whatWentWrong: 'They went with a competitor.', angle: 'Leave them be.' }, opts).ok, true);
});

/* ── cost ─────────────────────────────────────────────────────────────────── */

test('the estimate is in the range the plan was approved on', () => {
   const cheap = estimateCost(500, 'gpt-4o-mini');
   const dear = estimateCost(500, 'gpt-4.1');
   assert.ok(cheap > 0.1 && cheap < 0.35, `500 chats on mini should be ~$0.20, got ${cheap}`);
   assert.ok(dear > 2 && dear < 3.5, `500 chats on 4.1 should be ~$2.70, got ${dear}`);
   assert.equal(estimateCost(0, 'gpt-4.1'), 0);
});

test('days between is whole days and never negative', () => {
   assert.equal(daysBetween(new Date('2026-09-01T10:00:00Z'), NOW), 5);
   assert.equal(daysBetween(new Date('2026-09-09T10:00:00Z'), NOW), 0);
   assert.equal(daysBetween(null), null);
});

/* ── what survives between runs ───────────────────────────────────────────── */

test('an unchanged item is reused; a moved one is judged again', () => {
   const held = { cacheKey: 'msg-9|never_quoted|13' };
   assert.equal(shouldReuse(held, { cacheKey: 'msg-9|never_quoted|13' }), true);
   // A new message, a flipped category, or a new template all move the key.
   assert.equal(shouldReuse(held, { cacheKey: 'msg-10|never_quoted|13' }), false);
   assert.equal(shouldReuse(held, { cacheKey: 'msg-9|went_quiet|13' }), false);
   assert.equal(shouldReuse(null, { cacheKey: 'msg-9' }), false);
});

test('a free agent caches nothing, so it is never served a stale answer', () => {
   assert.equal(shouldReuse({ cacheKey: '' }, { cacheKey: '' }), false);
});

test('a dismissal survives the next run', () => {
   // Otherwise every run resurrects everything anybody has already dealt with.
   const held = { state: 'dismissed', stateAt: new Date('2026-09-01T00:00:00Z') };
   assert.equal(carriedState(held, { lastInboundAt: null }, NOW)?.state, 'dismissed');
});

test('but a reply wakes it, whatever was decided', () => {
   const held = { state: 'dismissed', stateAt: new Date('2026-09-01T00:00:00Z') };
   const wrote = { lastInboundAt: new Date('2026-09-04T00:00:00Z') };
   assert.equal(carriedState(held, wrote, NOW), null, 'someone who writes back is live again');
});

test('a snooze that has run out is over', () => {
   const held = {
      state: 'snoozed',
      stateAt: new Date('2026-09-01T00:00:00Z'),
      snoozeUntil: new Date('2026-09-05T00:00:00Z'),
   };
   assert.equal(carriedState(held, {}, NOW), null);
   held.snoozeUntil = new Date('2026-09-20T00:00:00Z');
   assert.equal(carriedState(held, {}, NOW)?.state, 'snoozed');
});

test('an open finding carries nothing — it is simply produced again', () => {
   assert.equal(carriedState({ state: 'open' }, {}, NOW), null);
});

/* ── the other agents' rankings ───────────────────────────────────────────── */

test('a contract ending sooner outranks one ending later', () => {
   const soon = scoreRenewal({ daysLeft: 5, monthly: 900, silentDays: 20, everSpoke: true, months: 6 })
   const later = scoreRenewal({ daysLeft: 45, monthly: 900, silentDays: 20, everSpoke: true, months: 6 })
   assert.ok(soon.score > later.score)
   assert.match(soon.factors[0], /Ends in 5 days/)
})

test('a contract that has already ended reads as ended, not as negative days', () => {
   const past = scoreRenewal({ daysLeft: -3, monthly: 900, silentDays: 30, everSpoke: true, months: 12 })
   assert.match(past.factors[0], /Ended 3 days ago/)
   // Past the date is the worst case, not a smaller number.
   const future = scoreRenewal({ daysLeft: 5, monthly: 900, silentDays: 30, everSpoke: true, months: 12 })
   assert.ok(past.score > future.score)
})

test('never having spoken to a renewing customer at all is called out', () => {
   const never = scoreRenewal({ daysLeft: 20, monthly: 900, silentDays: null, everSpoke: false, months: 6 })
   assert.ok(never.factors.some((f) => /no whatsapp conversation/i.test(f)))
})

test('a bigger debt outranks a smaller one, and silence adds to it', () => {
   const big = scoreDebt({ owed: 8000, silentDays: 30, everSpoke: true, renting: true })
   const small = scoreDebt({ owed: 300, silentDays: 30, everSpoke: true, renting: true })
   assert.ok(big.score > small.score)
   assert.match(big.factors[0], /8,000 outstanding/)
})

test('a debt nobody has ever mentioned is flagged as such', () => {
   const unasked = scoreDebt({ owed: 1000, silentDays: null, everSpoke: false, renting: false })
   assert.ok(unasked.factors.some((f) => /never mentioned/i.test(f)))
   assert.ok(unasked.factors.some((f) => /no longer renting/i.test(f)))
})

test('a rep with people waiting needs attention before one without', () => {
   const behind = scoreRep({ waiting: 9, medianMs: 4 * 3600_000, p90Ms: 26 * 3600_000, conversations: 40 })
   const onTop = scoreRep({ waiting: 0, medianMs: 6 * 60_000, p90Ms: 20 * 60_000, conversations: 40 })
   assert.ok(behind.score > onTop.score)
   assert.match(behind.factors[0], /9 people are waiting/)
})

test('the coaching score always explains itself in plain terms', () => {
   const out = scoreRep({ waiting: 2, medianMs: 90 * 60_000, p90Ms: 30 * 3600_000, conversations: 18 })
   // A manager reads this about a named person; every point must be visible.
   assert.ok(out.factors.length >= 3)
   assert.ok(out.factors.some((f) => /conversations in the period/.test(f)))
   assert.ok(!out.factors.some((f) => /bad|poor|lazy|careless/i.test(f)), 'never characterises the person')
})

/* ── the loop: findings → tasks → outcomes ────────────────────────────────── */

import renewals from './types/renewalsAtRisk.js'

test('a renewal finding becomes a task that says what to do, not what was noticed', () => {
   const spec = renewals.taskFor({
      title: 'Hind Al Suwaidi',
      detail: 'Nobody has raised renewal with her.',
      phoneNormalized: '971501234567',
      recommendation: { angle: 'She asked about summer storage for garden furniture.' },
      data: { contractNo: 'PB-2026-0301', daysLeft: 9, valueAed: 980, months: 11, daysSince: 21 },
   })
   assert.match(spec.title, /^Ask Hind Al Suwaidi about renewing/)
   assert.match(spec.title, /PB-2026-0301 ends in 9 day/)
   assert.equal(spec.leadType, 'contract')
   assert.equal(spec.priority, 'medium')
   assert.match(spec.description, /garden furniture/)
   assert.match(spec.description, /\+971501234567/)
})

test('a contract ending this week is a high-priority task', () => {
   const spec = renewals.taskFor({ title: 'A', data: { contractNo: 'X', daysLeft: 3 } })
   assert.equal(spec.priority, 'high')
   const gone = renewals.taskFor({ title: 'A', data: { contractNo: 'X', daysLeft: -2 } })
   assert.match(gone.title, /ended 2 day/)
})

test('a renewal is recognised from a later contract, and only a later one', () => {
   const since = new Date('2026-09-01T00:00:00Z')
   const byCustomer = new Map([['c1', [
      { contractNo: 'OLD', status: 'active', createdAt: new Date('2026-01-01'), leasedPrice: 900 },
      { contractNo: 'NEW', status: 'active', createdAt: new Date('2026-09-05'), leasedPrice: 950 },
   ]]])
   const seen = renewals.outcomeFor({ subjectId: 'c1', since, valueAed: 900 }, { contractsByCustomer: byCustomer })
   assert.equal(seen.kind, 'renewed')
   assert.match(seen.detail, /NEW/)
   // What was kept is what they now pay, not what the finding guessed.
   assert.equal(seen.valueAed, 950)

   // The same customer with only the old contract has not renewed.
   byCustomer.set('c1', [byCustomer.get('c1')[0]])
   assert.equal(renewals.outcomeFor({ subjectId: 'c1', since, valueAed: 900 }, { contractsByCustomer: byCustomer }), null)
})

test('a cancelled later contract is not a renewal', () => {
   const byCustomer = new Map([['c1', [
      { contractNo: 'NEW', status: 'cancelled', createdAt: new Date('2026-09-05'), leasedPrice: 950 },
   ]]])
   assert.equal(renewals.outcomeFor({ subjectId: 'c1', since: new Date('2026-09-01') }, { contractsByCustomer: byCustomer }), null)
})
