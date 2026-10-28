import { Router } from 'express';
import { Contract } from '../models/index.js';
import { ApprovalRule, ApprovalRequest } from '../models/approvals.js';
import { ensureRules } from '../services/approvals.js';

/**
 * The approval queue and its rules (WP-04). An approver is a person with the
 * rule's role who did not ask for the change; approving re-applies the very
 * edit that was held, through the normal contract update. Requests older
 * than 7 days expire and must be sent again.
 */
const router = Router();
const EXPIRY = 7 * 86_400_000;
const who = (req) => req.user?.name || req.user?.email || '';

router.get('/', async (req, res) => {
   await ApprovalRequest.updateMany({ status: 'pending', createdAt: { $lt: new Date(Date.now() - EXPIRY) } }, { $set: { status: 'expired' } });
   const status = ['pending', 'approved', 'rejected', 'expired'].includes(req.query.status) ? req.query.status : 'pending';
   res.json({ requests: await ApprovalRequest.find({ status }).sort({ createdAt: -1 }).limit(200).lean() });
});

router.post('/:id/approve', async (req, res) => {
   const r = await ApprovalRequest.findById(req.params.id);
   if (!r || r.status !== 'pending') return res.status(404).json({ error: 'No pending request' });
   if (Date.now() - r.createdAt > EXPIRY) { r.status = 'expired'; await r.save(); return res.status(409).json({ error: 'This request expired; it must be sent again' }); }
   const rule = await ApprovalRule.findById(r.rule).lean();
   if (req.user?.role !== (rule?.requiredRole || 'admin')) return res.status(403).json({ error: 'You cannot approve this' });
   if (String(r.requestedBy) === String(req.user?.id)) return res.status(403).json({ error: 'Someone else has to approve your own request' });
   r.status = 'approved'; r.decidedBy = who(req); r.decidedAt = new Date(); r.note = String(req.body?.note || '').slice(0, 500);
   await r.save();
   const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
   const out = await fetch(`${base}/contracts/${r.entityId}`, { method: 'PUT', headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r.proposed, __approvalId: String(r._id) }) });
   if (!out.ok) {
      const err = await out.json().catch(() => ({}));
      r.status = 'pending'; r.decidedBy = ''; r.decidedAt = null; await r.save();
      return res.status(400).json({ error: `Could not apply it: ${err.error || out.status}` });
   }
   await Contract.updateOne({ _id: r.entityId }, { $set: { approvalStatus: 'approved', approvedBy: who(req), approvedAt: new Date() }, $push: { timeline: { at: new Date(), text: `Change approved by ${who(req)} (${r.ruleLabel}, rule v${r.ruleVersion})${r.note ? `: ${r.note}` : ''}`, author: who(req) } } });
   res.json({ ok: true });
});

router.post('/:id/reject', async (req, res) => {
   const note = String(req.body?.note || '').trim();
   if (!note) return res.status(400).json({ error: 'Say why it is rejected' });
   const r = await ApprovalRequest.findById(req.params.id);
   if (!r || r.status !== 'pending') return res.status(404).json({ error: 'No pending request' });
   if (req.user?.role !== 'admin') return res.status(403).json({ error: 'You cannot reject this' });
   r.status = 'rejected'; r.decidedBy = who(req); r.decidedAt = new Date(); r.note = note.slice(0, 500);
   await r.save();
   await Contract.updateOne({ _id: r.entityId }, { $set: { approvalStatus: 'rejected' }, $push: { timeline: { at: new Date(), text: `Change rejected by ${who(req)}: ${note}`, author: who(req) } } });
   res.json({ ok: true });
});

router.get('/rules', async (_req, res) => {
   await ensureRules();
   res.json({ rules: await ApprovalRule.find({}).sort({ createdAt: 1 }).lean() });
});

// Switch a rule on or off, or change its threshold. Versioned and logged.
router.put('/rules/:id', async (req, res) => {
   if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
   const r = await ApprovalRule.findById(req.params.id);
   if (!r) return res.status(404).json({ error: 'No such rule' });
   const changes = [];
   if (typeof req.body?.active === 'boolean' && req.body.active !== r.active) { r.active = req.body.active; changes.push(r.active ? 'switched on' : 'switched off'); }
   if (req.body?.threshold != null && Number.isFinite(Number(req.body.threshold)) && Number(req.body.threshold) !== r.threshold) { changes.push(`threshold ${r.threshold} → ${Number(req.body.threshold)}`); r.threshold = Number(req.body.threshold); }
   if (!changes.length) return res.json({ rule: r });
   r.version += 1; r.provisional = false;
   r.history.push({ at: new Date(), by: who(req), change: changes.join(', ') });
   await r.save();
   res.json({ rule: r });
});

export default router;
