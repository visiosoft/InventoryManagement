import { Router } from 'express';
import { User, Lead, MovingLead, SalesGoal, Contract, Task } from '../models/index.js';

const router = Router();

function requireManager(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'staff') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  next();
}

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date;
}
function startOfMonth(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date;
}

const STALE_AFTER_MS = 1 * 86400000; // 1 day, confirmed threshold

router.get('/', requireManager, async (req, res) => {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);

  const reps = await User.find({ role: { $in: ['sales_rep', 'accounts'] } }).select('name email').lean();

  const repRows = await Promise.all(reps.map(async (rep) => {
    const [
      goal, weekUnits, monthUnits, weekMoving, monthMoving,
      weekRevenueAgg, monthRevenueAgg, openTasks, overdueTasks,
    ] = await Promise.all([
      SalesGoal.findOne({ owner: rep._id }).lean(),
      Lead.countDocuments({ owner: rep._id, status: 'won', updatedAt: { $gte: weekStart } }),
      Lead.countDocuments({ owner: rep._id, status: 'won', updatedAt: { $gte: monthStart } }),
      MovingLead.countDocuments({ owner: rep._id, status: 'won', updatedAt: { $gte: weekStart } }),
      MovingLead.countDocuments({ owner: rep._id, status: 'won', updatedAt: { $gte: monthStart } }),
      Contract.aggregate([
        { $match: { salesRep: rep._id, createdAt: { $gte: weekStart } } },
        { $group: { _id: null, total: { $sum: '$totalQuotation' } } },
      ]),
      Contract.aggregate([
        { $match: { salesRep: rep._id, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalQuotation' } } },
      ]),
      Task.countDocuments({ assignedTo: rep._id, status: { $ne: 'done' } }),
      Task.countDocuments({ assignedTo: rep._id, status: { $ne: 'done' }, dueDate: { $lt: now } }),
    ]);

    return {
      user: { _id: rep._id, name: rep.name, email: rep.email },
      targets: {
        weekly: goal?.weekly || { units: 0, moving: 0 },
        monthly: goal?.monthly || { units: 0, moving: 0 },
      },
      actual: {
        weekly: { units: weekUnits, moving: weekMoving },
        monthly: { units: monthUnits, moving: monthMoving },
      },
      revenue: {
        weekly: weekRevenueAgg[0]?.total || 0,
        monthly: monthRevenueAgg[0]?.total || 0,
      },
      openTasks,
      overdueTasks,
    };
  }));

  const [staleLeads, staleMovingLeads, unassignedMovingLeads] = await Promise.all([
    Lead.find({ status: 'new', leadDateTime: { $lt: staleCutoff } })
      .select('fullName leadDateTime owner')
      .populate('owner', 'name')
      .sort({ leadDateTime: 1 })
      .lean(),
    MovingLead.find({ status: 'new', createdAt: { $lt: staleCutoff } })
      .select('prospectName createdAt owner')
      .populate('owner', 'name')
      .sort({ createdAt: 1 })
      .lean(),
    MovingLead.find({ owner: null })
      .select('prospectName createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const daysStale = (d) => Math.floor((now - new Date(d)) / 86400000);

  res.json({
    reps: repRows,
    staleLeads: [
      ...staleLeads.map((l) => ({ id: l._id, type: 'storage', name: l.fullName, owner: l.owner?.name || '—', daysStale: daysStale(l.leadDateTime) })),
      ...staleMovingLeads.map((l) => ({ id: l._id, type: 'moving', name: l.prospectName, owner: l.owner?.name || '—', daysStale: daysStale(l.createdAt) })),
    ],
    unassignedMovingLeads: unassignedMovingLeads.map((l) => ({ id: l._id, name: l.prospectName, createdAt: l.createdAt })),
  });
});

export default router;
