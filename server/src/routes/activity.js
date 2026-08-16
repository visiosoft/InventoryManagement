import { Router } from 'express';
import { Task, Lead, MovingLead, Contract, User } from '../models/index.js';

const router = Router();

function isPrivileged(req) {
  return req.user?.role === 'admin' || req.user?.role === 'staff';
}

// A day-by-day activity feed for one rep — every note, comment, task
// created/commented/completed/reassigned, and follow-up logged against a
// lead or contract, merged from across modules and sorted newest-first.
// Reps only ever see their own diary; admin/staff can view anyone's.
router.get('/', async (req, res) => {
  const requestedUserId = String(req.query.userId || req.user.id);
  if (requestedUserId !== req.user.id && !isPrivileged(req)) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const userId = requestedUserId;
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86400000);

  const user = await User.findById(userId).select('name email').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const userName = user.name || user.email || '';

  const entries = [];

  const tasks = await Task.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] })
    .select('title comments assignmentHistory createdBy createdAt doneAt status')
    .lean();
  for (const t of tasks) {
    if (String(t.createdBy) === userId && new Date(t.createdAt) >= since) {
      entries.push({ at: t.createdAt, type: 'task_created', text: `Created task "${t.title}"`, refTitle: t.title });
    }
    if (t.doneAt && new Date(t.doneAt) >= since) {
      entries.push({ at: t.doneAt, type: 'task_done', text: `Completed "${t.title}"`, refTitle: t.title });
    }
    for (const c of t.comments || []) {
      if (String(c.user) === userId && new Date(c.createdAt) >= since) {
        entries.push({ at: c.createdAt, type: 'task_comment', text: c.text, refTitle: t.title });
      }
    }
    for (const h of t.assignmentHistory || []) {
      if (String(h.byId) === userId && new Date(h.at) >= since) {
        entries.push({
          at: h.at,
          type: 'task_assigned',
          text: h.fromName ? `Reassigned "${t.title}" from ${h.fromName} to ${h.toName}` : `Assigned "${t.title}" to ${h.toName}`,
          refTitle: t.title,
        });
      }
    }
  }

  const leads = await Lead.find({ owner: userId, updatedAt: { $gte: since } }).select('fullName comments timeline').lean();
  for (const l of leads) {
    for (const c of l.comments || []) {
      if (String(c.user) === userId && new Date(c.createdAt) >= since) {
        entries.push({ at: c.createdAt, type: 'lead_comment', text: c.text, refTitle: l.fullName });
      }
    }
    for (const t of l.timeline || []) {
      if (String(t.user) === userId && new Date(t.at) >= since) {
        entries.push({ at: t.at, type: 'lead_note', text: t.text, refTitle: l.fullName });
      }
    }
  }

  const movingLeads = await MovingLead.find({ owner: userId, updatedAt: { $gte: since } }).select('prospectName timeline').lean();
  for (const l of movingLeads) {
    for (const t of l.timeline || []) {
      if (t.author === userName && new Date(t.at) >= since) {
        entries.push({ at: t.at, type: 'moving_note', text: t.text, refTitle: l.prospectName });
      }
    }
  }

  const contracts = await Contract.find({ salesRep: userId, updatedAt: { $gte: since } })
    .select('contractNo timeline').lean();
  for (const c of contracts) {
    for (const t of c.timeline || []) {
      if (t.author === userName && new Date(t.at) >= since) {
        entries.push({ at: t.at, type: 'contract_note', text: t.text, refTitle: c.contractNo });
      }
    }
  }

  entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ user: { _id: user._id, name: userName }, entries: entries.slice(0, 400) });
});

export default router;
