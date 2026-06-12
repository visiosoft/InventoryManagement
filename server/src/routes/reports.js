import { Router } from 'express';
import { Unit, UnitType, Contract, Payment } from '../models/index.js';

const router = Router();

// Dashboard summary: occupancy, revenue this month, expiring soon, overdue.
router.get('/summary', async (_req, res) => {
  const [units, types] = await Promise.all([
    Unit.find().populate('unitType'),
    UnitType.find().sort({ sizeSqf: 1 }),
  ]);

  const byStatus = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
  for (const u of units) byStatus[u.status] += 1;

  const bySize = types.map((t) => {
    const ofType = units.filter((u) => u.unitType && String(u.unitType._id) === String(t._id));
    return {
      sizeSqf: t.sizeSqf,
      total: ofType.length,
      available: ofType.filter((u) => u.status === 'available').length,
      occupied: ofType.filter((u) => u.status === 'occupied').length,
    };
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const in14 = new Date(now.getTime() + 14 * 86400000);

  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  const [revenueAgg, dueAgg, expiring, overdue, activeContracts] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'paid', paidDate: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { status: { $in: ['pending', 'overdue'] }, dueDate: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Contract.find({ status: 'active', endDate: { $gte: now, $lte: in14 } })
      .populate('customer', 'fullName')
      .populate({ path: 'unit', select: 'unitNumber' })
      .sort({ endDate: 1 }),
    Payment.find({ status: 'overdue' })
      .populate({ path: 'contract', populate: [{ path: 'customer', select: 'fullName' }, { path: 'unit', select: 'unitNumber' }] })
      .sort({ dueDate: 1 })
      .limit(20),
    Contract.countDocuments({ status: 'active' }),
  ]);

  const totalUnits = units.length;
  res.json({
    totalUnits,
    byStatus,
    bySize,
    occupancyPct: totalUnits ? Math.round(((byStatus.occupied + byStatus.reserved) / totalUnits) * 100) : 0,
    activeContracts,
    revenueThisMonth: revenueAgg[0]?.total || 0,
    expectedThisMonth: (revenueAgg[0]?.total || 0) + (dueAgg[0]?.total || 0),
    expiringContracts: expiring,
    overduePayments: overdue,
  });
});

// Revenue by month for the last N months (paid payments).
router.get('/revenue', async (req, res) => {
  const months = Math.min(Number(req.query.months) || 6, 24);
  const start = new Date();
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const agg = await Payment.aggregate([
    { $match: { status: 'paid', paidDate: { $gte: start } } },
    {
      $group: {
        _id: { y: { $year: '$paidDate' }, m: { $month: '$paidDate' } },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ]);

  const out = [];
  const cursor = new Date(start);
  for (let i = 0; i < months; i++) {
    const hit = agg.find((a) => a._id.y === cursor.getFullYear() && a._id.m === cursor.getMonth() + 1);
    out.push({
      month: cursor.toLocaleString('en', { month: 'short', year: '2-digit' }),
      total: hit?.total || 0,
      payments: hit?.count || 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  res.json(out);
});

// Availability search: which units of a size are free now / for a date range.
router.get('/availability', async (req, res) => {
  const { sizeSqf, from, to } = req.query;
  const typeFilter = {};
  if (sizeSqf) {
    const type = await UnitType.findOne({ sizeSqf: Number(sizeSqf) });
    if (!type) return res.json([]);
    typeFilter.unitType = type._id;
  }
  const units = await Unit.find({ ...typeFilter, status: { $ne: 'maintenance' } }).populate('unitType');

  // A unit is unavailable for the range if an open contract overlaps it.
  const fromD = from ? new Date(from) : new Date();
  const toD = to ? new Date(to) : fromD;
  const busy = await Contract.find({
    status: { $in: ['draft', 'pending_signature', 'active'] },
    startDate: { $lte: toD },
    endDate: { $gte: fromD },
  }).select('unit');
  const busyIds = new Set(busy.map((c) => String(c.unit)));

  res.json(units.filter((u) => !busyIds.has(String(u._id))));
});

// Upcoming vacancies: active contracts ending within N days.
router.get('/vacancies', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ status: 'active', endDate: { $gte: now, $lte: until } })
    .populate('customer', 'fullName')
    .populate({ path: 'unit', populate: 'unitType' })
    .sort({ endDate: 1 });
  res.json(contracts);
});

export default router;
