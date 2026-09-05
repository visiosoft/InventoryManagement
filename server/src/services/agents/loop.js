import { AgentFinding, AgentOutcome, Task, User, Contract, nextTaskNo } from '../../models/index.js';
import { getAiBotConfig } from '../aiBot.js';
import { notifyTaskAssigned } from '../taskNotify.js';
import { agentType } from './engine.js';
import { loadThreads, suffix } from './shared.js';

/**
 * The loop that makes an agent worth running.
 *
 * A finding on a page is a report. A finding that becomes a task on the
 * board, due today, in the rep's own My Day, is work — and a record of what
 * happened next is the only way to know whether any of it mattered. Without
 * both halves the Agents page is a list nobody acts on and nobody can judge.
 *
 * Tasks are capped per run. "Today's five" gets done; "all 62" gets ignored.
 */

export const DEFAULT_TASKS_PER_RUN = 5;
/** How long after raising a task before the same person can be raised again.
 *  Two weeks is long enough for the first task to have been done or deliberately
 *  left, and short enough that a contract ending next month is not forgotten. */
export const TASK_COOLDOWN_DAYS = 14;

/**
 * Turn the top findings into tasks.
 *
 * Only for agents that say how (`taskFor`), only when the definition allows
 * it, and only for people not raised recently. The assignee is the agent's
 * own setting, falling back to whoever the assistant escalates to — the same
 * person who already gets "WhatsApp needs a human", so nothing lands on
 * somebody who was not expecting it.
 */
export async function raiseTasks(definition, findings, { report, now = new Date() }) {
   const type = agentType(definition.type);
   const config = { ...(type?.defaults || {}), ...(definition.config || {}) };
   if (!type?.taskFor || config.raiseTasks === false) return { raised: 0 };

   const assigneeId = config.assignTo || (await getAiBotConfig())?.escalateTo;
   const assignee = assigneeId
      ? await User.findById(assigneeId).select('_id name email role isActive').lean()
      : null;
   if (!assignee || assignee.isActive === false) {
      report?.say('No one to assign tasks to — set it on the agent, or set who the assistant escalates to', 'warn');
      return { raised: 0, reason: 'nobody to assign to' };
   }

   const perRun = Math.max(0, Number(config.tasksPerRun ?? DEFAULT_TASKS_PER_RUN));
   if (!perRun) return { raised: 0 };

   // Whoever was already raised recently is left alone this time.
   const since = new Date(now.getTime() - TASK_COOLDOWN_DAYS * 864e5);
   const recent = new Set(
      (await AgentOutcome.find({ definition: definition._id, kind: 'tasked', at: { $gte: since } })
         .select('key').lean()).map((o) => o.key),
   );

   const candidates = findings
      .filter((f) => f.state === 'open' && !recent.has(f.key))
      .sort((a, b) => b.score - a.score)
      .slice(0, perRun);

   const dueToday = new Date(now);
   dueToday.setHours(23, 59, 59, 999);

   let raised = 0;
   for (const f of candidates) {
      const spec = type.taskFor(f);
      if (!spec) continue;

      const task = await Task.create({
         taskNo: await nextTaskNo(),
         title: spec.title,
         description: spec.description || '',
         assignedTo: assignee._id,
         createdByName: `${definition.name} agent`,
         leadId: f.subjectId || null,
         leadType: spec.leadType || null,
         leadName: f.title,
         dueDate: dueToday,
         priority: spec.priority || 'medium',
         assignmentHistory: [{
            fromId: null, fromName: '',
            toId: assignee._id, toName: assignee.name || assignee.email,
            byId: null, byName: `${definition.name} agent`,
            reason: spec.reason || 'Raised by an agent',
         }],
      });

      await AgentFinding.updateOne({ _id: f._id }, { $set: { taskId: task._id } });
      await AgentOutcome.updateOne(
         { definition: definition._id, key: f.key, kind: 'tasked' },
         {
            $set: {
               agentType: definition.type, subjectKind: f.subjectKind, subjectId: f.subjectId,
               title: f.title, at: now, valueAed: f.data?.valueAed || 0, findingScore: f.score,
               taskId: task._id, detail: spec.title,
            },
         },
         { upsert: true },
      );

      // Emailed the same way a hand-made task would be; it decides for itself
      // whether this person is somebody who gets task emails.
      notifyTaskAssigned({ task, assignee, assignedByName: `${definition.name} agent` }).catch(() => {});

      report?.say(`${f.title} · task ${task.taskNo} for ${assignee.name}`);
      raised += 1;
   }

   if (raised) report?.say(`${raised} task(s) raised for ${assignee.name}, due today`);
   return { raised, assignee: assignee.name };
}

/**
 * What happened to the people an agent pointed at.
 *
 * Checked against the world rather than against anything a person typed: a
 * reply is a newer inbound message, a renewal is a newer contract. Each is
 * recorded once and kept even after the finding itself is replaced by the
 * next run, so the count only ever goes up and the page can say "14 of 62
 * renewed" a month later.
 */
export async function recordOutcomes(definition, { now = new Date() } = {}) {
   const type = agentType(definition.type);
   const tasked = await AgentOutcome.find({ definition: definition._id, kind: 'tasked' })
      .select('key subjectKind subjectId title at valueAed findingScore').lean();
   const findings = await AgentFinding.find({ definition: definition._id })
      .select('key subjectKind subjectId title createdAt data score').lean();

   /* Who is being watched: everyone with a task, plus everyone currently
      found. The moment of finding is the moment the clock starts. */
   const watched = new Map();
   for (const f of findings) {
      watched.set(f.key, { key: f.key, since: f.createdAt, subjectKind: f.subjectKind, subjectId: f.subjectId, title: f.title, valueAed: f.data?.valueAed || 0, score: f.score });
   }
   for (const t of tasked) {
      const held = watched.get(t.key);
      // The earlier moment wins — a task raised before the current finding.
      if (!held || new Date(t.at) < new Date(held.since)) {
         watched.set(t.key, { key: t.key, since: t.at, subjectKind: t.subjectKind, subjectId: t.subjectId, title: t.title, valueAed: t.valueAed, score: t.findingScore });
      }
   }
   if (!watched.size) return { recorded: 0, byKind: {} };

   const byKind = {};
   const record = async (w, kind, at, detail = '', valueAed = w.valueAed) => {
      const out = await AgentOutcome.updateOne(
         { definition: definition._id, key: w.key, kind },
         {
            $setOnInsert: {
               agentType: definition.type, subjectKind: w.subjectKind, subjectId: w.subjectId,
               title: w.title, at, valueAed, findingScore: w.score, detail,
            },
         },
         { upsert: true },
      );
      if (out.upsertedCount) byKind[kind] = (byKind[kind] || 0) + 1;
   };

   // Replied: anybody who wrote to us after they were found.
   const threads = await loadThreads({});
   const lastIn = new Map(threads.map((t) => [suffix(t._id), t.lastInboundAt]));
   for (const w of watched.values()) {
      const at = lastIn.get(w.key);
      if (at && new Date(at) > new Date(w.since)) await record(w, 'replied', at);
   }

   // Anything the agent itself knows how to see — a renewal, a signature.
   if (type?.outcomeFor) {
      const ctx = { now, contractsByCustomer: await contractsByCustomer() };
      for (const w of watched.values()) {
         const seen = type.outcomeFor(w, ctx);
         if (seen) await record(w, seen.kind, seen.at, seen.detail, seen.valueAed ?? w.valueAed);
      }
   }

   const recorded = Object.values(byKind).reduce((n, v) => n + v, 0);
   return { recorded, byKind };
}

async function contractsByCustomer() {
   const map = new Map();
   for (const c of await Contract.find({}).select('customer status startDate endDate rate leasedPrice contractNo createdAt').lean()) {
      const id = String(c.customer);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(c);
   }
   return map;
}

/**
 * The scoreboard for one or more agents.
 *
 * `kept` is the monthly value of the people who renewed or signed — the
 * figure that answers whether the agent pays for itself.
 */
export async function outcomeSummary(definitionIds) {
   const rows = await AgentOutcome.aggregate([
      { $match: { definition: { $in: definitionIds } } },
      { $group: { _id: { d: '$definition', k: '$kind' }, n: { $sum: 1 }, value: { $sum: '$valueAed' } } },
   ]);
   const by = new Map();
   for (const r of rows) {
      const id = String(r._id.d);
      if (!by.has(id)) by.set(id, { tasked: 0, replied: 0, renewed: 0, signed: 0, paid: 0, keptAed: 0 });
      const s = by.get(id);
      s[r._id.k] = r.n;
      if (r._id.k === 'renewed' || r._id.k === 'signed') s.keptAed += r.value;
      if (r._id.k === 'paid') s.keptAed += r.value;
   }
   return by;
}
