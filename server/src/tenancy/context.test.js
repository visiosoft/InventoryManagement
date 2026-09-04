import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runInTenant, currentConnection, currentOrg, hasTenant } from './context.js';
import { SCHEMAS, registerModels } from '../models/index.js';

/* Two databases that never connect. Mongoose compiles models and answers
   questions about them without a server; only a query would need one, and
   none of these run a query. That keeps the test honest about isolation
   without making it depend on Atlas being reachable. */
const cluster = mongoose.createConnection();
const acme = registerModels(cluster.useDb('org_acme', { useCache: true }));
const bravo = registerModels(cluster.useDb('org_bravo', { useCache: true }));

const asAcme = (fn) => runInTenant({ connection: acme, org: { slug: 'acme' } }, fn);
const asBravo = (fn) => runInTenant({ connection: bravo, org: { slug: 'bravo' } }, fn);

test('a database is never handed out without an organisation', () => {
   /* The single most important behaviour here. If this ever returns something
      instead of throwing, every isolation guarantee in the system is gone:
      code that forgot to say who it was acting for would read whichever
      database happened to be lying around. */
   assert.throws(() => currentConnection(), /No organisation in context/);
   assert.equal(hasTenant(), false);
   assert.equal(currentOrg(), null);
});

test('the same import reaches a different database for each organisation', async () => {
   const { Contract } = await import('../models/index.js');
   asAcme(() => assert.equal(Contract.db.name, 'org_acme'));
   asBravo(() => assert.equal(Contract.db.name, 'org_bravo'));
});

test('every model follows the organisation, not just the ones anybody checked', async () => {
   /* Driven off the schema list rather than a hand-written set, so a model
      added next year is covered by this test without anybody remembering. */
   const models = await import('../models/index.js');
   const names = Object.keys(SCHEMAS);
   assert.ok(names.length >= 55, `expected the full model list, got ${names.length}`);

   for (const name of names) {
      const model = models[name];
      assert.ok(model, `${name} is not exported`);
      asAcme(() => assert.equal(model.db.name, 'org_acme', `${name} escaped to ${model.db.name}`));
      asBravo(() => assert.equal(model.db.name, 'org_bravo', `${name} escaped to ${model.db.name}`));
      assert.throws(() => model.modelName, /No organisation in context/, `${name} answered with no context`);
   }
});

test('a context survives an await, which is where one would be lost', async () => {
   await asAcme(async () => {
      assert.equal(currentOrg().slug, 'acme');
      await new Promise((r) => setTimeout(r, 5));
      // If AsyncLocalStorage did not follow the await, this is where a request
      // would quietly start reading somebody else's database.
      assert.equal(currentOrg().slug, 'acme');
      assert.equal(currentConnection().name, 'org_acme');
   });
});

test('contexts do not bleed between overlapping work', async () => {
   /* Two organisations interleaved on purpose: the shape of a busy server, and
      the thing that would break if the connection were held in a module
      variable rather than beside the call stack. */
   const seen = [];
   await Promise.all([
      asAcme(async () => { await new Promise((r) => setTimeout(r, 10)); seen.push(currentOrg().slug); }),
      asBravo(async () => { await new Promise((r) => setTimeout(r, 5)); seen.push(currentOrg().slug); }),
      asAcme(async () => { await new Promise((r) => setTimeout(r, 1)); seen.push(currentOrg().slug); }),
   ]);
   assert.deepEqual(seen.sort(), ['acme', 'acme', 'bravo']);
});

test('the models a connection carries are its own', () => {
   // populate resolves a reference against the connection that owns the
   // document, so a half-registered connection fails later, on one query.
   for (const name of Object.keys(SCHEMAS)) {
      assert.ok(acme.models[name], `${name} missing from org_acme`);
      assert.ok(bravo.models[name], `${name} missing from org_bravo`);
      assert.notEqual(acme.models[name], bravo.models[name], `${name} is shared between organisations`);
   }
});
