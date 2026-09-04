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

import jwt from 'jsonwebtoken';
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
/**
 * The organisation on the request's token.
 *
 * Read here rather than taken from `req.user`, because this middleware is
 * mounted in front of every API route and `requireAuth` runs after it — so
 * `req.user` is not set yet when this needs to know. Relying on it meant every
 * request looked like an anonymous one, single mode pinned the deployment's
 * own database for all of them, and a customer signing in was shown the
 * landlord's contracts. That is the bug this function exists to prevent.
 *
 * This does not authorise anything: a bad token is simply "no organisation",
 * and `requireAuth` still refuses it a moment later.
 */
export function orgOnToken(req) {
   if (req.user?.org) return req.user.org;
   const header = req.headers.authorization || '';
   if (!header.startsWith('Bearer ')) return null;
   try {
      return jwt.verify(header.slice(7), process.env.JWT_SECRET)?.org ?? null;
   } catch {
      return null;
   }
}

export function withTenant(req, res, next) {
   const orgId = orgOnToken(req);

   /* Single mode serves the company that owns the deployment — and any
      customer created on it. A token carrying an organisation is honoured
      whatever the mode; without one, single mode falls back to the database
      from .env, which is every one of our own users. Multi mode has no
      fallback, because there is no "our own" there to fall back to. */
   if (tenancyMode() === 'single' && !orgId) {
      return runInTenant({ connection: connectionFor(legacyDbName()), org: legacyOrg() }, () => next());
   }

   /* No signed-in user yet. Signing in, signing up and the webhooks work out
      their own customer, because they have to — there is no token to read one
      from. They are not given a context here, so if one of them touches a
      database without choosing an organisation first, it throws rather than
      guessing. */
   if (!orgId) return next();

   loadOrganisation(orgId)
      .then((org) => {
         if (!org) return res.status(401).json({ error: 'Please sign in again.' });
         if (org.status === 'suspended') {
            return res.status(403).json({ error: 'This account is suspended. Please get in touch.' });
         }
         if (org.status !== 'trial' && org.status !== 'active') {
            return res.status(403).json({ error: 'This account is not active.' });
         }
         req.org = org;
         return runInTenant({ connection: connectionFor(org.dbName), org }, () => next());
      })
      .catch(next);
   return undefined;
}

/* The organisation, briefly remembered.
 *
 * Every request would otherwise be a second round trip to the control database
 * before it could start. Thirty seconds is short enough that a suspension takes
 * effect while somebody is still on the phone about it, and long enough that a
 * busy customer is not paying for the lookup on every click. */
const orgCache = new Map();
const ORG_CACHE_MS = 30_000;

async function loadOrganisation(id) {
   const held = orgCache.get(String(id));
   if (held && held.at > Date.now() - ORG_CACHE_MS) return held.org;
   const { organisationById } = await import('../tenancy/control.js');
   const org = await organisationById(id);
   orgCache.set(String(id), { org, at: Date.now() });
   return org;
}

/** After a change an owner made — suspending somebody should not wait. */
export function forgetOrganisation(id) {
   orgCache.delete(String(id));
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
   const { organisationsForJobs } = await import('../tenancy/control.js');
   return organisationsForJobs();
}
