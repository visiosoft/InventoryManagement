/**
 * Running the scheduled work once per customer.
 *
 * Fourteen jobs sweep the database on timers — digests, follow-ups, the lead
 * clock, backups, the assistant. Every one of them was written when there was
 * a single company, so each simply queried everything it could see. With a
 * database per customer each has to be run once per organisation, inside that
 * organisation's context.
 *
 * The jobs themselves do not change. This wraps them.
 *
 * Three properties that matter more than they look:
 *
 *   One customer cannot stop the others. Each organisation's turn is wrapped
 *   in its own try/catch, because a broken integration at one company must not
 *   silence everybody else's morning brief.
 *
 *   Sequential, not parallel. Fourteen jobs times N organisations against one
 *   Atlas pool is a good way to exhaust it; these are timers with minutes to
 *   spare, and nothing here is worth a thundering herd.
 *
 *   Every log line says who it was for. A message about a failed send is
 *   useless if you cannot tell which customer it belonged to.
 */

import { activeOrganisations, withTenantFor } from '../middleware/tenant.js';

/**
 * Run one job for every organisation that should have it.
 *
 * @param name  what to call it in the log
 * @param work  async (org) => void, run inside that organisation's context
 */
export async function forEachOrg(name, work) {
   let orgs = [];
   try {
      orgs = await activeOrganisations();
   } catch (e) {
      console.error(`[${name}] could not list organisations:`, e.message);
      return;
   }

   for (const org of orgs) {
      try {
         await withTenantFor(org, () => work(org));
      } catch (e) {
         // Named, so the line is actionable, and swallowed, so the next
         // organisation still gets its turn.
         console.error(`[${name}][${org?.slug ?? 'unknown'}]`, e.message);
      }
   }
}

/**
 * A timer that runs a job for every organisation.
 *
 * Returns the interval handle so a caller can clear it, and takes the same
 * staggered start the jobs already used — nothing needs all fourteen firing in
 * the same second as the process comes up.
 */
export function everyOrg(name, work, { every, delay = 0 }) {
   const tick = () => { forEachOrg(name, work).catch((e) => console.error(`[${name}]`, e.message)); };
   if (delay > 0) {
      setTimeout(() => { tick(); setInterval(tick, every); }, delay);
      return null;
   }
   return setInterval(tick, every);
}
