/**
 * One socket pool, many databases.
 *
 * A customer per database could mean a connection pool per customer, and Atlas
 * counts connections rather than databases — a hundred customers would exhaust
 * the cluster long before their data did. `useDb` avoids that: it returns a
 * connection bound to another database name that reuses the underlying socket
 * pool of the connection it came from. One pool, whatever the number of
 * customers.
 *
 * Connections are cached because compiling 55 models is not free and a busy
 * customer would otherwise pay for it on every request.
 */

import mongoose from 'mongoose';
import { registerModels } from '../models/index.js';

/** The pool everything else hangs off. Set once, at boot. */
let base = null;

/** dbName -> connection, models already compiled. */
const cache = new Map();

/**
 * Take the connection the app has already opened and use it as the pool.
 *
 * The existing boot in db.js does the connecting, with its DNS workaround for
 * Atlas and its retry behaviour; this only takes what it produced. Two ways to
 * connect to the same cluster would be two things to keep in step.
 */
export function useBaseConnection(connection) {
   base = connection;
   cache.clear();
   return base;
}

export function baseConnection() {
   if (!base) throw new Error('The database pool has not been opened yet');
   return base;
}

/**
 * The connection for one organisation's database, models registered.
 *
 * Safe to call on every request: after the first, this is a map lookup.
 */
export function connectionFor(dbName) {
   if (!dbName) throw new Error('An organisation has no database name');
   const held = cache.get(dbName);
   if (held) return held;

   const connection = baseConnection().useDb(dbName, { useCache: true });
   registerModels(connection);
   cache.set(dbName, connection);
   return connection;
}

/** For tests and for the owner console, which reports what is open. */
export function openDatabases() {
   return [...cache.keys()];
}

/**
 * Forget one database's connection.
 *
 * Wanted when an organisation is deleted or its database is re-seeded — the
 * demo is wiped nightly — so nothing keeps using models compiled against a
 * database that is no longer the same one.
 */
export function forgetDatabase(dbName) {
   cache.delete(dbName);
}
