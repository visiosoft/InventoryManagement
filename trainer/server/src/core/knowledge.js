import { normalize, asData, DATA_RULE } from './text.js';

/**
 * Approved knowledge: rendering, retrieval, conflicts, publishing. Pure.
 *
 * An approved answer is a controlled asset, not a line pasted into a prompt.
 * It has a version, a status and an owner; it reaches an agent only through a
 * published snapshot; and it sits below live business data in authority, so a
 * price written into an answer last month can never outrank today's price.
 */

export const STATUSES = ['draft', 'approved', 'published', 'superseded', 'archived'];

/** The order in which sources win when they disagree. Shown to agents and reviewers. */
export const AUTHORITY = [
   'Legal and safety constraints',
   'Current business rules and policies',
   'Verified live data (prices, availability, accounts) from the business system',
   'Published knowledge (approved answers)',
   'Agent behaviour instructions',
   'Historical conversation examples',
];

/* ---------- variables ---------- */

const VAR = /\{([a-z][a-z0-9_]*)\}/gi;

/** Every {variable} an answer uses. Pure. */
export const variablesIn = (text) => [...new Set([...String(text ?? '').matchAll(VAR)].map((m) => m[1].toLowerCase()))];

/**
 * An answer with its {variables} filled from live values. A variable with no
 * value is left visible and listed as missing — a gap a person can see is
 * better than a blank in front of a customer. Pure.
 */
export function render(text, values = {}) {
   const missing = [];
   const out = String(text ?? '').replace(VAR, (m, name) => {
      const v = values[name.toLowerCase()];
      if (v == null || v === '') { missing.push(name.toLowerCase()); return m; }
      return String(v);
   });
   return { text: out, missing: [...new Set(missing)] };
}

/* ---------- retrieval ---------- */

const STOP = new Set('a an the is are am i you we to of for in on at do does can could would will my your our me it its this that what how much many and or with be have has any please there here about from as by'.split(' '));
const tokens = (s) => normalize(s).split(' ').filter((w) => w && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));

/**
 * How well a record matches a customer's message: the best token overlap with
 * its question or any variation, weighted toward covering the record's words.
 * 0–1. Pure, cheap, and good enough to pick a handful of candidates for the
 * model to judge — it never answers by itself.
 */
export function matchScore(message, record) {
   const m = new Set(tokens(message));
   if (!m.size) return 0;
   let best = 0;
   for (const q of [record.question, ...(record.variations || [])]) {
      const t = [...new Set(tokens(q))];
      if (!t.length) continue;
      const hit = t.filter((w) => m.has(w)).length;
      best = Math.max(best, hit / t.length * 0.7 + hit / m.size * 0.3);
   }
   return Math.round(best * 1000) / 1000;
}

/** The records worth showing an agent for this message, best first. Pure. */
export function retrieve(message, records, { limit = 3, min = 0.34 } = {}) {
   return records
      .map((r) => ({ r, score: matchScore(message, r) }))
      .filter((x) => x.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
}

/**
 * The block an agent's prompt carries for one customer message: the matching
 * approved answers with live values filled in, the authority order, and the
 * intents that must go to a person. Empty when nothing matches. Pure.
 */
export function knowledgeBlock(message, records, values = {}, opts) {
   const hits = retrieve(message, records.filter((r) => !r.escalate), opts);
   const escalations = retrieve(message, records.filter((r) => r.escalate), { ...opts, limit: 2 });
   if (!hits.length && !escalations.length) return { text: '', used: [] };
   const lines = [
      'APPROVED ANSWERS — written and approved by the business for situations like this one. Use their content and approach, in your own words for this customer.',
      `If anything in them disagrees with live data or your tools, the live data wins (authority, highest first: ${AUTHORITY.join(' > ')}). Never quote a figure from here that a tool contradicts.`,
   ];
   for (const { r } of hits) {
      const { text } = render(r.answer, values);
      lines.push(`- When asked: "${r.question}"\n  Approved answer: ${text}${r.followUp ? `\n  Then: ${r.followUp}` : ''}`);
   }
   for (const { r } of escalations) lines.push(`- "${r.question}" must go to a person: set needsHuman true${r.escalationNote ? ` (${r.escalationNote})` : ''}.`);
   return { text: lines.join('\n'), used: [...hits, ...escalations].map(({ r, score }) => ({ id: String(r._id ?? r.id), version: r.version, score })) };
}

/* ---------- conflicts ---------- */

const numbersIn = (s) => (String(s ?? '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));

/**
 * Approved records that may contradict each other: two current answers for
 * the same intent, or two answers to near-identical questions stating
 * different figures. Deterministic, so it runs on every publish; a model can
 * look harder on request. Pure.
 */
export function findConflicts(records) {
   const live = records.filter((r) => ['approved', 'published'].includes(r.status) && !r.escalate);
   const out = [];
   for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
         const a = live[i]; const b = live[j];
         if (a.intent && a.intent === b.intent && !a.allowMultiple && !b.allowMultiple) {
            out.push({ a: a.id ?? String(a._id), b: b.id ?? String(b._id), kind: 'same_intent', note: `Two approved answers for "${a.intent}"` });
            continue;
         }
         const similar = Math.max(matchScore(a.question, b), matchScore(b.question, a));
         const na = new Set(numbersIn(render(a.answer).text)); const nb = new Set(numbersIn(render(b.answer).text));
         const differ = na.size && nb.size && ![...na].some((n) => nb.has(n));
         if (similar >= 0.75 && differ) out.push({ a: a.id ?? String(a._id), b: b.id ?? String(b._id), kind: 'different_figures', note: `Similar questions, different figures: "${a.question}" / "${b.question}"` });
      }
   }
   return out;
}

/* ---------- publishing ---------- */

/** A snapshot of what is approved now: the exact text and version of each record. Pure. */
export function buildSnapshot(records, version) {
   const items = records
      .filter((r) => ['approved', 'published'].includes(r.status))
      .map((r) => ({ id: String(r._id ?? r.id), version: r.version, intent: r.intent || '', category: r.category || '', question: r.question, variations: (r.variations || []).slice(0, 30), answer: r.answer, followUp: r.followUp || '', escalate: Boolean(r.escalate), escalationNote: r.escalationNote || '', language: r.language || 'en' }));
   return { version, items, count: items.length };
}

/** Which snapshot is live after a rollback: the chosen one must exist and not be the live one already. Pure. */
export function rollbackTarget(snapshots, activeVersion, toVersion) {
   const target = snapshots.find((s) => s.version === Number(toVersion));
   if (!target) return { error: `There is no published version ${toVersion}` };
   if (target.version === activeVersion) return { error: `Version ${toVersion} is already live` };
   return { version: target.version };
}

/* ---------- people ---------- */

export const ROLES = ['owner', 'admin', 'trainer', 'reviewer', 'approver', 'analyst'];
const CAN = {
   read: ROLES,
   import: ['owner', 'admin', 'trainer'],
   review: ['owner', 'admin', 'trainer', 'reviewer', 'approver'],
   approve: ['owner', 'admin', 'approver'],
   publish: ['owner', 'admin', 'approver'],
   evaluate: ['owner', 'admin', 'trainer', 'approver'],
   manage: ['owner', 'admin'],
};
/** Whether a role may do an action. Checked on the server for every request. Pure. */
export const can = (role, action) => Boolean(CAN[action]?.includes(role));

/* ---------- suggested answers ---------- */

export const SUGGEST_SYSTEM = (business) => [
   `You draft the recommended reply a ${business || 'business'}'s customer-service agent should send for one type of customer question.`,
   'Use ONLY the business facts and approved answers given. Never invent a price, availability, discount, date, promise or policy. If the facts do not cover the question, say what is missing in "needsData" and write a reply that asks the customer a clarifying question or offers to check, instead of guessing.',
   'Answer the actual question first, briefly and warmly, as a chat message (under 600 characters). Ask one useful follow-up question when it helps the customer move forward.',
   'Where a figure comes from the live facts and changes over time (a price, an address, opening hours), you may write it as a {variable} from the list given so it stays current.',
   DATA_RULE,
   'Reply with JSON only: {"answer": string, "sources": [string], "needsData": string, "escalate": boolean}',
].join('\n');

/** The prompt for one intent. Pure. */
export function suggestPrompt({ intent, examples, facts, approved, variables }) {
   return [
      `Intent: ${intent.name} (${intent.category})`,
      `How customers ask it:\n${examples.slice(0, 6).map((e) => `- ${asData(e)}`).join('\n')}`,
      approved.length ? `Approved answers to related questions:\n${approved.map((a) => `- ${a.question}: ${a.answer}`).join('\n')}` : 'Approved answers: none yet.',
      `Business facts (live):\n${facts || '(none supplied)'}`,
      variables.length ? `Variables you may use: ${variables.map((v) => `{${v}}`).join(', ')}` : '',
   ].filter(Boolean).join('\n\n');
}
