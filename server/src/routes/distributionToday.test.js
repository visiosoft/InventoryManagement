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
  Lead.find = () => chain([lead('a', 'Sara', { firstResponseAt: new Date(at.getTime() - 3000_000) }), lead('b', 'Sara'), lead('c', 'Omar', { attempts: [{ at: new Date(at.getTime() - 1800_000) }] }), lead('d', 'Omar')]);
  Lead.countDocuments = async () => 2;
  WhatsAppMessage.find = () => chain([{ phoneNormalized: 'b', occurredAt: new Date(at.getTime() - 2400_000) }]);
  const app = express();
  app.use((req, res, next) => { req.user = { id: 'u', role: 'admin' }; next(); });
  app.use('/', leadRoutes);
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/distribution-today`);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.distributedByRules, 4);
    assert.equal(j.contacted, 3);
    assert.equal(j.waiting, 1);
    assert.equal(j.waitingOver30Min, 1);
    assert.equal(j.contactedPct, 75);
    assert.equal(j.reps.find((r) => r.rep === 'Sara').contacted, 2);
  } finally { srv.close(); }
});
