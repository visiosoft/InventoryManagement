import { retrieve, render } from './core/knowledge.js';
import { playbookOf, promptVersion, agentSystem, observerSystem, turnPrompt, cleanTurn, scoreSystem, scorePrompt, codeChecks, grade, summarizeRun, regressions, gateResults, allPassed } from './core/playbook.js';
import { asData } from './core/text.js';
import { audit } from './service.js';

/**
 * The sales sandbox and the scenario suite (Specification §14, §16, §17).
 *
 *   turn(host, org, input)        one agent reply, with the lead state, state,
 *                                 Next Best Action, media and knowledge trace.
 *                                 Nothing is sent, booked or charged.
 *   score(host, org, input, out)  the weighted scorecard and automatic fails
 *   startSuite(...)               every approved scenario, graded, with gates
 *
 * `host` is host.js: the organisation's model, facts, published answers and,
 * when connected, its own agent.
 */

const actorOf = (u) => ({ userId: String(u?.id || u?._id || ''), name: u?.name || u?.email || '' });

/** Published answers that match the message, with {variables} filled: the knowledge trace. */
async function matches(host, message, values) {
   const items = await host.snapshotItems();
   return retrieve(message, items, { limit: 4, min: 0.2 }).map(({ r, score }) => ({ id: r.id, question: r.question, answer: render(r.answer, values).text, score: Math.round(score * 100) / 100, escalate: Boolean(r.escalate) }));
}

/** Which agent answers: 'connected' only when a system is connected, else the hosted playbook agent. */
export function agentChoice(org, wanted) {
   return wanted === 'connected' && org.connector?.enabled ? 'connected' : 'hosted';
}

/** A lead state as { field: { value, confidence } }, from either that shape or plain values. Pure. */
export function normLead(lead) {
   const out = {};
   for (const [k, v] of Object.entries(lead && typeof lead === 'object' ? lead : {})) {
      const value = v && typeof v === 'object' ? v.value : v;
      if (value == null || value === '' || !/^[a-z][a-z0-9_]{0,40}$/.test(k)) continue;
      out[k] = { value: String(value).slice(0, 200), confidence: v && typeof v === 'object' ? Math.max(0, Math.min(1, Number(v.confidence) || 0)) : 1 };
   }
   return out;
}

export async function turn(host, org, { context = [], message, lead: given = {}, agent }) {
   const p = playbookOf(org);
   const lead = normLead(given);
   const facts = await host.facts().catch(() => ({ text: '', values: {} }));
   const answers = await matches(host, message, facts.values);
   const who = agentChoice(org, agent);
   const t0 = Date.now();
   let out; let tools = [];
   if (who === 'connected') {
      const r = await host.connectedReply({ question: message, context });
      tools = r.tools || [];
      const seen = await host.llmFor('observe').json({ system: observerSystem(p), user: `${turnPrompt({ context, message, lead, facts: facts.text })}\n\nAgent's reply: ${asData(r.reply, 'agent_reply')}`, maxTokens: 1200 });
      out = cleanTurn({ ...seen, reply: r.reply, needsHuman: r.needsHuman, factsUsed: [] }, p);
   } else {
      const raw = await host.llmFor('agent').json({ system: agentSystem(org, p), user: turnPrompt({ context, message, lead, answers, facts: facts.text }), maxTokens: 2500 });
      out = cleanTurn(raw, p);
   }
   // The lead state carries forward: what the agent did not mention stays as it was.
   const merged = { ...lead, ...out.lead };
   return {
      ...out, lead: merged, latencyMs: Date.now() - t0, agent: who === 'connected' ? 'Connected agent' : 'Playbook agent',
      model: who === 'connected' ? 'connected' : await host.modelName(), promptVersion: promptVersion(p), knowledgeVersion: org.activeSnapshot || 0,
      trace: { answers, facts: out.factsUsed, tools, media: out.media.map((k) => p.media.find((m) => m.key === k)).filter(Boolean) },
   };
}

export async function score(host, org, { context = [], message, lead = {}, scenario = {} }, out) {
   const p = playbookOf(org);
   const facts = await host.facts().catch(() => ({ text: '', values: {} }));
   const answers = out.trace?.answers || [];
   const factText = [facts.text, ...answers.map((a) => `Approved answer: ${a.answer}`)].filter(Boolean).join('\n');
   const code = codeChecks({ out, message, context, facts: factText, answers, mustEscalate: scenario.mustEscalate, maxLength: org.maxReplyLength });
   const judge = await host.llmFor('judge').json({ system: scoreSystem(p), user: scorePrompt({ context, message, lead, facts: factText, out, expected: { nba: scenario.nba, ideal: scenario.idealResponse, mustEscalate: scenario.mustEscalate } }), maxTokens: 900 });
   return { ...grade({ p, out, judge, code, scenario }), judgedBy: 'ai' };
}

/* ---------- the suite ---------- */

const SCOPES = { core: { core: true }, all: {} };

export async function startSuite(r, org, host, { scope = 'core', agent, label = '' } = {}, user) {
   const p = playbookOf(org);
   const filter = { status: 'approved', ...(SCOPES[scope] || { group: String(scope) }) };
   const list = await r.scenarios.find(filter, { sort: { group: 1, createdAt: 1 }, limit: 1000 });
   if (!list.length) return { error: 'No approved scenarios to run yet — approve some in Scenarios first' };
   const who = agentChoice(org, agent);
   const doc = await r.runs.create({
      label: label || `${scope === 'core' ? 'Core suite' : scope === 'all' ? 'Full suite' : scope} · ${list.length} scenarios`, scope,
      agent: who === 'connected' ? 'Connected agent' : 'Playbook agent', model: who === 'connected' ? 'connected' : await host.modelName(),
      promptVersion: promptVersion(p), knowledgeVersion: org.activeSnapshot || 0, startedBy: actorOf(user), progress: { done: 0, total: list.length },
   });
   await audit(r, user, 'suite.start', doc._id, { scope, cases: list.length, agent: doc.agent, model: doc.model, promptVersion: doc.promptVersion, knowledgeVersion: doc.knowledgeVersion });
   (async () => {
      const cases = [];
      for (const s of list) {
         const c = { scenario: String(s._id), title: s.title, group: s.group, core: s.core, factual: s.factual, mustEscalate: s.mustEscalate, message: s.message, context: s.context, expected: s.nba, ideal: s.idealResponse };
         try {
            const out = await turn(host, org, { context: s.context, message: s.message, lead: s.leadBefore, agent: who });
            c.out = { reply: out.reply, nba: out.nba, state: out.state, media: out.media, needsHuman: out.needsHuman, lead: out.lead, latencyMs: out.latencyMs, trace: out.trace, reason: out.reason };
            c.grade = await score(host, org, { context: s.context, message: s.message, lead: s.leadBefore, scenario: s }, out);
         } catch (e) { c.error = String(e.message).slice(0, 200); }
         cases.push(c);
         await r.runs.updateOne({ _id: doc._id }, { $set: { cases, 'progress.done': cases.length } });
      }
      const prev = await r.runs.findOne({ status: 'done', scope, agent: doc.agent }, { sort: { createdAt: -1 } });
      const summary = summarizeRun(cases);
      const regressed = prev ? regressions(prev.cases, cases) : [];
      const gates = gateResults(summary, p.gates, { prev: prev?.summary || null, regressed });
      await r.runs.updateOne({ _id: doc._id }, { $set: { status: 'done', summary, gates, regressions: regressed, passedAll: allPassed(gates), finishedAt: new Date() } });
   })().catch((e) => r.runs.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: e.message } }));
   return doc;
}

/** Recompute a finished run's gates after blind ratings change. */
export async function regate(r, org, run) {
   const p = playbookOf(org);
   const prev = await r.runs.findOne({ status: 'done', scope: run.scope, agent: run.agent, createdAt: { $lt: run.createdAt } }, { sort: { createdAt: -1 } });
   const summary = summarizeRun(run.cases);
   const gates = gateResults(summary, p.gates, { prev: prev?.summary || null, regressed: run.regressions || [] });
   await r.runs.updateOne({ _id: run._id }, { $set: { summary, gates, passedAll: allPassed(gates) } });
   return { summary, gates, passedAll: allPassed(gates) };
}

/* ---------- making scenarios ---------- */

const GEN_SYSTEM = (org, p) => [
   `You write realistic test scenarios for the customer-chat agent of ${org.business || org.name}. Each is one customer message (optionally with a short conversation before it) that a real customer would send on WhatsApp.`,
   `Allowed next actions: ${p.actions.map((a) => a.key).join(', ')}. Lead fields: ${p.fields.map((f) => f.key).join(', ')}.`,
   'Vary wording, length, language mix and difficulty. Do not include any prices or facts; the business supplies those. Do not write the agent\'s ideal reply.',
   'Reply with JSON only: {"scenarios": [{"title": string, "message": string, "context": [{"from": "customer"|"agent", "text": string}], "leadBefore": {field: value}, "intent": string, "nba": [acceptable action keys], "mustEscalate": boolean, "factual": boolean, "outcome": ""|"visit"|"booking"|"follow_up"|"escalation"}]}',
].join('\n');

/** Draft scenarios for one group of the matrix, as drafts for a person to approve. */
export async function generate(r, org, host, { group, count = 8 }, user) {
   const p = playbookOf(org);
   const g = p.groups.find((x) => x.key === group);
   if (!g) return { error: 'Unknown group' };
   const have = await r.scenarios.find({ group, status: { $ne: 'archived' } }, { select: 'message', limit: 200 });
   const out = await host.llmFor('scenarios').json({
      system: GEN_SYSTEM(org, p),
      user: `Group: ${g.label}. Write ${Math.min(Math.max(Number(count) || 8, 1), 20)} new scenarios. Already covered (do not repeat):\n${have.map((h) => `- ${h.message}`).join('\n') || '(none)'}`,
      maxTokens: 5000,
   });
   const actions = new Set(p.actions.map((a) => a.key));
   const docs = (Array.isArray(out?.scenarios) ? out.scenarios : []).filter((s) => s?.message).slice(0, 20).map((s) => ({
      group, title: String(s.title || s.message).slice(0, 120), message: String(s.message).slice(0, 2000),
      context: (Array.isArray(s.context) ? s.context : []).slice(0, 10).map((m) => ({ from: m?.from === 'agent' ? 'agent' : 'customer', text: String(m?.text || '').slice(0, 1000) })),
      leadBefore: typeof s.leadBefore === 'object' && s.leadBefore ? s.leadBefore : {}, intent: String(s.intent || '').slice(0, 120),
      nba: (Array.isArray(s.nba) ? s.nba : []).filter((k) => actions.has(k)), mustEscalate: Boolean(s.mustEscalate), factual: Boolean(s.factual),
      outcome: ['visit', 'booking', 'follow_up', 'escalation'].includes(s.outcome) ? s.outcome : '', core: false, source: 'generated', status: 'draft', tags: [group],
   }));
   if (docs.length) await r.scenarios.insertMany(docs);
   await audit(r, user, 'scenarios.generate', group, { created: docs.length });
   return { created: docs.length };
}

/** The playbook agent's reply as a starting point for the ideal response. */
export async function draftIdeal(host, org, s) {
   const out = await turn(host, org, { context: s.context, message: s.message, lead: s.leadBefore, agent: 'hosted' });
   return { idealResponse: out.reply, nba: out.nba, media: out.media, trace: out.trace };
}
