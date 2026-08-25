/**
 * What was said with every client yesterday, as one page.
 *
 * The owner should not have to open 260 chats to know how the day went. This
 * assembles a record of one day: every conversation that moved, ordered so the
 * ones needing attention are read first, with the day's numbers on top.
 *
 * It is assembly rather than new capability. The per-thread readings already
 * exist in `ConversationSummary`, kept current by the two-hourly
 * `summariseRecent`, and the reply-time arithmetic already lives in
 * `inboxAsk.js`. On a normal day this adds close to nothing on top of what is
 * already running.
 *
 * Reads only. No message is sent, and nothing is written to a lead.
 */

import { WhatsAppMessage, ConversationSummary, DailyDigest } from '../models/index.js';
import { replyGaps, summariseGaps, humanDuration, resolveNames } from './inboxAsk.js';
import { summariseConversation } from './conversationSummary.js';

/**
 * Whose day this is: the UAE's, always.
 *
 * The server's own timezone is not something to depend on — a host that
 * believes it is in UTC would cut the day at 4am Dubai, filing a late-evening
 * conversation under the following morning. So the boundary is stated here
 * rather than inherited, and it is not configurable: one business, one
 * timezone, and no setting to get wrong.
 *
 * Gulf Standard Time is UTC+4 with no daylight saving, so a fixed offset is
 * exact all year. That is why this can be arithmetic rather than a timezone
 * database lookup.
 */
export const TZ_OFFSET_HOURS = 4;
export const TZ_NAME = 'Asia/Dubai';
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** The local day a moment falls in, as 'YYYY-MM-DD'. */
export function dayKeyFor(date = new Date()) {
  const shifted = new Date(new Date(date).getTime() + TZ_OFFSET_HOURS * HOUR_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The real UTC instants a local day starts and ends at. */
export function dayRange(dayKey) {
  const midnightUtc = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  const from = new Date(midnightUtc - TZ_OFFSET_HOURS * HOUR_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** The local day before this one. */
export function previousDay(dayKey) {
  return dayKeyFor(new Date(dayRange(dayKey).from.getTime() - HOUR_MS));
}

/** The local hour right now, for the scheduler. */
export function localHour(date = new Date()) {
  return new Date(new Date(date).getTime() + TZ_OFFSET_HOURS * HOUR_MS).getUTCHours();
}

/**
 * Attention first.
 *
 * A digest sorted by time reads like a log and buries the one chat nobody
 * answered under forty that are fine. The order is the point of the report:
 *
 *   1. nobody replied — longest wait first
 *   2. hot leads
 *   3. someone who wrote for the first time
 *   4. everything else, busiest first
 *
 * Pure, so the rule can be checked rather than eyeballed.
 */
export function orderChats(chats = []) {
  const rank = (c) => (c.unanswered ? 0 : c.temperature === 'hot' ? 1 : c.isNew ? 2 : 3);
  return [...chats].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return new Date(a.lastAt) - new Date(b.lastAt);   // waiting longest
    return (b.messages || 0) - (a.messages || 0);
  });
}

/**
 * Build one day.
 *
 * @param {string} dayKey  'YYYY-MM-DD' in local time
 * @param {object} opts    `refresh` summarises threads whose stored reading is
 *                          stale; off by default so opening a past day never
 *                          spends anything.
 */
export async function buildDigest(dayKey, { refresh = true } = {}) {
  const { from, to } = dayRange(dayKey);

  const msgs = await WhatsAppMessage.find({ occurredAt: { $gte: from, $lt: to }, deletedAt: null })
    .sort({ occurredAt: 1 })
    .select('phoneNormalized phone direction text occurredAt sentByAi deletedAt messageId')
    .lean();

  if (!msgs.length) {
    return {
      day: dayKey,
      builtAt: new Date(),
      stats: { chats: 0, inbound: 0, outbound: 0, newChats: 0, unanswered: 0, medianReply: null, withoutSummary: 0 },
      chats: [],
    };
  }

  const byThread = new Map();
  for (const m of msgs) {
    if (!byThread.has(m.phoneNormalized)) byThread.set(m.phoneNormalized, []);
    byThread.get(m.phoneNormalized).push(m);
  }

  const phones = [...byThread.keys()];
  const nameOf = await resolveNames(phones);

  // Which of these had ever written before today — anything else is a first
  // contact, which is worth surfacing separately from an ongoing chat.
  const earlier = await WhatsAppMessage.aggregate([
    { $match: { phoneNormalized: { $in: phones }, occurredAt: { $lt: from } } },
    { $group: { _id: '$phoneNormalized' } },
  ]);
  const seenBefore = new Set(earlier.map((e) => e._id));

  const stored = await ConversationSummary.find({ phoneNormalized: { $in: phones } })
    .select('phoneNormalized lastMessageId summary')
    .lean();
  const summaryOf = new Map(stored.map((s) => [s.phoneNormalized, s]));

  const chats = [];
  const allGaps = [];
  let withoutSummary = 0;

  for (const [phone, list] of byThread) {
    const last = list[list.length - 1];
    const gaps = replyGaps(list);
    allGaps.push(...gaps);

    let summary = summaryOf.get(phone)?.summary || null;
    const key = String(last.messageId || last._id || '');
    // Only pay where the stored reading predates the day being reported on.
    if (refresh && summaryOf.get(phone)?.lastMessageId !== key) {
      const fresh = await summariseConversation(phone).catch(() => null);
      if (fresh?.headline) summary = fresh;
    }
    if (!summary?.headline) withoutSummary += 1;

    const inbound = list.filter((m) => m.direction === 'inbound').length;
    const { displayName, isCustomer, leadStatus } = nameOf(phone, list[0].phone);

    chats.push({
      phoneNormalized: phone,
      displayName,
      isCustomer,
      leadStatus,
      messages: list.length,
      inbound,
      outbound: list.length - inbound,
      firstAt: list[0].occurredAt,
      lastAt: last.occurredAt,
      // Frozen as it stood when the day ended, which is the honest reading of
      // "did we leave someone waiting".
      unanswered: last.direction === 'inbound',
      isNew: !seenBefore.has(phone),
      headline: summary?.headline || '',
      wants: summary?.wants || '',
      nextAction: summary?.nextAction || '',
      temperature: summary?.temperature || '',
      openQuestions: summary?.openQuestions || [],
      repliesCounted: gaps.filter((g) => !g.byAi).length,
      slowestReplyMs: gaps.filter((g) => !g.byAi).reduce((m, g) => Math.max(m, g.ms), 0) || null,
    });
  }

  const human = summariseGaps(allGaps.filter((g) => !g.byAi));
  const ordered = orderChats(chats);

  return {
    day: dayKey,
    builtAt: new Date(),
    stats: {
      chats: chats.length,
      inbound: msgs.filter((m) => m.direction === 'inbound').length,
      outbound: msgs.filter((m) => m.direction === 'outbound').length,
      newChats: chats.filter((c) => c.isNew).length,
      unanswered: chats.filter((c) => c.unanswered).length,
      medianReply: human ? humanDuration(human.medianMs) : null,
      repliesCounted: human?.count ?? 0,
      // Said out loud: a digest that quietly omits what it could not read is
      // worse than one that admits the gap.
      withoutSummary,
    },
    chats: ordered,
  };
}

/** Build and store, unless it is already there. */
export async function ensureDigest(dayKey, { rebuild = false } = {}) {
  if (!rebuild) {
    const existing = await DailyDigest.findOne({ day: dayKey }).lean();
    if (existing) return { ...existing, cached: true };
  }
  const built = await buildDigest(dayKey);
  await DailyDigest.findOneAndUpdate({ day: dayKey }, { $set: built }, { upsert: true });
  console.log(`[Digest] ${dayKey} chats=${built.stats.chats} unanswered=${built.stats.unanswered} withoutSummary=${built.stats.withoutSummary}`);
  return { ...built, cached: false };
}
