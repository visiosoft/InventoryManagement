/**
 * Ask a question of the whole WhatsApp inbox.
 *
 * "What did we miss?", "who is hot?", "who mentioned parking?" — questions
 * about the inbox as a whole rather than about the chat you happen to have
 * open, which you can only ask once you already know which chat to open.
 *
 * Two things make this affordable and honest:
 *
 * 1. Most of these are database questions, not language ones. "Nobody replied
 *    to them" is a fact about the newest message in a thread — exact, instant
 *    and free. `readQuestion` recognises the common phrasings locally and never
 *    calls a model for them.
 * 2. Where a model is needed, it only chooses an intent from a fixed list and
 *    fills in parameters. It never decides who is hot and it never writes the
 *    query — the same rule `parseAvailabilityQuery` follows.
 *
 * The pure parts are exported so the routing of a question can be tested
 * without a database or an API key.
 */

import { WhatsAppMessage, ConversationSummary, Customer, Lead } from '../models/index.js';
import { openaiConfigured, chatJson } from './openai.js';

/** Every question this can answer. A model may only pick from these. */
export const INTENTS = ['unanswered', 'quiet', 'hot', 'mentions', 'about'];

export const DEFAULT_QUIET_DAYS = 3;
const MAX_QUIET_DAYS = 120;
const RESULT_LIMIT = 40;

const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const suffix = (v) => {
  const d = digitsOf(v);
  return d.length >= 9 ? d.slice(-9) : '';
};

/**
 * Recognise the common questions without a model.
 *
 * Deterministic, instant, and works with no API key — the same approach the
 * Search Units phrase box takes. Returns null when it does not recognise the
 * question, which is the signal to ask a model rather than to guess.
 */
export function readQuestion(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return null;

  const window = text.match(/(\d{1,3})\s*(day|week|month)/);

  // A named period makes a question about staleness rather than about who is
  // owed an answer — "no reply in 10 days" is asking which threads went cold,
  // not which are unreplied right now. So the window is checked first.
  const quietWords = /\b(quiet|gone cold|went cold|cold|stale|follow ?up|chase|heard nothing)\b/.test(text);
  const silenceForAWhile = Boolean(window) && /\b(no (reply|response|answer)|nothing|silent|silence)\b/.test(text);

  if (quietWords || silenceForAWhile) {
    let days = DEFAULT_QUIET_DAYS;
    if (window) {
      const n = Number(window[1]);
      days = window[2] === 'week' ? n * 7 : window[2] === 'month' ? n * 30 : n;
    }
    return { intent: 'quiet', params: { days: Math.min(Math.max(1, days), MAX_QUIET_DAYS) } };
  }

  // "what did we miss", "who is waiting", "unanswered", "nobody replied"
  if (/\b(miss(ed|ing)?|unanswered|unreplied|waiting|(nobody|no ?one|no-one)\s+(has\s+)?(repl|answer|respond)|no repl|not repl|never repl|need(s|ing)? (a )?repl|pending)/.test(text)) {
    return { intent: 'unanswered', params: {} };
  }

  // "hot leads", "who is ready to book", "most interested"
  if (/\b(hot|hottest|ready to (book|rent|sign)|most interested|best lead|serious)\b/.test(text)) {
    return { intent: 'hot', params: {} };
  }

  // "who mentioned parking", "anyone asking about insurance"
  const mention = text.match(/\b(?:mention(?:ed|ing)?|asked? about|asking about|talked about|said)\s+(.{2,60})$/);
  if (mention) {
    return { intent: 'mentions', params: { text: mention[1].replace(/[?.!]+$/, '').trim() } };
  }

  return null;
}

const SYSTEM = [
  'You route a question about a WhatsApp inbox to one of a fixed set of queries.',
  'Reply with JSON only, no prose.',
  `Shape: {"intent":${INTENTS.map((i) => `"${i}"`).join('|')},"text":string|null,"days":number|null,"unreadable":string|null}`,
  'unanswered = threads where the customer wrote last and nobody replied.',
  'quiet = threads with no message for a number of days; put the number in "days".',
  'hot = leads who seem ready to book.',
  'mentions = threads where someone mentioned a topic; put the topic in "text".',
  'about = questions about one named person or number; put the name or number in "text".',
  'If the question fits none of these, still choose the closest and say why in "unreadable".',
].join('\n');

/**
 * Validate a model's routing before it reaches a query.
 *
 * An intent outside the list, or a nonsense day count, must not become a
 * query — so anything invalid comes back as null and the caller says it could
 * not read the question.
 */
export function parseAsk(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!INTENTS.includes(raw.intent)) return null;

  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 80) : '';
  // These two intents are meaningless without something to look for.
  if ((raw.intent === 'mentions' || raw.intent === 'about') && !text) return null;

  const n = Number(raw.days);
  const days = Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), MAX_QUIET_DAYS) : DEFAULT_QUIET_DAYS;

  return {
    intent: raw.intent,
    params: { text, days },
    unreadable: typeof raw.unreadable === 'string' && raw.unreadable ? raw.unreadable.slice(0, 200) : null,
  };
}

/** The newest message on every thread, which is what most of these ask about. */
async function newestPerThread() {
  return WhatsAppMessage.aggregate([
    { $match: { deletedAt: null } },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$phoneNormalized',
        lastAt: { $max: '$occurredAt' },
        lastDirection: { $first: '$direction' },
        lastText: { $first: '$text' },
        lastType: { $first: '$type' },
        phone: { $first: '$phone' },
        count: { $sum: 1 },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: 400 },
  ]);
}

/**
 * A real name where we hold one, otherwise the number.
 *
 * Matched on the last nine digits because numbers are stored inconsistently,
 * the same rule the conversations list and the Zoho matcher both use.
 */
async function resolveNames(phones) {
  const [customers, leads] = await Promise.all([
    Customer.find({}).select('fullName phone phones').lean(),
    Lead.find({ phoneNormalized: { $in: phones } }).select('fullName phoneNormalized status').lean(),
  ]);

  const byPhone = new Map();
  for (const c of customers) {
    for (const p of [...(c.phones || []), c.phone]) {
      const k = suffix(p);
      if (k && !byPhone.has(k)) byPhone.set(k, c);
    }
  }
  const byLead = new Map(leads.map((l) => [l.phoneNormalized, l]));
  const isPlaceholder = (n) => !n || /^whatsapp\s*contact/i.test(String(n).trim());

  return (phoneNormalized, phone) => {
    const customer = byPhone.get(suffix(phoneNormalized));
    const lead = byLead.get(phoneNormalized);
    const leadName = isPlaceholder(lead?.fullName) ? '' : lead.fullName;
    return {
      displayName: customer?.fullName || leadName || phone || phoneNormalized,
      isCustomer: Boolean(customer),
      leadStatus: lead?.status || '',
    };
  };
}

const daysAgo = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
const snippet = (t, n = 120) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Run one routed question. Returns rows the inbox can list. */
export async function runAsk({ intent, params = {} }) {
  const threads = await newestPerThread();
  const nameOf = await resolveNames(threads.map((t) => t._id));

  const row = (t, reason) => {
    const { displayName, isCustomer, leadStatus } = nameOf(t._id, t.phone);
    return {
      phoneNormalized: t._id,
      displayName,
      isCustomer,
      leadStatus,
      lastAt: t.lastAt,
      lastDirection: t.lastDirection,
      preview: snippet(t.lastText),
      reason,
    };
  };

  if (intent === 'unanswered') {
    const rows = threads
      .filter((t) => t.lastDirection === 'inbound')
      .map((t) => {
        const d = daysAgo(t.lastAt);
        return row(t, d === 0 ? 'They wrote last, today' : `They wrote last, ${d} day${d === 1 ? '' : 's'} ago`);
      });
    return { intent, rows: rows.slice(0, RESULT_LIMIT), total: rows.length, source: 'query' };
  }

  if (intent === 'quiet') {
    const days = params.days || DEFAULT_QUIET_DAYS;
    const rows = threads
      .filter((t) => daysAgo(t.lastAt) >= days)
      .map((t) => row(t, `Nothing said for ${daysAgo(t.lastAt)} days`));
    return { intent, rows: rows.slice(0, RESULT_LIMIT), total: rows.length, days, source: 'query' };
  }

  if (intent === 'mentions' || intent === 'about') {
    const needle = String(params.text || '').trim();
    if (!needle) return { intent, rows: [], total: 0, source: 'query' };

    if (intent === 'about') {
      // A name or a number. Numbers are matched on their last nine digits.
      const asDigits = suffix(needle);
      const matches = threads.filter((t) => {
        if (asDigits && suffix(t._id) === asDigits) return true;
        return nameOf(t._id, t.phone).displayName.toLowerCase().includes(needle.toLowerCase());
      });
      return { intent, rows: matches.map((t) => row(t, 'Matches that name or number')).slice(0, RESULT_LIMIT), total: matches.length, needle, source: 'query' };
    }

    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hits = await WhatsAppMessage.find({ deletedAt: null, text: { $regex: escaped, $options: 'i' } })
      .sort({ occurredAt: -1 })
      .select('phoneNormalized text occurredAt')
      .limit(300)
      .lean();

    const seen = new Map();
    for (const h of hits) if (!seen.has(h.phoneNormalized)) seen.set(h.phoneNormalized, h);
    const byPhone = new Map(threads.map((t) => [t._id, t]));
    const rows = [...seen.entries()]
      .filter(([p]) => byPhone.has(p))
      .map(([p, hit]) => row(byPhone.get(p), `Said “${snippet(hit.text, 80)}”`));
    return { intent, rows: rows.slice(0, RESULT_LIMIT), total: rows.length, needle, source: 'query' };
  }

  if (intent === 'hot') {
    // Answered from summaries already made, never by summarising the whole
    // inbox on a whim — that would be hundreds of API calls behind one click.
    // The count of unread threads is returned so the answer is visibly partial
    // rather than quietly so.
    const summaries = await ConversationSummary.find({}).lean();
    const bySummary = new Map(summaries.map((s) => [s.phoneNormalized, s]));

    const rows = threads
      .map((t) => ({ t, s: bySummary.get(t._id) }))
      .filter(({ s }) => s?.summary?.temperature === 'hot')
      .map(({ t, s }) => row(t, s.summary.reason || s.summary.headline));

    return {
      intent,
      rows: rows.slice(0, RESULT_LIMIT),
      total: rows.length,
      // How much of the inbox this answer did not look at.
      unread: threads.filter((t) => !bySummary.has(t._id)).length,
      source: 'summaries',
    };
  }

  return { intent, rows: [], total: 0, source: 'query' };
}

/**
 * Route a question, locally where possible, and answer it.
 *
 * `usedModel` says whether this question cost anything, because a question
 * answered from the database should be visibly free.
 */
export async function askInbox(question) {
  const local = readQuestion(question);
  if (local) return { ...(await runAsk(local)), question, usedModel: false };

  if (!openaiConfigured()) {
    return { question, usedModel: false, rows: [], total: 0, unreadable: 'I could not read that question, and OpenAI is not configured to help.' };
  }

  const raw = await chatJson({
    system: SYSTEM,
    messages: [{ role: 'user', content: String(question || '').slice(0, 300) }],
    maxTokens: 150,
  });

  const routed = parseAsk(raw);
  if (!routed) return { question, usedModel: true, rows: [], total: 0, unreadable: 'I could not turn that into a question I know how to answer.' };

  const out = await runAsk(routed);
  return { ...out, question, usedModel: true, unreadable: routed.unreadable };
}
