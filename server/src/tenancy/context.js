/**
 * Which company the code is currently working for.
 *
 * Every customer of PurpleBox gets their own database. Nothing in the
 * application says which one to use — 90 files import models directly
 * (`import { Contract } from '../models/index.js'`) and hundreds of queries
 * were written when there was only ever one company. Rewriting all of them to
 * carry a handle would be an enormous change, and a single missed call would
 * silently read another customer's records.
 *
 * So the connection travels beside the call stack instead, in an
 * AsyncLocalStorage. A request enters a context once; everything it goes on to
 * do — awaits, timers scheduled inside it, promise chains — stays inside it,
 * and the model proxies in models/index.js resolve against whatever connection
 * is in scope at the moment they are used.
 *
 * The important property is the failure mode. Code that runs outside a context
 * does not fall back to a default database: it throws. There is no "sensible
 * default" here that would not, sooner or later, be one customer reading
 * another's contracts.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run `fn` against one organisation's database.
 *
 * Everything awaited inside inherits the context, so a route handler enters it
 * once and every service it calls is already in the right place.
 *
 * @param connection a mongoose connection with the models registered on it
 * @param org        {id, slug, name} — for logs and for code that needs to
 *                   know who it is acting for without another lookup
 */
export function runInTenant({ connection, org }, fn) {
   if (!connection) throw new Error('runInTenant needs a connection');
   return storage.run({ connection, org: org ?? null }, fn);
}

/**
 * The connection for the organisation being served.
 *
 * Throws outside a context, deliberately and loudly. If this ever returns
 * something by default, every isolation guarantee in the system is gone.
 */
export function currentConnection() {
   const store = storage.getStore();
   if (!store?.connection) {
      throw new Error(
         'No organisation in context: a database was asked for outside a tenant scope. '
         + 'A request must pass through requireAuth, and a background job must use runInTenant.',
      );
   }
   return store.connection;
}

/** Who we are acting for, or null outside a context. Never throws — callers
 *  use it for logging, where an exception would be worse than a blank. */
export function currentOrg() {
   return storage.getStore()?.org ?? null;
}

/** Whether there is a context at all, for code that can legitimately do
 *  nothing when there is none. */
export function hasTenant() {
   return Boolean(storage.getStore()?.connection);
}
