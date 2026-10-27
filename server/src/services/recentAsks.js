/**
 * Each person's own recent questions to the dashboard Ask box, newest first,
 * so the dashboard can show them again. Only the question that opens a
 * conversation is kept — the "Yes" or "25 sq ft" that answers a follow-up
 * question is not something anyone would search for twice.
 */

export const RECENT_LIMIT = 12;
const MAX_LENGTH = 300;

/** The list with this question put first: trimmed, a repeat moved up rather than kept twice, capped. */
export function addRecentAsk(list, question, at = new Date()) {
   const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
   const prev = Array.isArray(list) ? list.filter((x) => x && typeof x.q === 'string') : [];
   if (q.length < 3) return prev.slice(0, RECENT_LIMIT);
   const key = q.toLowerCase();
   return [{ q, at }, ...prev.filter((x) => x.q.toLowerCase() !== key)].slice(0, RECENT_LIMIT);
}
