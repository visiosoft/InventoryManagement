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

router.get('/me', async (req, res) => {
  const goal = await getOrCreate(req.user.id);
  const actual = await computeActual(req.user.id);
  res.json({ targets: { weekly: goal.weekly, monthly: goal.monthly }, actual });
});

router.get('/:userId', async (req, res) => {
  const isSelf = String(req.user.id) === String(req.params.userId);
  if (!isSelf && req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const goal = await getOrCreate(req.params.userId);
  const actual = await computeActual(req.params.userId);
  res.json({ targets: { weekly: goal.weekly, monthly: goal.monthly }, actual });
});

router.put('/:userId', requireAdmin, async (req, res) => {
  const { weekly, monthly } = req.body || {};
  const goal = await getOrCreate(req.params.userId);
  if (weekly) {
    if (weekly.units !== undefined) goal.weekly.units = Math.max(0, Number(weekly.units) || 0);
    if (weekly.moving !== undefined) goal.weekly.moving = Math.max(0, Number(weekly.moving) || 0);
  }
  if (monthly) {
    if (monthly.units !== undefined) goal.monthly.units = Math.max(0, Number(monthly.units) || 0);
    if (monthly.moving !== undefined) goal.monthly.moving = Math.max(0, Number(monthly.moving) || 0);
  }
  await goal.save();
  res.json({ targets: { weekly: goal.weekly, monthly: goal.monthly } });
});

export default router;
