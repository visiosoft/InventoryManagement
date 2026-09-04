/**
 * Putting each request in front of the right customer's database.
 *
 * Two modes, one codebase — which is the point. The live PurpleBox deployment
 * must keep working exactly as it does today while the SaaS is built beside
 * it, and the way to do that without maintaining two forks is a flag rather
 * than a branch.
 *
 *   single   every request is served from the database named in .env, and
 *            credentials keep coming from the environment. This is the
 *            deployment that exists today; behaviour is unchanged.
 *   multi    the organisation comes from the signed-in user, and each has
 *            their own database.
 *
 * In both modes a request ends up inside a tenant context, so the code below
 * the middleware never knows or cares which mode it is running in.
 */

import { connectionFor } from '../tenancy/connections.js';
import { runInTenant } from '../tenancy/context.js';

/** 'single' until a deployment says otherwise, so an existing install that
 *  knows nothing about this keeps behaving as it did. */
export const tenancyMode = () => (process.env.TENANCY_MODE === 'multi' ? 'multi' : 'single');

/** The one database a single-tenant deployment serves. */
const legacyDbName = () => process.env.DB_NAME || 'PurpleBox';

/** The organisation a single-tenant deployment reports itself as, so code that
 *  logs or labels by organisation has something true to say. */
const legacyOrg = () => ({ id: 'single', slug: 'single', name: process.env.COMPANY_NAME || 'PurpleBox' });

/**
 * Enter the tenant context for this request.
 *
 * Mounted after whatever established who is asking. In multi mode that is
 * `requireAuth`, which puts the organisation on the token; in single mode
 * nothing is needed, because there is only one.
 */
export function withTenant(req, res, next) {
   if (tenancyMode() === 'single') {
      return runInTenant({ connection: connectionFor(legacyDbName()), org: legacyOrg() }, () => next());
   }

   const orgId = req.user?.org;
   if (!orgId) {
      /* A token issued before organisations existed. Rejected rather than
         guessed at: signing in again is a small inconvenience, and picking a
         database for somebody is not a thing to do on a hunch. */
      return res.status(401).json({ error: 'Please sign in again.' });
   }

   // Resolved from the control database in Phase 1's org-aware login; until
   // then multi mode is not something a deployment can switch on.
   const org = req.org;
   if (!org) return res.status(401).json({ error: 'Please sign in again.' });
   if (org.status === 'suspended') {
      return res.status(403).json({ error: 'This account is suspended. Please get in touch.' });
   }

   return runInTenant({ connection: connectionFor(org.dbName), org }, () => next());
}

/**
 * Run something outside a request in one organisation's context.
 *
 * For background jobs and scripts, which have no `req` to take an organisation
 * from. In single mode there is exactly one to run for.
 */
export function withTenantFor(org, fn) {
   if (tenancyMode() === 'single') {
      return runInTenant({ connection: connectionFor(legacyDbName()), org: legacyOrg() }, fn);
   }
   return runInTenant({ connection: connectionFor(org.dbName), org }, fn);
}

/** Every organisation a scheduled job should sweep. One, for now. */
export async function activeOrganisations() {
   if (tenancyMode() === 'single') return [legacyOrg()];
   // Phase 1 replaces this with the control database's list.
   return [];
}
