/**
 * Chasing a lead until they answer or they are written off.
 *
 * A lead that does not reply had nowhere to go: Contact Attempted recorded
 * that *something* was tried and nothing else — not when, not how, not what
 * came back. There was no second attempt, no third, and no point at which
 * anything said "that is enough".
 *
 * The shape here separates two things that were being conflated:
 *
 *   an attempt      what we did — a record, appended, never edited
 *   the next one    a single date, which is the followUpAt that already exists
 *
 * "Attempt 2 of 3" is counted from the first against the second. Nobody marks
 * it, so it cannot drift from what actually happened.
 *
 * Nothing here sends anything. A person logs what they did; this decides when
 * to look again and raises a task for it through the existing follow-up
 * machinery.
 */

import { FollowUpPlan } from '../models/index.js';
import { dayKeyFor } from './dailyDigest.js';

/** What a step looks like before anybody has edited the plan. */
export const DEFAULT_STEPS = [
  { label: 'First chase', afterDays: 0, channel: 'whatsapp' },
  { label: 'Second chase', afterDays: 2, channel: 'call' },
  { label: 'Last chase', afterDays: 5, channel: 'voice_note' },
];

/** Outcomes that mean the chase is over, one way or the other. */
const REACHED = 'reached';
const DEAD = new Set(['not_interested', 'wrong_number']);

/**
 * The plan, seeded on first read.
 *
 * Same self-seeding singleton as the reminder config: there is always exactly
 * one, and asking for it can never come back empty.
 */
export async function getFollowUpPlan() {
  const existing = await FollowUpPlan.findOne({ key: 'default' });
  if (existing) return existing;
  return FollowUpPlan.create({ key: 'default', steps: DEFAULT_STEPS });
}

/**
 * The step to schedule after `made` attempts, or null when the plan is spent.
 *
 * Step 1 is what you do first, so after one attempt you are looking at step 2
 * — the index is the count.
 */
export function nextStep(plan = {}, made = 0) {
  const steps = plan?.steps || [];
  return steps[made] || null;
}

/** How many steps the plan has, for "attempt 2 of 3". */
export function stepCount(plan = {}) {
  return (plan?.steps || []).length;
}

/**
 * The Dubai-local day the next attempt falls on: today plus the step's gap.
 *
 * Local days rather than raw arithmetic on the instant, so a chase logged at
 * 11pm does not schedule itself for what the server thinks is tomorrow.
 */
export function nextDateFor(plan = {}, made = 0, from = new Date()) {
  const step = nextStep(plan, made);
  if (!step) return '';
  const days = Math.max(0, Number(step.afterDays) || 0);
  const base = new Date(`${dayKeyFor(from)}T00:00:00.000Z`);
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Record an attempt and work out what happens next.
 *
 * Mutates `lead` and says what it decided; the caller saves and syncs the
 * task. Returned rather than applied here, because moving a stage is a
 * decision with its own note and its own timeline entry — this suggests, it
 * does not act.
 *
 * Returns { attempt, exhausted, suggestStatus }.
 */
export function applyOutcome(lead, plan, { channel, outcome, note = '', nextAt, userId, now = new Date() } = {}) {
  const made = (lead.attempts || []).length;
  const attempt = {
    no: made + 1,
    at: now,
    channel: channel || 'call',
    outcome,
    note: String(note || '').slice(0, 2000),
    user: userId || undefined,
  };
  lead.attempts = [...(lead.attempts || []), attempt];

  // They answered. The chase is over whatever the plan still had planned, and
  // the standing follow-up goes with it — a reminder to chase somebody you
  // have just spoken to is noise.
  if (outcome === REACHED) {
    lead.followUpAt = null;
    lead.sequenceExhaustedAt = null;
    return { attempt, exhausted: false, suggestStatus: 'contacted' };
  }

  // Not interested, or never was — no more chasing either.
  if (DEAD.has(outcome)) {
    lead.followUpAt = null;
    lead.sequenceExhaustedAt = null;
    return { attempt, exhausted: false, suggestStatus: 'lost' };
  }

  // No answer. Book the next one — the caller's date wins, because a rep who
  // knows they are away next week should be able to say so.
  const planned = nextDateFor(plan, attempt.no, now);
  const chosen = String(nextAt || '').slice(0, 10) || planned;

  if (chosen) {
    lead.followUpAt = new Date(`${chosen}T00:00:00.000Z`);
    lead.followUpKind = 'date';
    // A moved date is a new reminder, so let it fire again.
    lead.followUpNotifiedAt = null;
    lead.sequenceExhaustedAt = null;
    return { attempt, exhausted: false, suggestStatus: '' };
  }

  // The plan is spent and they never answered. Nothing is closed here: a lead
  // that went quiet for three weeks and one that was on holiday look identical
  // from this side, so somebody decides.
  lead.followUpAt = null;
  lead.sequenceExhaustedAt = now;
  return { attempt, exhausted: true, suggestStatus: '' };
}

/** What the sequence looks like right now, for the page and the list. */
export function sequenceState(lead = {}, plan = {}) {
  const made = (lead.attempts || []).length;
  const total = stepCount(plan);
  return {
    made,
    total,
    // Capped: a rep who gives it one more should not read "attempt 4 of 3".
    label: total ? `Attempt ${Math.min(made + 1, total)} of ${total}` : `Attempt ${made + 1}`,
    exhausted: Boolean(lead.sequenceExhaustedAt),
    nextChannel: nextStep(plan, made)?.channel || '',
  };
}
