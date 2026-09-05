import { AgentDefinition } from '../../models/index.js';
import { runAgent, agentType } from './engine.js';
import { dayKeyFor, localHour } from '../dailyDigest.js';
// Imported here as well as by the route: a schedule that fires into an empty
// catalogue does nothing and says nothing, which is the worst way to fail.
import './types/index.js';

/**
 * Agents that have come due.
 *
 * Every schedule is **off** until somebody turns it on, which is the same
 * choice `autoSummarise` made: an agent that starts sweeping every
 * conversation before anybody has looked at what it produces is how a
 * surprising bill arrives, and how a feature stops being trusted before it has
 * been used.
 *
 * Idempotent through `lastScheduledDay` rather than a timer, so a restart
 * during the scheduled hour cannot run the same agent twice.
 */

export function isDue(definition, { now = new Date() } = {}) {
   if (!definition?.enabled) return false;

   const { mode, hour = 7, weekday = 1 } = definition.schedule || {};
   if (mode !== 'daily' && mode !== 'weekly') return false;

   if (localHour(now) !== Number(hour)) return false;

   const today = dayKeyFor(now);
   if (definition.lastScheduledDay === today) return false;

   if (mode === 'weekly') {
      // The local day, not UTC's — a Monday schedule should mean Monday here.
      const local = new Date(new Date(now).getTime() + 4 * 3600_000);
      if (local.getUTCDay() !== Number(weekday)) return false;
   }

   return true;
}

/**
 * Run whatever is due, one at a time.
 *
 * Sequentially on purpose: each agent is already sweeping five conversations
 * at a time, and three agents starting together would put fifteen requests in
 * flight and earn a rate-limit rejection for all of them.
 */
export async function runDueAgents({ now = new Date() } = {}) {
   const defs = await AgentDefinition.find({ enabled: true, 'schedule.mode': { $in: ['daily', 'weekly'] } });
   const ran = [];

   for (const def of defs) {
      if (!isDue(def, { now })) continue;
      if (!agentType(def.type)) continue;

      /* Claimed before it runs, not after. A sweep takes minutes, and the
         minute tick would otherwise start it again while it was still going. */
      const claimed = await AgentDefinition.findOneAndUpdate(
         { _id: def._id, lastScheduledDay: { $ne: dayKeyFor(now) } },
         { $set: { lastScheduledDay: dayKeyFor(now) } },
      );
      if (!claimed) continue;

      try {
         await runAgent(def, { trigger: 'schedule', startedByName: 'Schedule' });
         ran.push(def.key);
      } catch (e) {
         // One agent's bad day is not every agent's.
         console.error(`[Agents] ${def.key}:`, e.message);
      }
   }

   return { ran };
}
