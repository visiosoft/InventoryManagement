import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedDatabase } from './protected.js';

/* The live company's data predates all of this.
 *
 * Two paths in the multi-tenant code can destroy or overwrite a whole
 * database: provisioning, which seeds one, and the delete button, which drops
 * one. Both ask this first. The cost of it being wrong is unrecoverable, so it
 * is tested for what it must refuse rather than what it should allow.
 */

test('the live database is never a customer database', () => {
   process.env.DB_NAME = 'PurpleBoxNew';
   assert.equal(isProtectedDatabase('PurpleBoxNew'), true);
   assert.equal(isProtectedDatabase('org_PurpleBoxNew'), false, 'the prefix is what marks ours');
});

test('the directory of customers is protected too', () => {
   // Dropping it loses every customer's routing while leaving all of their
   // data behind, unreachable — the worst of both.
   assert.equal(isProtectedDatabase(process.env.CONTROL_DB_NAME || 'purplebox_control'), true);
});

test("MongoDB's own databases are refused", () => {
   for (const db of ['admin', 'local', 'config']) assert.equal(isProtectedDatabase(db), true, db);
});

test('anything without the prefix is refused, whatever it is called', () => {
   // The other applications sharing this cluster.
   for (const db of ['Maktab', 'TravelERP', 'fleet-management', 'QurbaniDb', 'Thermovex']) {
      assert.equal(isProtectedDatabase(db), true, db);
   }
});

test('nothing, empty or missing is refused rather than defaulted', () => {
   for (const db of ['', '   ', null, undefined]) assert.equal(isProtectedDatabase(db), true, String(db));
});

test('a real customer database is allowed, or nothing could be created', () => {
   assert.equal(isProtectedDatabase('org_acme-storage'), false);
   assert.equal(isProtectedDatabase('org_1d13e4f4116e'), false);
});

test('a deployment can name more of its own', () => {
   process.env.PROTECTED_DATABASES = 'org_never-touch-this, org_archive';
   assert.equal(isProtectedDatabase('org_never-touch-this'), true);
   assert.equal(isProtectedDatabase('org_archive'), true);
   assert.equal(isProtectedDatabase('org_acme-storage'), false);
   delete process.env.PROTECTED_DATABASES;
});
