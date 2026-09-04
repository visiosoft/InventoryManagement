/**
 * Databases this code may never create, seed, or drop.
 *
 * The live company's data predates all of this. It is not a customer, it was
 * not provisioned, and nothing in the multi-tenant machinery has any business
 * writing to it beyond what the application already did — so the two paths
 * that could destroy or overwrite a whole database ask here first.
 *
 * Belt and braces on top of the `org_` prefix. The prefix already makes a
 * collision impossible, because nothing that existed before carries it. This
 * exists because the cost of that reasoning turning out to be wrong — a new
 * customer seeded over a live company, or a delete button reaching the wrong
 * database — is unrecoverable, and the check is one line.
 */

/** Everything that is not ours to destroy. */
export function protectedDatabases() {
   return new Set([
      // The database this deployment serves in single mode.
      process.env.DB_NAME || 'PurpleBox',
      // The directory of customers. Dropping it loses every customer's routing
      // while leaving all their data behind, unreachable.
      process.env.CONTROL_DB_NAME || 'purplebox_control',
      // MongoDB's own.
      'admin', 'local', 'config',
      // Anything a deployment wants to name explicitly.
      ...String(process.env.PROTECTED_DATABASES || '').split(',').map((s) => s.trim()).filter(Boolean),
   ]);
}

/**
 * May this database be created, seeded or dropped as a customer's?
 *
 * Two tests, and either is enough to refuse: it is named as protected, or it
 * does not carry the prefix every customer database is given at creation.
 */
export function isProtectedDatabase(name) {
   const db = String(name || '').trim();
   if (!db) return true;
   if (protectedDatabases().has(db)) return true;
   return !/^org_/.test(db);
}
