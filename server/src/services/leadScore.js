/**
 * Is this lead worth a rep's time, and how much? — arithmetic on facts, the
 * same way followUpQueue.js's priority is: an AI call reads the
 * conversation once (cached — see conversationSummary.js), plain code turns
 * what it read plus the message history itself into a number, a band, and a
 * plain-English reason. The AI is never asked for a score directly; a model
 * asked "rate this 0-100" gives a different number each time it is asked
 * the same question, which is useless for anything a rep needs to trust
 * twice in a row.
 *
 * Deliberately separate from followUpQueue.js's priority score: priority
 * answers "is this overdue today", this answers "is this a real, engaged
 * prospect at all" — a lead can be overdue and not worth chasing, or worth
 * chasing hard and not overdue. Collapsing the two would make a follow-up
 * queue chase the wrong things for the right reason.
 *
 * Every weight below is a named constant with its own comment, on purpose —
 * this is a first cut, told to the person who asked for it as exactly that,
 * and meant to be read and argued with, not treated as settled.
 */

import { WhatsAppMessage } from '../models/index.js';
import { summariseConversation } from './conversationSummary.js';
import { LEAD_TYPES } from './conversationSummary.js';
import { median } from './leadFunnel.js';

/** What each conversation kind starts from, before anything else is
 *  weighed. Only storage_inquiry is scored up from here — everything else
 *  is capped low regardless (see NON_INQUIRY_CAP), because a job-seeker who
 *  replies fast and often is still not a sales lead. */
export const LEAD_TYPE_BASE = {
  storage_inquiry: 40,
  job_seeker: 0,
  price_declined: 5,
  not_our_service: 0,
  spam_or_unclear: 5,
};
export const NON_INQUIRY_CAP = 15;

/** Points for a genuine enquiry's temperature — the AI's own read. */
export const TEMPERATURE_POINTS = { hot: 30, warm: 12, cold: 0 };
/** They said a real size, date or budget, not just "how much" — a stated
 *  need is a much stronger signal than a warm tone alone. */
export const SPECIFICITY_POINTS = 15;
/** A real back-and-forth, not one message that went nowhere. 3 turns is a
 *  deliberately low bar — the point is ruling out a single "hi" that never
 *  continued, not requiring a long conversation. */
export const ENGAGEMENT_TURNS_THRESHOLD = 3;
export const ENGAGEMENT_POINTS = 15;
/** Replying within half an hour reads as someone actively on their phone
 *  right now, not someone who will get back to it eventually. */
export const FAST_REPLY_MINUTES = 30;
export const FAST_REPLY_POINTS = 10;
/** A real date, however far out, is its own signal — separate from
 *  temperature. "Not ready right now" and "not interested" read the same
 *  on tone alone; a stated date is what actually tells them apart. Within
 *  this many days counts as imminent and scores like a hot lead does; past
 *  it, it still counts as specific (folded into SPECIFICITY_POINTS below)
 *  but is not treated as urgent — a lead needing storage next month is not
 *  overdue for anything today. */
export const NEED_SOON_WINDOW_DAYS = 14;
export const NEED_SOON_POINTS = 20;

export const BAND_HIGH = 70;
export const BAND_MEDIUM = 40;

const LEAD_TYPE_LABEL = {
  job_seeker: 'asking about a job, not storage',
  price_declined: 'said our price was too high',
  not_our_service: "not something we offer, or the wrong number",
  spam_or_unclear: 'not enough said to tell',
};

/**
 * Turn count, reply speed, and how long the conversation has run — read
 * straight from the message history, free of any AI call and never stale
 * between polls the way a cached AI read can be.
 */
export function behavioralSignals(messages = []) {
  const usable = messages.filter((m) => !m.deletedAt
    && !['reaction', 'system', 'unsupported', 'ephemeral', 'sticker'].includes(m.type));

  const inboundCount = usable.filter((m) => m.direction === 'inbound').length;
  const outboundCount = usable.filter((m) => m.direction === 'outbound').length;

  let turnCount = 0;
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].direction !== usable[i - 1].direction) turnCount++;
  }

  // How long the customer took to write back, each time they did — after we
  // had actually said something for them to reply to.
  const replyGapsMin = [];
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].direction === 'inbound' && usable[i - 1].direction === 'outbound') {
      const gap = (new Date(usable[i].occurredAt).getTime() - new Date(usable[i - 1].occurredAt).getTime()) / 60000;
      if (gap >= 0) replyGapsMin.push(gap);
    }
  }
  const medianReplyMinutes = replyGapsMin.length ? median(replyGapsMin) : null;

  const spanHours = usable.length >= 2
    ? (new Date(usable[usable.length - 1].occurredAt).getTime() - new Date(usable[0].occurredAt).getTime()) / 3600000
    : 0;

  return { inboundCount, outboundCount, turnCount, medianReplyMinutes, spanHours };
}

/**
 * The score itself. Pure — every input is a plain value, nothing here reads
 * a database, so the arithmetic is checkable by reading a test.
 *
 * `override`: a rep's own correction, from Lead.leadScoreOverride. Takes
 * precedence outright rather than blending with the computed number — a
 * rep who has actually spoken to this person knows something the model
 * cannot, and averaging their judgment with a guess would just water down
 * the one signal that is actually reliable.
 */
export function scoreLead({
  leadType, temperature, wants, budget, timing,
  turnCount = 0, medianReplyMinutes = null,
  intendedStartDate = null, now = new Date(),
  override = '',
} = {}) {
  // How far out the stated need is, in whole days — negative or 0 means
  // today or already past, which reads the same as "needs it now".
  const daysUntilNeeded = intendedStartDate
    ? Math.round((new Date(intendedStartDate).getTime() - new Date(now).getTime()) / 864e5)
    : null;
  const dateSignals = { intendedStartDate: intendedStartDate ? new Date(intendedStartDate).toISOString() : null, daysUntilNeeded };

  if (override === 'not_interested') {
    return { score: 0, band: 'low', reason: 'Marked not interested by a rep.', signals: { leadType, override, ...dateSignals } };
  }
  if (override === 'qualifying') {
    return { score: 90, band: 'high', reason: 'Confirmed qualifying by a rep.', signals: { leadType, override, ...dateSignals } };
  }

  const type = LEAD_TYPES.has(leadType) ? leadType : 'storage_inquiry';
  let score = LEAD_TYPE_BASE[type] ?? LEAD_TYPE_BASE.storage_inquiry;
  const reasons = [];
  const signals = { leadType: type, ...dateSignals };

  if (type !== 'storage_inquiry') {
    score = Math.min(score, NON_INQUIRY_CAP);
    reasons.push(LEAD_TYPE_LABEL[type] || 'not a storage enquiry');
  } else {
    const tempPoints = TEMPERATURE_POINTS[temperature] ?? 0;
    score += tempPoints;
    if (temperature === 'hot') reasons.push('hot');
    signals.temperature = temperature || null;

    // A stated date is specific whether or not the free-text budget/timing/
    // wants fields also caught it — a rep can set this from a phone call
    // the AI never read.
    const hasDate = daysUntilNeeded !== null;
    const specific = hasDate || Boolean(budget) || Boolean(timing) || (String(wants || '').trim().length > 15);
    signals.specific = specific;
    if (specific) { score += SPECIFICITY_POINTS; reasons.push('gave specifics'); }

    if (hasDate) {
      if (daysUntilNeeded <= NEED_SOON_WINDOW_DAYS) {
        score += NEED_SOON_POINTS;
        reasons.push(daysUntilNeeded <= 0 ? 'needs it now' : `needs it within ${daysUntilNeeded} day${daysUntilNeeded === 1 ? '' : 's'}`);
      } else {
        // Not urgent, and deliberately not scored as if it were — but said
        // plainly, so "not ready right now" is never misread as "not
        // interested" the way a bare cold temperature alone would be.
        reasons.push(`needs it from ${new Date(intendedStartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
      }
    }

    signals.turnCount = turnCount;
    if (turnCount >= ENGAGEMENT_TURNS_THRESHOLD) {
      score += ENGAGEMENT_POINTS;
      reasons.push(`${turnCount} messages back and forth`);
    }

    signals.medianReplyMinutes = medianReplyMinutes;
    if (medianReplyMinutes != null && medianReplyMinutes <= FAST_REPLY_MINUTES) {
      score += FAST_REPLY_POINTS;
      reasons.push('replies quickly');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= BAND_HIGH ? 'high' : score >= BAND_MEDIUM ? 'medium' : 'low';
  return {
    score,
    band,
    reason: reasons.length ? reasons.join(' · ') : 'Not enough said yet to tell',
    signals,
  };
}

/**
 * Whether a rep should be asked to confirm or correct this score.
 *
 * Only once they have actually replied at least once — asking before that
 * is asking about a conversation they have not had yet — and never on a
 * lead already scored low, since confirming "yes, this is a dead lead" is
 * not a use of anyone's time. Never repeated once a rep has answered, for
 * this AI read: see scoreForLead()'s own staleness rule for when it comes
 * back.
 */
export function needsConfirmation({ band, override, outboundCount = 0 }) {
  if (override) return false;
  if (band === 'low') return false;
  return outboundCount >= 1;
}

/**
 * Everything for one lead: reads the cached AI summary (never generates one
 * here — that cost belongs to whoever is already asking for the summary,
 * not to every place that wants a score), the message history for the
 * behavioural signals, and the lead's own override, and returns the full
 * picture a panel needs.
 */
export async function scoreForLead(lead) {
  const summary = await summariseConversation(lead.phoneNormalized);
  if (!summary?.configured) {
    return { score: null, band: null, reason: 'AI is not configured — add a key in Settings → Integrations.', signals: {}, needsConfirmation: false, aiSummary: null };
  }
  if (summary.empty || summary.error) {
    return { score: null, band: null, reason: summary.error || 'Nothing has been said in this chat yet.', signals: {}, needsConfirmation: false, aiSummary: null };
  }

  const messages = await WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized })
    .select('direction type occurredAt deletedAt').sort({ occurredAt: 1 }).lean();
  const behavior = behavioralSignals(messages);

  // A confirmation only still counts if it was made against this same read
  // of the conversation — leadScoreOverrideForLeadType records which. A
  // conversation that has since moved on (a new message changed what the
  // AI now reads as the leadType) needs a fresh look, not a stale yes.
  const overrideStillValid = lead.leadScoreOverride && lead.leadScoreOverrideForLeadType === summary.leadType;
  const override = overrideStillValid ? lead.leadScoreOverride : '';

  const result = scoreLead({
    leadType: summary.leadType, temperature: summary.temperature,
    wants: summary.wants, budget: summary.budget, timing: summary.timing,
    turnCount: behavior.turnCount, medianReplyMinutes: behavior.medianReplyMinutes,
    intendedStartDate: lead.intendedStartDate || null,
    override,
  });

  return {
    ...result,
    needsConfirmation: needsConfirmation({ band: result.band, override, outboundCount: behavior.outboundCount }),
    staleOverride: Boolean(lead.leadScoreOverride) && !overrideStillValid,
    aiSummary: summary,
    behavior,
  };
}
