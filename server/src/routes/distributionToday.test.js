import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Lead, LeadRoutingConfig, WhatsAppMessage } from '../models/index.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { default: leadRoutes } = await import('./leads.js');
const chain = (rows) => { const c = { populate: () => c, select: () => c, sort: () => c, lean: async () => rows }; return c; };

test('distribution today: contacted = first response, an attempt, or a WhatsApp message after assignment', async () => {
  const at = new Date();
  const lead = (id, owner, extra = {}) => ({ _id: id, owner: { _id: owner, name: owner }, assignedAt: new Date(at.getTime() - 3600_000), firstResponseAt: null, attempts: [], phoneNormalized: id, status: 'new', ...extra });
  LeadRoutingConfig.findOne = () => ({ lean: async () => ({ enabled: true }) });
  const mk = (id, owner, extra = {}) => ({ ...lead(id, owner, extra), autoAssigned: true });
  Lead.find = () => chain([mk('a', 'Sara', { firstResponseAt: new Date(at.getTime() - 3000_000) }), mk('b', 'Sara'), mk('c', 'Omar', { attempts: [{ at: new Date(at.getTime() - 1800_000) }] }), mk('d', 'Omar'), { _id: 'e', owner: null, autoAssigned: false, phoneNormalized: 'e', status: 'new', attempts: [] }, { ...lead('f', 'Sara'), autoAssigned: false }]);
  Lead.countDocuments = async () => 3;
  WhatsAppMessage.find = () => chain([{ phoneNormalized: 'b', occurredAt: new Date(at.getTime() - 2400_000) }]);
  const app = express();
  app.use((req, res, next) => { req.user = { id: 'u', role: 'admin' }; next(); });
  app.use('/', leadRoutes);
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/distribution-today`);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.newLeadsToday, 6);
    assert.equal(j.distributedByRules, 4);
    assert.equal(j.assignedByHand, 1);
    assert.equal(j.waitingUnassigned, 1);
    assert.equal(j.reassignedFromEarlier, 3);
    // the tiles add up: new = by rules + by hand + unassigned
    assert.equal(j.newLeadsToday, j.distributedByRules + j.assignedByHand + j.waitingUnassigned);
    assert.equal(j.contacted, 3);
    assert.equal(j.waiting, 1);
    assert.equal(j.waitingOver30Min, 1);
    assert.equal(j.contactedPct, 75);
    assert.equal(j.reps.find((r) => r.rep === 'Sara').contacted, 2);
  } finally { srv.close(); }
});
