import { asData, DATA_RULE } from './text.js';
import { render } from './knowledge.js';

/**
 * Testing an agent against held-out questions. Pure apart from `llm`.
 *
 * Checks that can be decided by code are decided by code. The rest — is this
 * reply as good as the approved one — is a language model's judgement, and is
 * labelled as one everywhere it is shown: an estimate to compare two runs by,
 * not a verdict. Holdout questions never feed clustering examples or
 * suggested answers, so a better score is not just the agent seeing the test.
 */

export const JUDGE_SYSTEM = [
   'You grade a customer-service reply against the answer the business approved for that kind of question.',
   'Score 1–5 each: accuracy (states nothing that contradicts the approved answer or the facts, invents nothing), relevance (answers what was asked), tone (brief, warm, professional chat message), completeness (covers what the approved answer covers that matters to this customer).',
   'A reply may use different words and still score 5. A reply that is right but adds an invented figure or promise scores at most 2 for accuracy.',
   DATA_RULE,
   'Reply with JSON only: {"accuracy":n,"relevance":n,"tone":n,"completeness":n,"note":"one short sentence"}',
].join('\n');

const figures = (s) => new Set((String(s ?? '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '')).filter((n) => n.length > 1));

/**
 * What code can tell about a reply. Pure.
 *  - unsupportedFigures: numbers in the reply found in neither the approved
 *    answer, the live facts, nor the question
 *  - escalation: when the approved record says "hand to a person", did it?
 *  - prohibited: phrases the business has banned
 *  - length: over the limit
 */
export function deterministicChecks({ reply, needsHuman = false, question, record, facts = '', values = {}, prohibited = [], maxLength = 700 }) {
   const allowed = new Set([...figures(record ? render(record.answer, values).text : ''), ...figures(facts), ...figures(question)]);
   const unsupported = [...figures(reply)].filter((n) => !allowed.has(n));
   const lower = String(reply ?? '').toLowerCase();
   const banned = prohibited.filter((p) => p && lower.includes(String(p).toLowerCase()));
   const checks = {
      unsupportedFigures: unsupported,
      escalationOk: record?.escalate ? Boolean(needsHuman) : true,
      prohibited: banned,
      tooLong: String(reply ?? '').length > maxLength,
      empty: !String(reply ?? '').trim() && !needsHuman,
   };
   checks.pass = !unsupported.length && checks.escalationOk && !banned.length && !checks.tooLong && !checks.empty;
   return checks;
}

/** The judge prompt for one case. Pure. */
export function judgePrompt({ question, reply, approved }) {
   return [
      `Customer asked: ${asData(question)}`,
      `Approved answer for this kind of question: ${asData(approved, 'example')}`,
      `Reply being graded: ${asData(reply, 'agent_reply')}`,
   ].join('\n\n');
}

const clamp = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));

/** A judge reply made safe: four scores 1–5 and their mean. Pure. */
export function cleanJudgement(j) {
   const s = { accuracy: clamp(j?.accuracy), relevance: clamp(j?.relevance), tone: clamp(j?.tone), completeness: clamp(j?.completeness) };
   return { ...s, mean: Math.round(((s.accuracy + s.relevance + s.tone + s.completeness) / 4) * 100) / 100, note: String(j?.note || '').slice(0, 200), judgedBy: 'ai' };
}

/** A run's summary from its cases. Pure. */
export function summarize(cases) {
   const done = cases.filter((c) => !c.error);
   const judged = done.filter((c) => c.judgement);
   const avg = (k) => (judged.length ? Math.round((judged.reduce((s, c) => s + c.judgement[k], 0) / judged.length) * 100) / 100 : null);
   return {
      cases: cases.length, completed: done.length, errors: cases.length - done.length,
      checksPassed: done.filter((c) => c.checks?.pass).length,
      unsupportedFigures: done.filter((c) => c.checks?.unsupportedFigures?.length).length,
      escalationMisses: done.filter((c) => c.checks && !c.checks.escalationOk).length,
      handedOver: done.filter((c) => c.needsHuman).length,
      judged: judged.length,
      accuracy: avg('accuracy'), relevance: avg('relevance'), tone: avg('tone'), completeness: avg('completeness'), mean: avg('mean'),
      avgLatencyMs: done.length ? Math.round(done.reduce((s, c) => s + (c.latencyMs || 0), 0) / done.length) : null,
   };
}

/** Before → after, per measure, for two summaries. Pure. */
export function compareRuns(before, after) {
   const keys = ['mean', 'accuracy', 'relevance', 'tone', 'completeness'];
   const rate = (s) => (s?.completed ? Math.round((s.checksPassed / s.completed) * 1000) / 10 : null);
   const out = keys.map((k) => ({ measure: k, before: before?.[k] ?? null, after: after?.[k] ?? null }));
   out.push({ measure: 'checksPassedPct', before: rate(before), after: rate(after) });
   return out.map((r) => ({ ...r, change: r.before != null && r.after != null ? Math.round((r.after - r.before) * 100) / 100 : null }));
}
