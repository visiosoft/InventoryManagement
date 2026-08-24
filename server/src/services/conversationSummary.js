/**
 * Read a WhatsApp thread and say what it is about.
 *
 * A rep opening a forty-message conversation has to read all of it before they
 * can say anything useful. This produces the short version: what they want,
 * what it would cost them, when they need it, and the obvious next thing to do.
 *
 * It only summarises. Nothing here writes to a Lead, sends a message, or
 * decides anything — the read is shown to a person who then acts. The lead
 * temperature is stored on the summary rather than on the Lead itself, so a
 * model's opinion never becomes a business record that other code reads.
 *
 * The pure parts — `buildTranscript` and `parseSummary` — carry the rules and
 * are exported so they can be tested without a database or an API key.
 */

import { WhatsAppMessage, ConversationSummary } from '../models/index.js';
import { openaiConfigured, openaiModel, chatJson } from './openai.js';

/** Enough thread to be fair to the conversation, capped so cost is bounded. */
export const MAX_TURNS = 120;
const MAX_CHARS_PER_TURN = 400;

const TEMPERATURES = new Set(['hot', 'warm', 'cold']);

/** Media and system rows carry no text worth summarising. */
const SKIPPED_TYPES = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'sticker']);

/**
 * Format a thread for the model.
 *
 * Oldest first, because a conversation read backwards changes meaning. Deleted
 * messages are dropped — summarising something the sender withdrew would put
 * it back in front of a colleague.
 */
export function buildTranscript(messages = []) {
  const usable = messages
    .filter((m) => !m.deletedAt)
    .filter((m) => !SKIPPED_TYPES.has(m.type))
    .filter((m) => String(m.text || '').trim());

  const recent = usable.slice(-MAX_TURNS);

  return recent
    .map((m) => {
      const who = m.direction === 'inbound' ? 'Customer' : m.sentByAi ? 'Assistant' : 'Us';
      const day = m.occurredAt ? new Date(m.occurredAt).toISOString().slice(0, 10) : '';
      const text = String(m.text).trim().replace(/\s+/g, ' ').slice(0, MAX_CHARS_PER_TURN);
      return `[${day}] ${who}: ${text}`;
    })
    .join('\n');
}

const SYSTEM = [
  'You summarise a WhatsApp conversation between a Dubai self-storage and moving company and a customer.',
  'Reply with JSON only, no prose.',
  'Shape: {"headline":string,"wants":string,"budget":string|null,"timing":string|null,"nextAction":string,"temperature":"hot"|"warm"|"cold","reason":string,"openQuestions":string[]}',
  '"headline" is one short sentence a colleague could read at a glance.',
  '"wants" is what the customer is asking for, in their terms.',
  '"budget" and "timing" are null unless the customer actually said them. Never estimate either.',
  '"nextAction" is the single most useful thing for us to do next.',
  '"temperature": hot if they are ready to book, warm if interested but undecided, cold if browsing or gone quiet.',
  '"reason" is one short sentence saying why you chose that temperature.',
  '"openQuestions" are things the customer asked that nobody has answered yet. Empty array if none.',
  'Base everything only on what is in the transcript. Do not invent details, prices or dates.',
].join('\n');

function str(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Validate the model's reading before anyone sees it.
 *
 * Returns null when the output is unusable, which callers must treat as "could
 * not summarise" — never as an empty conversation.
 */
export function parseSummary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const headline = str(raw.headline, 200);
  const nextAction = str(raw.nextAction, 200);
  // Without these two the summary is not worth showing; a card that says
  // nothing still costs a colleague the time it takes to read it.
  if (!headline || !nextAction) return null;

  const temperature = TEMPERATURES.has(raw.temperature) ? raw.temperature : 'warm';

  const openQuestions = Array.isArray(raw.openQuestions)
    ? raw.openQuestions.map((q) => str(q, 200)).filter(Boolean).slice(0, 5)
    : [];

  // Budget and timing are the two the model is most tempted to invent, so an
  // empty string becomes null rather than being shown as a known blank.
  const budget = str(raw.budget, 120) || null;
  const timing = str(raw.timing, 120) || null;

  return {
    headline,
    wants: str(raw.wants, 400),
    budget,
    timing,
    nextAction,
    temperature,
    reason: str(raw.reason, 200),
    openQuestions,
  };
}

/** Only threads that moved in this window are worth spending on. */
export const RECENT_DAYS = 2;
/** A hard ceiling per run, so a busy day cannot turn into a large bill. */
export const BATCH_LIMIT = 60;

/**
 * Summarise every thread that has moved recently and is not already current.
 *
 * Bounded twice over: only conversations with a message in the last couple of
 * days, and never more than BATCH_LIMIT of them in one run. A quiet thread from
 * three weeks ago is not worth paying to read, and nothing here re-reads a
 * conversation that has not changed since it was last summarised.
 *
 * Reads and stores. Sends nothing, and writes nothing to a Lead.
 */
export async function summariseRecent({ days = RECENT_DAYS, limit = BATCH_LIMIT } = {}) {
  if (!openaiConfigured()) return { configured: false };

  const since = new Date(Date.now() - days * 86400000);

  // Newest message per thread, most recently active first.
  const threads = await WhatsAppMessage.aggregate([
    { $match: { occurredAt: { $gte: since }, deletedAt: null } },
    { $group: { _id: '$phoneNormalized', lastAt: { $max: '$occurredAt' } } },
    { $sort: { lastAt: -1 } },
  ]);

  const existing = await ConversationSummary.find({ phoneNormalized: { $in: threads.map((t) => t._id) } })
    .select('phoneNormalized lastMessageId')
    .lean();
  const byPhone = new Map(existing.map((s) => [s.phoneNormalized, s]));

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of threads) {
    if (generated >= limit) break;

    // summariseConversation checks the cache key itself; this is only a cheap
    // pre-filter so an unchanged thread costs no query at all.
    const newest = await WhatsAppMessage.findOne({ phoneNormalized: t._id, deletedAt: null })
      .sort({ occurredAt: -1 })
      .select('messageId')
      .lean();
    const key = String(newest?.messageId || newest?._id || '');
    if (byPhone.get(t._id)?.lastMessageId === key) { skipped += 1; continue; }

    try {
      const out = await summariseConversation(t._id);
      if (out?.headline) generated += 1;
      else failed += 1;
    } catch {
      // One unreadable thread must not stop the batch.
      failed += 1;
    }
  }

  const result = { configured: true, considered: threads.length, generated, skipped, failed, days, limit };
  console.log(`[Summaries] window=${days}d considered=${threads.length} generated=${generated} skipped=${skipped} failed=${failed}`);
  return result;
}

/**
 * Summarise a thread, reusing the stored one when nothing has been said since.
 *
 * Keyed on the newest message id: reopening a chat that has not moved costs
 * nothing, which matters because a rep clicking through their inbox would
 * otherwise pay for the same summary repeatedly.
 */
export async function summariseConversation(phoneNormalized, { force = false } = {}) {
  if (!openaiConfigured()) return { configured: false };

  const messages = await WhatsAppMessage.find({ phoneNormalized })
    .sort({ occurredAt: 1 })
    .select('direction type text occurredAt sentByAi deletedAt messageId')
    .lean();

  const transcript = buildTranscript(messages);
  if (!transcript) return { configured: true, empty: true };

  const newest = messages[messages.length - 1];
  const cacheKey = String(newest?.messageId || newest?._id || '');

  const cached = await ConversationSummary.findOne({ phoneNormalized }).lean();
  if (!force && cached?.lastMessageId === cacheKey && cached.summary?.headline) {
    return { configured: true, cached: true, ...cached.summary, generatedAt: cached.generatedAt, model: cached.model };
  }

  const raw = await chatJson({
    system: SYSTEM,
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 600,
  });

  const summary = parseSummary(raw);
  if (!summary) return { configured: true, error: 'The model did not return a usable summary' };

  const generatedAt = new Date();
  await ConversationSummary.findOneAndUpdate(
    { phoneNormalized },
    { $set: { lastMessageId: cacheKey, summary, model: openaiModel(), generatedAt } },
    { upsert: true },
  );

  return { configured: true, cached: false, ...summary, generatedAt, model: openaiModel() };
}
