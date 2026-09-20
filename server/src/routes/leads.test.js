import test from 'node:test';
import assert from 'node:assert/strict';
import router from './leads.js';
import { runInTenant } from '../tenancy/context.js';

const ID = '507f1f77bcf86cd799439011';
const UPDATED = new Date('2026-09-20T10:00:00Z');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;

async function invoke({ body = {}, role = 'admin', owner = 'rep', race = false, path = '/:id/status', method = 'patch', query = {} } = {}) {
  const writes = [], taskWrites = [], filters = [];
  const lead = { _id: ID, fullName: 'Fixture', status: 'new', owner, updatedAt: UPDATED,
    firstResponseAt: null, timeline: [],
    async save() {
      if (race) { const error = new Error('No matching document'); error.name = 'DocumentNotFoundError'; throw error; }
      writes.push({ status: this.status, guard: this.$where });
    },
    isModified: () => false,
    async populate() { return this; },
  };
  const models = {
    Lead: {
      findById: async () => lead,
      find(filter) { filters.push(filter); return { select() { return this; }, populate() { return this; }, async lean() { return []; } }; },
    },
    Task: { async create(fields) { taskWrites.push(fields); return { ...fields, _id: 'task1' }; } },
  };
  let code = 200, result;
  const res = { status(value) { code = value; return this; }, json(value) { result = value; return this; } };
  await runInTenant({ connection: { model: name => { assert.ok(models[name], `unexpected model ${name}`); return models[name]; } } },
    () => handler(path, method)({ params: { id: ID }, body, query, user: { id: 'rep', role } }, res));
  return { code, result, lead, writes, taskWrites, filters };
}

test('status API enforces ownership even with a valid lead id', async () => {
  const result = await invoke({ body: { status: 'contacted' }, role: 'sales_rep', owner: 'someone_else' });
  assert.equal(result.code, 403);
  assert.equal(result.writes.length, 0);
});

test('status API rejects stale snapshots and database races without task side effects', async () => {
  for (const options of [
    { body: { status: 'contacted', expectedStatus: 'lost' } },
    { body: { status: 'contacted', expectedUpdatedAt: '2020-01-01T00:00:00Z' } },
    { body: { status: 'contacted', expectedStatus: 'new' }, race: true },
  ]) {
    const result = await invoke(options);
    assert.equal(result.code, 409);
    assert.equal(result.writes.length, 0);
    assert.equal(result.taskWrites.length, 0);
  }
});

test('status API records structured history and an atomic guard without changing first response', async () => {
  const result = await invoke({ body: { status: 'contacted', expectedStatus: 'new', expectedUpdatedAt: UPDATED.toISOString() } });
  assert.equal(result.code, 200);
  assert.deepEqual(result.writes[0].guard, { status: 'new', updatedAt: UPDATED });
  assert.equal(result.lead.firstResponseAt, null);
  assert.equal(result.lead.timeline[0].fromStatus, 'new');
  assert.equal(result.lead.timeline[0].toStatus, 'contacted');
  assert.equal(result.lead.timeline[0].user, 'rep');
});

test('status API rejects missing loss details and persists supplied details on the transition', async () => {
  assert.equal((await invoke({ body: { status: 'lost' } })).code, 400);
  const result = await invoke({ body: { status: 'lost', lossReason: 'competitor', lossCompetitor: 'Fixture competitor', reopenAt: '2099-01-01T00:00:00Z' } });
  assert.equal(result.code, 200);
  assert.equal(result.lead.lossReason, 'competitor');
  assert.equal(result.lead.timeline[0].lossCompetitor, 'Fixture competitor');
  assert.equal(result.lead.reopenAt.toISOString(), '2099-01-01T00:00:00.000Z');
});

test('status API schedules a task only after valid owner/date details are saved', async () => {
  assert.equal((await invoke({ body: { status: 'site_visit_scheduled' } })).code, 400);
  assert.equal((await invoke({ owner: null, body: { status: 'site_visit_scheduled', siteVisitAt: '2099-01-01T00:00:00Z' } })).code, 400);
  const result = await invoke({ body: { status: 'site_visit_scheduled', siteVisitAt: '2099-01-01T00:00:00Z' } });
  assert.equal(result.code, 200);
  assert.equal(result.taskWrites.length, 1);
  assert.equal(result.taskWrites[0].assignedTo, 'rep');
  assert.equal(result.writes[0].status, 'site_visit_scheduled');
});

test('funnel uses list filters, Dubai date boundaries and enforced rep ownership', async () => {
  const result = await invoke({ path: '/funnel', method: 'get', role: 'sales_rep', query: { owner: 'someone_else', source: 'whatsapp', nextAction: 'missing', from: '2026-09-01', to: '2026-09-20' } });
  assert.equal(result.code, 200);
  const filter = result.filters[0];
  assert.equal(filter.owner, 'rep');
  assert.equal(filter.source, 'whatsapp');
  assert.equal(filter.leadDateTime.$gte.toISOString(), '2026-08-31T20:00:00.000Z');
  assert.equal(filter.leadDateTime.$lte.toISOString(), '2026-09-20T19:59:59.999Z');
  assert.deepEqual(filter.$and.at(-1).status.$nin, ['won', 'lost', 'already_customer']);
});
