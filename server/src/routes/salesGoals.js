import { Router } from 'express';
import { SalesGoal, Lead, MovingLead } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
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

async function computeActual(userId) {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const [weekUnits, monthUnits, weekMoving, monthMoving] = await Promise.all([
    Lead.countDocuments({ owner: userId, status: 'won', updatedAt: { $gte: weekStart } }),
    Lead.countDocuments({ owner: userId, status: 'won', updatedAt: { $gte: monthStart } }),
    MovingLead.countDocuments({ owner: userId, status: 'won', updatedAt: { $gte: weekStart } }),
    MovingLead.countDocuments({ owner: userId, status: 'won', updatedAt: { $gte: monthStart } }),
  ]);

  return {
    weekly: { units: weekUnits, moving: weekMoving },
    monthly: { units: monthUnits, moving: monthMoving },
  };
}

async function getOrCreate(userId) {
  let goal = await SalesGoal.findOne({ owner: userId });
  if (!goal) goal = await SalesGoal.create({ owner: userId });
  return goal;
}

function targetsPayload(goal) {
  return {
    daily: goal.daily,
    weekly: goal.weekly,
    monthly: goal.monthly,
    dailyFollowUps: goal.dailyFollowUps,
    startTime: goal.startTime,
    finishTime: goal.finishTime,
  };
}

function applyTargetFields(goal, body) {
  const { daily, weekly, monthly, dailyFollowUps, startTime, finishTime } = body || {};
  if (daily) {
    if (daily.units !== undefined) goal.daily.units = Math.max(0, Number(daily.units) || 0);
    if (daily.moving !== undefined) goal.daily.moving = Math.max(0, Number(daily.moving) || 0);
  }
  if (weekly) {
    if (weekly.units !== undefined) goal.weekly.units = Math.max(0, Number(weekly.units) || 0);
    if (weekly.moving !== undefined) goal.weekly.moving = Math.max(0, Number(weekly.moving) || 0);
  }
  if (monthly) {
    if (monthly.units !== undefined) goal.monthly.units = Math.max(0, Number(monthly.units) || 0);
    if (monthly.moving !== undefined) goal.monthly.moving = Math.max(0, Number(monthly.moving) || 0);
  }
  if (dailyFollowUps !== undefined) goal.dailyFollowUps = Math.max(0, Number(dailyFollowUps) || 0);
  if (startTime !== undefined) goal.startTime = String(startTime).slice(0, 5);
  if (finishTime !== undefined) goal.finishTime = String(finishTime).slice(0, 5);
}

router.get('/me', async (req, res) => {
  const goal = await getOrCreate(req.user.id);
  const actual = await computeActual(req.user.id);
  res.json({ targets: targetsPayload(goal), actual });
});

// Self-service: a rep sets their own daily habits/targets (distinct from
// admin-owned weekly/monthly team targets edited via PUT /:userId below —
// both write the same document, admin numbers just double as team goals
// shown on the Sales Team dashboard).
router.put('/me', async (req, res) => {
  const goal = await getOrCreate(req.user.id);
  applyTargetFields(goal, req.body);
  await goal.save();
  res.json({ targets: targetsPayload(goal) });
});

// Personal performance: totals + a 6-month new-leads trend, for the rep's
// own "Reports" page. Declared before '/:userId' (no suffix) is irrelevant
// since path shapes differ, but declared before '/:userId/performance'
// below so '/me/performance' isn't swallowed by that wildcard.
async function computePerformance(userId) {
  const [totalLeads, wonLeads, totalMoving, wonMoving] = await Promise.all([
    Lead.countDocuments({ owner: userId }),
    Lead.countDocuments({ owner: userId, status: 'won' }),
    MovingLead.countDocuments({ owner: userId }),
    MovingLead.countDocuments({ owner: userId, status: 'won' }),
  ]);
  const newLeadsTotal = totalLeads + totalMoving;
  const wonDealsTotal = wonLeads + wonMoving;
  const conversionRatePct = newLeadsTotal > 0 ? Math.round((wonDealsTotal / newLeadsTotal) * 1000) / 10 : 0;

  const monthsBack = 6;
  const now = new Date();
  const monthly = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const [leadCount, movingCount] = await Promise.all([
      Lead.countDocuments({ owner: userId, leadDateTime: { $gte: start, $lt: end } }),
      MovingLead.countDocuments({ owner: userId, createdAt: { $gte: start, $lt: end } }),
    ]);
    monthly.push({ month: start.toLocaleString('en-US', { month: 'short' }), newLeads: leadCount + movingCount });
  }

  return { newLeadsTotal, wonDealsTotal, conversionRatePct, monthly };
}

router.get('/me/performance', async (req, res) => {
  res.json(await computePerformance(req.user.id));
});

router.get('/:userId/performance', async (req, res) => {
  const isSelf = String(req.user.id) === String(req.params.userId);
  if (!isSelf && req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.json(await computePerformance(req.params.userId));
});

router.get('/:userId', async (req, res) => {
  const isSelf = String(req.user.id) === String(req.params.userId);
  if (!isSelf && req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const goal = await getOrCreate(req.params.userId);
  const actual = await computeActual(req.params.userId);
  res.json({ targets: targetsPayload(goal), actual });
});

router.put('/:userId', requireAdmin, async (req, res) => {
  const goal = await getOrCreate(req.params.userId);
  applyTargetFields(goal, req.body);
  await goal.save();
  res.json({ targets: targetsPayload(goal) });
});

export default router;
