import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Unit, Contract, User } from '../models/index.js';
import { MaintenanceTicket, MaintenanceTicketHistory, nextTicketNo, TICKET_CATEGORIES, TICKET_SEVERITIES, OPEN_STATUSES } from '../models/maintenance.js';
import { slaDue, slaState, canMove, statusAfterLastTicket, blocksUnit, suggestSeverity } from '../services/maintenance.js';
import { pushToUser } from '../services/push.js';

/**
 * Maintenance tickets (WP-11): why a unit is out of use, who fixes it, by
 * when, at what cost. Every status change writes a history row. A unit's
 * status changes only through a ticket here, and only as the rules say:
 * an S1/S2 ticket on a unit no contract covers takes it out of use; closing
 * its last open ticket puts it back (occupied if a contract covers it).
 */

const router = Router();
const who = (req) => ({ user: req.user?.id || null, userName: req.user?.name || req.user?.email || '' });

const coveredUnitIds = async (unitIds, now = new Date()) => {
   const cs = await Contract.find({ status: 'active', startDate: { $lte: now }, endDate: { $gte: now }, $or: [{ unit: { $in: unitIds } }, { units: { $in: unitIds } }] }).select('unit units').lean();
   return new Set(cs.flatMap((c) => [c.unit, ...(c.units || [])]).filter(Boolean).map(String));
};

const history = (ticket, fromStatus, toStatus, req, note = '') =>
   MaintenanceTicketHistory.create({ ticket: ticket._id, fromStatus, toStatus, note: String(note || '').slice(0, 500), ...who(req) });

const view = (t, now = new Date()) => ({ ...t, sla: slaState(t, now) });

router.get('/', async (req, res) => {
   const q = {};
   if (req.query.status === 'open') q.status = { $in: OPEN_STATUSES };
   else if (req.query.status) q.status = String(req.query.status);
   if (req.query.severity) q.severity = String(req.query.severity);
   if (req.query.unit) q.units = req.query.unit;
   const rows = await MaintenanceTicket.find(q).sort({ createdAt: -1 }).limit(500)
      .populate('units', 'unitNumber sizeSqf status').populate('owner', 'name').populate('vendor', 'name').lean();
   res.json({ tickets: rows.map((t) => view(t)), categories: TICKET_CATEGORIES, severities: TICKET_SEVERITIES });
});

// Units in maintenance with no open ticket — what the backfill would cover.
const untracked = async () => {
   const units = await Unit.find({ status: 'maintenance' }).select('unitNumber sizeSqf site').lean();
   const open = await MaintenanceTicket.find({ status: { $in: OPEN_STATUSES }, units: { $in: units.map((u) => u._id) } }).select('units').lean();
   const has = new Set(open.flatMap((t) => t.units.map(String)));
   return units.filter((u) => !has.has(String(u._id)));
};

router.get('/summary', async (_req, res) => {
   const now = new Date();
   const open = await MaintenanceTicket.find({ status: { $in: OPEN_STATUSES } }).select('status severity resolveDueAt createdAt').lean();
   const byStatus = {}; const bySeverity = {}; let overdue = 0;
   for (const t of open) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      bySeverity[t.severity] = (bySeverity[t.severity] || 0) + 1;
      if (slaState(t, now) === 'overdue') overdue += 1;
   }
   const missing = await untracked();
   res.json({ open: open.length, byStatus, bySeverity, overdue, unitsInMaintenanceWithoutTicket: missing.length });
});

router.post('/suggest-severity', (req, res) => res.json({ severity: suggestSeverity(req.body?.description) }));

router.post('/', async (req, res) => {
   const unitIds = (Array.isArray(req.body?.unitIds) ? req.body.unitIds : []).map(String).slice(0, 50);
   const severity = TICKET_SEVERITIES.includes(req.body?.severity) ? req.body.severity : null;
   const category = TICKET_CATEGORIES.includes(req.body?.category) ? req.body.category : 'general';
   const description = String(req.body?.description || '').trim().slice(0, 2000);
   if (!unitIds.length) return res.status(400).json({ error: 'Pick at least one unit' });
   if (!severity) return res.status(400).json({ error: 'Choose a severity (S1–S4)' });
   if (description.length < 3) return res.status(400).json({ error: 'Describe the problem' });
   const units = await Unit.find({ _id: { $in: unitIds } }).select('unitNumber status site').lean();
   if (units.length !== unitIds.length) return res.status(400).json({ error: 'One of those units does not exist' });
   const now = new Date();
   const ticket = await MaintenanceTicket.create({
      ticketNo: await nextTicketNo(), site: units[0].site || null, units: unitIds, category, severity, description,
      createdBy: req.user?.id || null, ...slaDue(severity, now),
   });
   await history(ticket, '', 'open', req, 'Created');
   // A unit nobody rents right now goes out of use for a serious fault.
   if (blocksUnit(severity)) {
      const covered = await coveredUnitIds(unitIds, now);
      const free = units.filter((u) => !covered.has(String(u._id)) && u.status !== 'maintenance').map((u) => u._id);
      if (free.length) await Unit.updateMany({ _id: { $in: free } }, { $set: { status: 'maintenance' } });
   }
   if (severity === 'S1') {
      const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
      const body = `${ticket.ticketNo} · ${units.map((u) => u.unitNumber).join(', ')} · ${description.slice(0, 120)}`;
      await Promise.all(admins.map((a) => pushToUser(a._id, { title: 'S1 maintenance ticket', body, url: '/maintenance' })));
   }
   res.status(201).json({ ticket: view(ticket.toObject()) });
});

router.patch('/:id/status', async (req, res) => {
   const to = String(req.body?.status || '');
   const t = await MaintenanceTicket.findById(req.params.id);
   if (!t) return res.status(404).json({ error: 'Ticket not found' });
   if (!canMove(t.status, to)) return res.status(400).json({ error: `A ${t.status.replace('_', ' ')} ticket cannot move to ${to.replace('_', ' ')}` });
   const from = t.status;
   const now = new Date();
   t.status = to;
   if (from === 'open' && !t.respondedAt) t.respondedAt = now;
   if (to === 'resolved') t.resolvedAt = now;
   if (to === 'closed') { t.closedAt = now; if (!t.resolvedAt) t.resolvedAt = now; }
   if (req.body?.costActual != null && Number.isFinite(Number(req.body.costActual))) t.costActual = Number(req.body.costActual);
   await t.save();
   await history(t, from, to, req, req.body?.note);
   // The last open ticket on a unit in maintenance closes: the unit comes back.
   let released = [];
   if (['resolved', 'closed'].includes(to)) {
      const stillOpen = await MaintenanceTicket.find({ _id: { $ne: t._id }, status: { $in: OPEN_STATUSES }, units: { $in: t.units } }).select('units').lean();
      const busy = new Set(stillOpen.flatMap((x) => x.units.map(String)));
      const free = t.units.map(String).filter((id) => !busy.has(id));
      const covered = await coveredUnitIds(free, now);
      const inMaint = await Unit.find({ _id: { $in: free }, status: 'maintenance' }).select('_id unitNumber').lean();
      for (const u of inMaint) {
         const status = statusAfterLastTicket(covered.has(String(u._id)));
         await Unit.updateOne({ _id: u._id, status: 'maintenance' }, { $set: { status } });
         released.push({ unit: u.unitNumber, status });
      }
   }
   res.json({ ticket: view(t.toObject()), released });
});

router.post('/:id/assign', async (req, res) => {
   const t = await MaintenanceTicket.findById(req.params.id);
   if (!t) return res.status(404).json({ error: 'Ticket not found' });
   if (['resolved', 'closed'].includes(t.status)) return res.status(400).json({ error: 'This ticket is finished' });
   const { owner, vendor, costEstimate } = req.body || {};
   if (!owner && !vendor) return res.status(400).json({ error: 'Assign a person or a vendor' });
   if (owner) t.owner = owner;
   if (vendor) t.vendor = vendor;
   if (costEstimate != null && Number.isFinite(Number(costEstimate))) t.costEstimate = Number(costEstimate);
   const from = t.status;
   if (from === 'open') { t.status = 'assigned'; t.respondedAt = t.respondedAt || new Date(); }
   await t.save();
   if (from !== t.status) await history(t, from, t.status, req, req.body?.note || 'Assigned');
   res.json({ ticket: view(t.toObject()), note: Number(t.costEstimate) > 1000 ? 'Estimated cost is above AED 1,000 — this needs approval.' : undefined });
});

router.get('/:id/history', async (req, res) => {
   res.json({ history: await MaintenanceTicketHistory.find({ ticket: req.params.id }).sort({ at: 1 }).lean() });
});

// Backfill (spec step 3): one S3 "general" ticket per unit already in
// maintenance with no open ticket. Preview first; runs only when an admin asks.
router.get('/backfill', requireAdmin, async (_req, res) => {
   const units = await untracked();
   res.json({ units: units.map((u) => ({ id: u._id, unitNumber: u.unitNumber, sizeSqf: u.sizeSqf })), count: units.length });
});

router.post('/backfill', requireAdmin, async (req, res) => {
   if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the backfill' });
   const units = await untracked();
   const now = new Date();
   const made = [];
   for (const u of units) {
      const t = await MaintenanceTicket.create({
         ticketNo: await nextTicketNo(), site: u.site || null, units: [u._id], category: 'general', severity: 'S3',
         description: 'Backfilled. Triage required.', createdBy: req.user?.id || null, backfilled: true, ...slaDue('S3', now),
      });
      await history(t, '', 'open', req, 'Backfilled');
      made.push(t.ticketNo);
   }
   res.json({ ok: true, created: made.length });
});

export default router;
