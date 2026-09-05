import { AgentDefinition, AgentRun, AgentFinding } from '../../models/index.js';
import { openaiConfigured, openaiModel } from '../openai.js';

/**
 * The frame every agent runs in.
 *
 * An agent reads part of the business, judges what it finds, and produces
 * ranked findings a person acts on. None of them send anything — they
 * recommend, and the sending happens in the console built for it.
 *
 * This engine exists because the codebase already had five of these written
 * separately and none of them shared anything: the assistant drafts replies in
 * batches of five, the summariser sweeps threads and caches on the last
 * message id, the digest builds an analysis on a schedule and stores it, the
 * report planner has a model choose from a closed catalogue without seeing the
 * data, and the lead SLA nudges on a rule. The shape was always the same. What
 * was missing was somewhere to put it.
 *
 * So a new agent is a file exporting three things — `stages`, `collect` and
 * `judge` — and everything else below is done for it: batching, per-item error
 * capture, the activity feed, caching, cost estimation, stopping, and writing
 * the findings out.
 */

/** Five at a time, the same ceiling the assistant settled on. Twenty requests
 *  in flight earns a rate-limit rejection, and then nobody is served. */
export const AGENT_CONCURRENCY = 5;

/** The activity feed is a window, not a log. A sweep over every conversation
 *  would otherwise grow one document past what Mongo will hold, and nobody
 *  reads the five-hundredth line back. */
export const MAX_EVENTS = 60;

/* Roughly what one judged item costs, from measured runs: ~1,500 tokens in
 * (the stored summary plus a short transcript and the facts) and ~300 out.
 * Only ever used to show an estimate before a run starts, so the numbers being
 * approximate is fine — being absent is not, because an unexplained bill is
 * how somebody stops trusting the feature. */
const PRICES_PER_MTOK = {
   'gpt-4o-mini': { in: 0.15, out: 0.60 },
   'gpt-4.1-mini': { in: 0.40, out: 1.60 },
   'gpt-4o': { in: 2.50, out: 10.00 },
   'gpt-4.1': { in: 2.00, out: 8.00 },
};
const TOKENS_IN = 1500;
const TOKENS_OUT = 300;

export function estimateCost(items, model = openaiModel()) {
   const p = PRICES_PER_MTOK[model] || PRICES_PER_MTOK['gpt-4o-mini'];
   return (items * (TOKENS_IN * p.in + TOKENS_OUT * p.out)) / 1e6;
}

/* ── the registry ─────────────────────────────────────────────────────────── */

const types = new Map();

/**
 * @param type {{
 *   key, label, describe,
 *   judges,          // false for a purely deterministic agent — no key needed
 *   stages,          // [{ key, label }] shown by the progress view
 *   defaults,        // starting config for a new definition of this type
 *   collect,         // (ctx) -> rows, deterministic, no model calls
 *   judge,           // (row, ctx) -> finding | null
 * }}
 */
export function registerAgentType(type) {
   if (!type?.key) throw new Error('An agent type needs a key');
   types.set(type.key, type);
   return type;
}

export function agentType(key) {
   return types.get(key) || null;
}

/** The catalogue, for the page that offers "new agent". */
export function agentTypes() {
   return [...types.values()].map((t) => ({
      key: t.key,
      label: t.label,
      describe: t.describe,
      judges: t.judges !== false,
      stages: t.stages,
      defaults: t.defaults || {},
   }));
}

/* ── the guard rail every judging agent inherits ──────────────────────────── */

/** Currency figures and bare years — the two things a model invents that read
 *  as authoritative. AED 1,200 in a recommendation nobody checked is worse
 *  than no recommendation. */
const FIGURE = new RegExp([
   String.raw`\d[\d,.]*\s*(aed|dhs?|dirhams?|usd)\b`,   // 1,200 AED
   String.raw`(aed|dhs?|dirhams?|usd|\$)\s*\d`,          // AED 1,200 — the commoner form here
   String.raw`\b(19|20)\d{2}\b`,                          // a bare year
].join('|'), 'i');

/**
 * Check what came back from the model.
 *
 * The rule the report planner and the inbox ask already follow: **the model
 * chooses from a closed catalogue and never states a figure.** It is handed
 * facts the server computed and returns a choice plus prose about them.
 *
 * Rejected, never repaired. A response naming a template that does not exist
 * would fail at Meta with an opaque error days later; blanking one field and
 * keeping the rest produces a recommendation nobody wrote. Either it is
 * usable or the item is recorded as unjudged, which is a fine outcome and a
 * visible one — it shows in the activity feed.
 *
 * @returns {{ ok: true, plan }|{ ok: false, reason: string }}
 */
export function validatePlan(raw, { templates = [], allowedSources = [], prose = [] } = {}) {
   if (!raw || typeof raw !== 'object') return { ok: false, reason: 'no usable answer' };

   for (const field of prose) {
      const text = String(raw[field] ?? '');
      if (FIGURE.test(text)) return { ok: false, reason: `stated a figure in ${field}` };
      if (text.length > 300) return { ok: false, reason: `${field} ran long` };
   }

   const name = String(raw.template || '').trim();
   if (name) {
      const known = templates.find((t) => t.name === name);
      if (!known) return { ok: false, reason: `unknown template ${name}` };

      const vars = Array.isArray(raw.variables) ? raw.variables : [];
      if (vars.length !== known.variableCount) {
         return { ok: false, reason: `${name} needs ${known.variableCount} value(s), got ${vars.length}` };
      }
      for (const v of vars) {
         const source = String(v?.source || '');
         // A literal is where an invented price or date would enter, so the
         // model may only name where a value comes from — the server fills it.
         if (!allowedSources.includes(source)) {
            return { ok: false, reason: `variable source ${source || '(blank)'} is not allowed` };
         }
      }
   }

   return { ok: true, plan: raw };
}

/* ── what carries over between runs ───────────────────────────────────────── */

/**
 * Can last run's finding stand, or must this one be judged again?
 *
 * Only when the agent said what "unchanged" means for it. An agent that costs
 * nothing to run leaves `cacheKey` empty and is simply redone — caching a free
 * answer buys nothing and risks serving a stale one.
 */
export function shouldReuse(held, row) {
   if (!held || !row?.cacheKey) return false;
   return held.cacheKey === row.cacheKey;
}

/**
 * What a person decided about somebody, carried across runs.
 *
 * Findings are replaced wholesale each run, because somebody who no longer
 * qualifies should stop appearing. But a dismissal is a human judgement and
 * must survive that — otherwise every run resurrects everything anybody had
 * already dealt with, and the list becomes impossible to keep on top of.
 *
 * The exception is a reply. Somebody who writes back is live again whatever
 * was decided about them, so their state is spent.
 */
export function carriedState(held, row, now = new Date()) {
   if (!held || !held.state || held.state === 'open') return null;

   const wroteSince = row?.lastInboundAt && held.stateAt
      && new Date(row.lastInboundAt) > new Date(held.stateAt);
   if (wroteSince) return null;

   if (held.state === 'snoozed' && held.snoozeUntil && new Date(held.snoozeUntil) <= new Date(now)) return null;

   return held;
}

/* ── running one ──────────────────────────────────────────────────────────── */

async function inBatches(items, size, work) {
   for (let i = 0; i < items.length; i += size) {
      await Promise.all(items.slice(i, i + size).map(work));
   }
}

/**
 * A run's live state, flushed to the document rather than written per item.
 *
 * Five hundred items would otherwise be five hundred writes to one growing
 * document while five model calls are in flight. The page polls about once a
 * second, so flushing on that cadence loses nothing anybody could see.
 */
class RunReporter {
   constructor(runId, stages) {
      this.runId = runId;
      this.stages = stages.map((s) => ({ ...s, total: 0, done: 0 }));
      this.events = [];
      this.dirty = false;
      this.lastFlush = 0;
      this.stopped = false;
   }

   stage(key, patch) {
      const s = this.stages.find((x) => x.key === key);
      if (s) Object.assign(s, patch);
      this.dirty = true;
   }

   step(key, by = 1) {
      const s = this.stages.find((x) => x.key === key);
      if (s) s.done += by;
      this.dirty = true;
   }

   say(text, level = 'info') {
      this.events.unshift({ at: new Date(), text, level });
      if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
      this.dirty = true;
   }

   async flush(force = false) {
      if (!this.dirty && !force) return;
      if (!force && Date.now() - this.lastFlush < 900) return;
      this.lastFlush = Date.now();
      this.dirty = false;
      const doc = await AgentRun.findByIdAndUpdate(
         this.runId,
         { $set: { stages: this.stages, events: this.events } },
         { new: true, projection: { stopRequested: 1 } },
      ).lean();
      // Checked on the way past rather than polled: a stop takes effect
      // between items, never mid-call, so nothing is left half-written.
      if (doc?.stopRequested) this.stopped = true;
   }
}

/**
 * Execute one agent.
 *
 * Errors are caught per item. One conversation with an unreadable shape must
 * not end a sweep of five hundred — it becomes a line in the feed and the run
 * carries on, which is also how somebody finds out it happened.
 */
export async function runAgent(definition, { startedBy = null, startedByName = '', trigger = 'manual' } = {}) {
   const type = agentType(definition.type);
   if (!type) throw new Error(`No agent of type "${definition.type}"`);

   const model = openaiModel();
   const run = await AgentRun.create({
      definition: definition._id,
      agentType: definition.type,
      status: 'running',
      startedAt: new Date(),
      startedBy,
      startedByName,
      trigger,
      model: type.judges === false ? '' : model,
      stages: type.stages.map((s) => ({ ...s, total: 0, done: 0 })),
   });

   const report = new RunReporter(run._id, type.stages);
   const config = { ...(type.defaults || {}), ...(definition.config || {}) };
   const ctx = { config, definition, report, now: new Date(), model };

   const counts = { collected: 0, judged: 0, cached: 0, skipped: 0, failed: 0 };

   try {
      if (type.judges !== false && !openaiConfigured()) {
         throw new Error('OpenAI is not configured, so this agent has nothing to judge with.');
      }

      const rows = await type.collect(ctx);
      counts.collected = rows.length;
      report.say(`${rows.length} to look at`);
      await report.flush(true);

      const judgeStage = type.stages[type.stages.length - 1].key;
      report.stage(judgeStage, { total: rows.length });

      // What this agent found last time, so an unchanged item costs nothing.
      const previous = new Map();
      if (rows.length) {
         const seen = await AgentFinding.find({ definition: definition._id })
            .select('key cacheKey title detail score factors data recommendation subjectKind subjectId campaignable phoneNormalized')
            .lean();
         for (const f of seen) previous.set(f.key, f);
      }

      const findings = [];

      await inBatches(rows, AGENT_CONCURRENCY, async (row) => {
         if (report.stopped) return;
         try {
            const held = previous.get(row.key);
            if (shouldReuse(held, row)) {
               findings.push({ ...held, _id: undefined, run: run._id, definition: definition._id });
               counts.cached += 1;
               report.say(`${row.displayName} · unchanged since the last run`, 'skip');
            } else {
               const finding = await type.judge(row, ctx);
               if (!finding) {
                  counts.skipped += 1;
               } else {
                  findings.push({ ...finding, run: run._id, definition: definition._id });
                  counts.judged += 1;
               }
            }
         } catch (e) {
            counts.failed += 1;
            report.say(`${row.displayName || row.key} · ${e.message}`, 'error');
         } finally {
            report.step(judgeStage);
            await report.flush();
         }
      });

      /* Replaced wholesale rather than merged: a finding belongs to the run
         that produced it, and a person who no longer qualifies should stop
         appearing. What a human decided about them survives separately, in the
         state carried forward below. */
      const states = new Map();
      for (const f of await AgentFinding.find({ definition: definition._id })
         .select('key state snoozeUntil stateAt handledBy history').lean()) {
         if (f.state && f.state !== 'open') states.set(f.key, f);
      }
      for (const f of findings) {
         const held = carriedState(states.get(f.key), f.data, ctx.now);
         if (held) {
            f.state = held.state;
            f.snoozeUntil = held.snoozeUntil;
            f.stateAt = held.stateAt;
            f.handledBy = held.handledBy;
            f.history = held.history;
         }
      }

      await AgentFinding.deleteMany({ definition: definition._id });
      if (findings.length) await AgentFinding.insertMany(findings);

      const judged = counts.judged;
      await AgentRun.findByIdAndUpdate(run._id, {
         $set: {
            status: report.stopped ? 'stopped' : 'done',
            finishedAt: new Date(),
            counts,
            estimateUsd: type.judges === false ? 0 : Number(estimateCost(judged, model).toFixed(4)),
         },
      });
      report.say(report.stopped ? 'Stopped' : `Done · ${findings.length} finding(s)`);
      await report.flush(true);

      await AgentDefinition.updateOne({ _id: definition._id }, { $set: { lastRunAt: new Date() } });
      return { runId: run._id, counts, findings: findings.length, stopped: report.stopped };
   } catch (e) {
      report.say(e.message, 'error');
      await report.flush(true);
      await AgentRun.findByIdAndUpdate(run._id, {
         $set: { status: 'failed', finishedAt: new Date(), error: e.message, counts },
      });
      throw e;
   }
}
