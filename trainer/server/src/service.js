import { extractTurns, dedupe, bucketOf, asData, DATA_RULE } from './core/text.js';
import { clusterQuestions } from './core/cluster.js';
import { SUGGEST_SYSTEM, suggestPrompt, variablesIn, findConflicts, buildSnapshot, rollbackTarget, render } from './core/knowledge.js';
import { deterministicChecks, JUDGE_SYSTEM, judgePrompt, cleanJudgement, summarize } from './core/evaluate.js';

/**
 * The training pipeline, business-independent. Everything particular to one
 * company comes in through `host`:
 *
 *   host.llmFor(feature).json({ system, user })   any model provider, usage counted per feature
 *   host.sources[name](params) → threads          where conversations come from
 *   host.facts() → { text, values }               live business data and {variables}
 *   host.agent?.reply({ question, ref, at })      the company's own AI agent, if connected
 *
 * `r` is the tenant-scoped repository (repo.js). Long jobs (import,
 * evaluation) run in the background and record progress on their document.
 */

export const HOLDOUT_PCT = 20;
/** The model for one job, so usage is counted by what it was for. */
const ai = (host, feature) => (host.llmFor ? host.llmFor(feature) : host.llm);
const SENSITIVE = /complain|refund|billing|contract|deposit|discount|legal|payment|collection/i;
const actorOf = (u) => ({ userId: String(u?.id || u?._id || ''), name: u?.name || u?.email || 'API' });

export async function audit(r, user, action, target, detail) {
   await r.audit.create({ by: actorOf(user), action, target: String(target || ''), detail, at: new Date() }).catch(() => null);
}

/* ---------- import ---------- */

/** Rows from a CSV/JSON upload as threads: { conversation, from|role, text, at }. Pure. */
export function rowsToThreads(rows) {
   const map = new Map();
   for (const row of rows || []) {
      const text = String(row.text ?? row.message ?? row.body ?? '').trim();
      if (!text) continue;
      const ref = String(row.conversation ?? row.conversation_id ?? row.thread ?? row.customer ?? row.phone ?? 'single');
      const who = String(row.from ?? row.role ?? row.direction ?? row.sender ?? 'customer').toLowerCase();
      const from = /\b(agent|staff|business|outbound|assistant|bot|ai|team|rep|us)\b/.test(who) ? 'agent' : 'customer';
      const at = row.at ?? row.timestamp ?? row.date ?? row.time ?? null;
      (map.get(ref) || map.set(ref, []).get(ref)).push({ from, text, at: at ? new Date(at) : new Date(0), byAi: /\b(bot|ai|assistant)\b/.test(who) });
   }
   return [...map.entries()].map(([ref, messages]) => ({ ref, messages }));
}

export async function startImport(r, org, host, { source, params = {}, rows = null, user }) {
   const doc = await r.imports.create({ source, label: params.label || source, params: { ...params, rows: undefined }, startedBy: actorOf(user) });
   await audit(r, user, 'import.start', doc._id, { source, params: { ...params, rows: undefined } });
   (async () => {
      const save = (set) => r.imports.updateOne({ _id: doc._id }, { $set: set });
      try {
         const threads = rows ? rowsToThreads(rows) : await host.sources[source](params);
         const limit = Math.min(Number(params.limit) || 500, 20000);
         let turns = dedupe(extractTurns(threads, { maxPerThread: Number(params.perConversation) || 3 })).slice(0, limit);
         await save({ stage: 'clustering', 'counts.messages': threads.reduce((n, t) => n + t.messages.length, 0), 'counts.turns': turns.length, 'progress.total': turns.length });
         const stored = await r.questions.insertMany(turns.map((t) => ({
            import: doc._id, source, ref: t.ref, at: t.at, text: t.text, lang: t.lang, repeats: t.repeats,
            context: t.context, humanReply: t.humanReply, split: bucketOf(`${t.ref}|${t.text}`) < HOLDOUT_PCT ? 'eval' : 'train',
         })));
         turns = stored.map((s) => s.toObject ? s.toObject() : s);

         const existing = await r.clusters.find({}, { select: 'key name category question' });
         const { intents, keys } = await clusterQuestions(turns, {
            llm: ai(host, 'cluster'), categories: org.categories?.length ? org.categories : ['Other'], intents: existing,
            onBatch: async ({ done, error }) => {
               await save({ 'progress.done': done });
               if (error) await r.imports.updateOne({ _id: doc._id }, { $push: { problems: `A batch could not be sorted: ${String(error).slice(0, 200)}` } });
            },
         });
         const known = new Set(existing.map((x) => x.key));
         let newIntents = 0;
         for (const it of intents) {
            if (known.has(it.key)) continue;
            await r.clusters.create({ key: it.key, name: it.name, category: it.category, question: it.question, status: 'new' });
            newIntents += 1;
         }
         const clusters = new Map((await r.clusters.find({}, { select: 'key' })).map((c) => [c.key, c._id]));
         let skipped = 0;
         for (let i = 0; i < turns.length; i++) {
            const id = keys[i] ? clusters.get(keys[i]) : null;
            if (!id) skipped += 1;
            await r.questions.updateOne({ _id: turns[i]._id }, { $set: { cluster: id || null, skipped: !id } });
         }
         await recount(r);
         await save({ stage: 'suggesting', 'counts.questions': turns.length - skipped, 'counts.skipped': skipped, 'counts.intents': intents.length, 'counts.newIntents': newIntents, 'counts.holdout': turns.filter((t) => t.split === 'eval').length });

         // Suggested answers for intents nobody has answered yet, most asked first.
         const open = await r.clusters.find({ status: 'new' }, { sort: { count: -1 }, limit: Number(params.suggest) || 60 });
         for (const c of open) await suggest(r, org, host, c).catch(() => null);
         await save({ status: 'done', stage: 'done', finishedAt: new Date() });
      } catch (e) {
         await save({ status: 'failed', stage: 'failed', problems: [String(e.message).slice(0, 300)], finishedAt: new Date() });
      }
   })();
   return doc;
}

/** Each intent's size, languages, from its questions. */
export async function recount(r) {
   const rows = await r.questions.aggregate([
      { $match: { cluster: { $ne: null } } },
      { $group: { _id: '$cluster', n: { $sum: '$repeats' }, langs: { $addToSet: '$lang' } } },
   ]);
   for (const row of rows) await r.clusters.updateOne({ _id: row._id }, { $set: { count: row.n, languages: row.langs } });
}

/* ---------- suggested answers ---------- */

/**
 * A recommended answer for one intent, from the business's live facts,
 * approved answers on nearby questions, and how the team has actually replied
 * before (as reference, never as authority). Holdout questions are not used.
 */
export async function suggest(r, org, host, cluster, user) {
   const qs = await r.questions.find({ cluster: cluster._id, split: 'train' }, { sort: { repeats: -1 }, limit: 12, select: 'text humanReply' });
   const examples = qs.map((q) => q.text);
   const human = qs.map((q) => q.humanReply).filter(Boolean).slice(0, 3);
   const facts = host.facts ? await host.facts().catch(() => ({ text: '', values: {} })) : { text: '', values: {} };
   const approved = await r.knowledge.find({ status: { $in: ['approved', 'published'] }, category: cluster.category }, { limit: 6, select: 'question answer' });
   let out;
   try {
      const user0 = suggestPrompt({ intent: cluster, examples: examples.length ? examples : [cluster.question], facts: facts.text, approved, variables: Object.keys(facts.values || {}) })
         + (human.length ? `\n\nHow our team replied before (reference only, may be outdated):\n${human.map((h) => `- ${asData(h, 'agent_reply')}`).join('\n')}` : '');
      out = await ai(host, 'suggest').json({ system: SUGGEST_SYSTEM(org.business), user: user0, maxTokens: 900 });
   } catch (e) {
      await r.clusters.updateOne({ _id: cluster._id }, { $set: { 'suggestion.error': e.message, 'suggestion.at': new Date() } });
      throw e;
   }
   const suggestion = {
      text: String(out?.answer || '').slice(0, 2000),
      sources: (Array.isArray(out?.sources) ? out.sources : []).map(String).slice(0, 6),
      needsData: String(out?.needsData || '').slice(0, 300),
      escalate: Boolean(out?.escalate), by: 'ai', at: new Date(), error: '',
   };
   await r.clusters.updateOne({ _id: cluster._id }, { $set: { suggestion, ...(cluster.status === 'new' ? { status: 'suggested' } : {}) }, $push: { history: { action: 'suggested', by: actorOf(user || { name: 'AI' }), at: new Date() } } });
   return suggestion;
}

/* ---------- review ---------- */

export const ACTIONS = ['approve', 'edit', 'reject', 'save_new', 'escalate', 'comment', 'reopen'];

async function variationsOf(r, cluster) {
   const qs = await r.questions.find({ cluster: cluster._id, split: 'train' }, { sort: { repeats: -1 }, limit: 30, select: 'text' });
   return [...new Set(qs.map((q) => q.text))].slice(0, 25);
}

/** Puts an answer on the intent's record: a new record, or the next version of its existing one. */
async function upsertRecord(r, cluster, { answer, followUp = '', escalate = false, escalationNote = '', original = '', user, note = '', separate = false }) {
   const now = new Date(); const by = actorOf(user);
   const base = { intent: cluster.key, category: cluster.category, question: cluster.question, variations: await variationsOf(r, cluster), escalate, escalationNote };
   const existing = !separate && cluster.record ? await r.knowledge.byId(cluster.record, { doc: true }) : null;
   if (existing) {
      existing.versions.push({ version: existing.version, answer: existing.answer, followUp: existing.followUp, status: existing.status, by: existing.approvedBy, at: existing.approvedAt, note: 'previous' });
      Object.assign(existing, base, { answer, followUp, status: 'approved', version: existing.version + 1, approvedBy: by, approvedAt: now });
      existing.versions.push({ version: existing.version, answer, followUp, status: 'approved', by, at: now, note, original });
      await existing.save();
      return existing;
   }
   return r.knowledge.create({ ...base, cluster: cluster._id, answer, followUp, status: 'approved', version: 1, allowMultiple: separate, approvedBy: by, approvedAt: now, effectiveFrom: now, versions: [{ version: 1, answer, followUp, status: 'approved', by, at: now, note, original }] });
}

/**
 * One reviewer decision on an intent. `approve` takes the suggestion as it
 * is; `edit` approves the reviewer's text (the suggestion is kept beside it);
 * `save_new` adds a separate answer for the same intent; `escalate` records
 * that this intent always goes to a person.
 */
export async function review(r, cluster, action, { text = '', followUp = '', note = '' } = {}, user) {
   if (!ACTIONS.includes(action)) throw new Error(`Unknown action ${action}`);
   const by = actorOf(user); const at = new Date();
   const push = { history: { action, by, at, note: String(note).slice(0, 500) } };
   if (action === 'comment') {
      await r.clusters.updateOne({ _id: cluster._id }, { $push: { comments: { by, text: String(text).slice(0, 1000), at } } });
      return { ok: true };
   }
   if (action === 'reject') { await r.clusters.updateOne({ _id: cluster._id }, { $set: { status: 'rejected' }, $push: push }); return { ok: true }; }
   if (action === 'reopen') { await r.clusters.updateOne({ _id: cluster._id }, { $set: { status: cluster.suggestion?.text ? 'suggested' : 'new' }, $push: push }); return { ok: true }; }
   const answer = String(action === 'approve' ? cluster.suggestion?.text || '' : text).trim();
   if (action !== 'escalate' && !answer) throw new Error('There is no answer to approve');
   if (answer.length > 2000) throw new Error('Keep an answer under 2,000 characters');
   const record = await upsertRecord(r, cluster, {
      answer: answer || 'Hand this conversation to a person.', followUp, user, note,
      escalate: action === 'escalate', escalationNote: action === 'escalate' ? String(note || text).slice(0, 300) : '',
      original: action === 'edit' ? cluster.suggestion?.text || '' : '', separate: action === 'save_new',
   });
   await r.clusters.updateOne({ _id: cluster._id }, { $set: { status: action === 'escalate' ? 'escalated' : 'approved', ...(action === 'save_new' && cluster.record ? {} : { record: record._id }) }, $push: push });
   return { ok: true, record: record._id, version: record.version };
}

/** Intents safe to approve in bulk: a suggestion with no missing data, not escalated, not a sensitive category. Pure. */
export const bulkEligible = (c) => c.status === 'suggested' && c.suggestion?.text && !c.suggestion.needsData && !c.suggestion.escalate && !SENSITIVE.test(`${c.category} ${c.name}`);

/* ---------- publishing ---------- */

export async function conflicts(r) {
   const records = await r.knowledge.find({ status: { $in: ['approved', 'published'] } });
   return findConflicts(records.map((x) => ({ ...x, id: String(x._id) })));
}

export async function publish(r, org, { note = '', force = false } = {}, user) {
   const found = await conflicts(r);
   if (found.length && !force) return { error: `${found.length} possible conflict${found.length === 1 ? '' : 's'} between approved answers — resolve them, or publish anyway`, conflicts: found };
   const records = await r.knowledge.find({ status: { $in: ['approved', 'published'] } });
   if (!records.length) return { error: 'Nothing is approved yet' };
   const last = await r.snapshots.findOne({}, { sort: { version: -1 } });
   const version = (last?.version || 0) + 1;
   const snap = buildSnapshot(records, version);
   await r.snapshots.create({ ...snap, note: String(note).slice(0, 300), publishedBy: actorOf(user), conflicts: found });
   await r.knowledge.updateMany({ status: 'approved' }, { $set: { status: 'published' } });
   await setActive(org, version);
   await audit(r, user, 'publish', version, { count: snap.count, conflicts: found.length });
   return { ok: true, version, count: snap.count };
}

export async function rollback(r, org, toVersion, user) {
   const snaps = await r.snapshots.find({}, { select: 'version' });
   const t = rollbackTarget(snaps, org.activeSnapshot, toVersion);
   if (t.error) return t;
   await setActive(org, t.version);
   await audit(r, user, 'rollback', t.version, { from: org.activeSnapshot });
   return { ok: true, version: t.version };
}

let setActiveImpl = async () => {};
/** The org model lives outside the tenant repo (it is the tenant); routes wire this. */
export const onSetActive = (fn) => { setActiveImpl = fn; };
const setActive = (org, version) => setActiveImpl(org, version);

/* ---------- evaluation ---------- */

/**
 * The agent answers held-out questions whose intent has an approved answer,
 * and each reply is checked by code and graded by a model against it.
 */
export async function startEval(r, org, host, { limit = 30, label = '' } = {}, user) {
   if (!host.agent) return { error: 'No agent is connected to test' };
   const records = await r.knowledge.find({ status: { $in: ['approved', 'published'] } });
   const byCluster = new Map(records.filter((x) => x.cluster).map((x) => [String(x.cluster), x]));
   const pool = await r.questions.find({ split: 'eval', cluster: { $in: [...byCluster.keys()] } }, { sort: { at: -1 }, limit: Math.min(Number(limit) || 30, 200) });
   if (!pool.length) return { error: 'No held-out questions have an approved answer yet — approve some intents first' };
   const doc = await r.evals.create({ label: label || `Test of ${pool.length}`, snapshotVersion: org.activeSnapshot, agent: host.agent.name || 'agent', startedBy: actorOf(user), progress: { done: 0, total: pool.length } });
   await audit(r, user, 'eval.start', doc._id, { cases: pool.length });
   (async () => {
      const cases = [];
      const facts = host.facts ? await host.facts().catch(() => ({ text: '', values: {} })) : { text: '', values: {} };
      for (const q of pool) {
         const record = byCluster.get(String(q.cluster));
         const c = { question: q.text, intent: record.intent, expected: render(record.answer, facts.values).text };
         try {
            const t0 = Date.now();
            const out = await host.agent.reply({ question: q.text, ref: q.ref, at: q.at });
            Object.assign(c, { reply: out.reply || '', needsHuman: Boolean(out.needsHuman), latencyMs: Date.now() - t0 });
            c.checks = deterministicChecks({ reply: c.reply, needsHuman: c.needsHuman, question: q.text, record, facts: facts.text, values: facts.values, prohibited: org.prohibited, maxLength: org.maxReplyLength });
            if (c.reply && !record.escalate) c.judgement = cleanJudgement(await ai(host, 'judge').json({ system: JUDGE_SYSTEM, user: judgePrompt({ question: q.text, reply: c.reply, approved: c.expected }), maxTokens: 300 }));
         } catch (e) {
            c.error = String(e.message).slice(0, 200);
         }
         cases.push(c);
         await r.evals.updateOne({ _id: doc._id }, { $set: { cases, 'progress.done': cases.length } });
      }
      await r.evals.updateOne({ _id: doc._id }, { $set: { status: 'done', summary: summarize(cases), finishedAt: new Date() } });
   })().catch((e) => r.evals.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: e.message } }));
   return doc;
}

/* ---------- overview ---------- */

export async function overview(r, org) {
   const [questions, holdout, clusters, byStatus, records, conflictList, lastEval, snapshots, feedback] = await Promise.all([
      r.questions.count({ skipped: false }), r.questions.count({ split: 'eval', skipped: false }), r.clusters.count({}),
      r.clusters.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      r.knowledge.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      conflicts(r), r.evals.find({ status: 'done' }, { sort: { createdAt: -1 }, limit: 2, select: 'label summary createdAt snapshotVersion' }),
      r.snapshots.count({}), r.feedback.count({ status: 'open' }),
   ]);
   const edited = await r.knowledge.count({ 'versions.original': { $nin: [null, ''] } });
   const [trend, activity, queue, top, tests] = await Promise.all([
      trends(r, 30),
      r.audit.find({}, { sort: { at: -1 }, limit: 8, select: 'by action target detail at' }),
      r.clusters.find({ status: { $in: ['new', 'suggested'] } }, { sort: { count: -1 }, limit: 5, select: 'name question count category status createdAt' }),
      r.clusters.find({}, { sort: { count: -1 }, limit: 6, select: 'name count status category' }),
      r.evals.find({ status: 'done' }, { sort: { createdAt: 1 }, limit: 12, select: 'summary.mean createdAt' }),
   ]);
   return {
      questions, holdout, intents: clusters,
      review: Object.fromEntries(byStatus.map((x) => [x._id, x.n])),
      knowledge: Object.fromEntries(records.map((x) => [x._id, x.n])),
      edited, conflicts: conflictList.length, activeSnapshot: org.activeSnapshot, snapshots, openFeedback: feedback,
      evals: lastEval, trend, activity, queue, top,
      testTrend: tests.map((t) => ({ at: t.createdAt, mean: t.summary?.mean ?? null })),
   };
}

const DAY_MS = 86_400_000;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Daily rows for the last `days` days, every day present (0 when nothing
 * happened), oldest first. `rows` are [{ day: 'YYYY-MM-DD', key, n }]. Pure.
 */
export function fillDays(rows, keys, days, now = new Date()) {
   const out = [];
   for (let i = days - 1; i >= 0; i--) {
      const day = dayOf(now.getTime() - i * DAY_MS);
      const row = { day };
      for (const k of keys) row[k] = 0;
      out.push(row);
   }
   const at = new Map(out.map((r) => [r.day, r]));
   for (const r of rows) if (at.has(r.day) && r.key in at.get(r.day)) at.get(r.day)[r.key] += r.n;
   return out;
}

/** What happened each day: questions brought in, and every review decision. */
export async function trends(r, days = 30, now = new Date()) {
   const since = new Date(now.getTime() - days * DAY_MS);
   const [imported, decided] = await Promise.all([
      r.questions.aggregate([
         { $match: { createdAt: { $gte: since }, skipped: false } },
         { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, n: { $sum: '$repeats' } } },
      ]),
      r.clusters.aggregate([
         { $unwind: '$history' },
         { $match: { 'history.at': { $gte: since }, 'history.action': { $in: ['approve', 'edit', 'save_new', 'reject', 'escalate'] } } },
         { $group: { _id: { day: { $dateToString: { date: '$history.at', format: '%Y-%m-%d' } }, action: '$history.action' }, n: { $sum: 1 } } },
      ]),
   ]);
   const KEY = { approve: 'approved', save_new: 'approved', edit: 'edited', reject: 'rejected', escalate: 'escalated' };
   return fillDays([
      ...imported.map((x) => ({ day: x._id, key: 'questions', n: x.n })),
      ...decided.map((x) => ({ day: x._id.day, key: KEY[x._id.action], n: x.n })),
   ], ['questions', 'approved', 'edited', 'rejected', 'escalated'], days, now);
}

export { DATA_RULE, variablesIn };

/* ---------- retention ---------- */

/**
 * Each organisation's imported questions older than its retention period are
 * deleted, with the import records that only pointed at them. Approved
 * knowledge is kept: it is the business's own text, not customer data.
 */
export async function purgeExpired(models, now = new Date()) {
   const orgs = await models.TrainingOrg.find({ retentionDays: { $gt: 0 } }).select('retentionDays').lean();
   let removed = 0;
   for (const o of orgs) {
      const before = new Date(now.getTime() - o.retentionDays * 86_400_000);
      const out = await models.TrainingQuestion.deleteMany({ org: o._id, createdAt: { $lt: before } });
      await models.TrainingFeedback.deleteMany({ org: o._id, createdAt: { $lt: before } });
      if (models.Message) await models.Message.deleteMany({ org: o._id, createdAt: { $lt: before } });
      removed += out.deletedCount || 0;
   }
   return removed;
}
