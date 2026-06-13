import { Router } from 'express';
import { Unit, Contract, Payment } from '../models/index.js';

const router = Router();

const SIZE_BUCKETS = [
  { label: '≤ 25', min: 0, max: 25 },
  { label: '26–50', min: 26, max: 50 },
  { label: '51–80', min: 51, max: 80 },
  { label: '81–120', min: 81, max: 120 },
  { label: '121–160', min: 121, max: 160 },
  { label: '160+', min: 161, max: Infinity },
];

// Dashboard summary: occupancy, revenue this month, expiring soon, overdue.
router.get('/summary', async (_req, res) => {
  const units = await Unit.find();

  const byStatus = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
  for (const u of units) byStatus[u.status] += 1;

  const bySize = SIZE_BUCKETS.map((b) => {
    const inBucket = units.filter((u) => u.sizeSqf != null && u.sizeSqf >= b.min && u.sizeSqf <= b.max);
    return {
      sizeSqf: b.label,
      total: inBucket.length,
      available: inBucket.filter((u) => u.status === 'available').length,
      occupied: inBucket.filter((u) => u.status === 'occupied').length,
      maintenance: inBucket.filter((u) => u.status === 'maintenance').length,
    };
  });

  const byFloor = ['F1', 'F2'].map((f) => {
    const onFloor = units.filter((u) => u.floor === f);
    return {
      floor: f,
      total: onFloor.length,
      available: onFloor.filter((u) => u.status === 'available').length,
      occupied: onFloor.filter((u) => u.status === 'occupied').length,
      maintenance: onFloor.filter((u) => u.status === 'maintenance').length,
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

  // Rentable = not under construction / in-house use.
  const rentable = byStatus.available + byStatus.occupied + byStatus.reserved;
  res.json({
    totalUnits: units.length,
    byStatus,
    bySize,
    byFloor,
    occupancyPct: rentable ? Math.round(((byStatus.occupied + byStatus.reserved) / rentable) * 100) : 0,
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

// Availability search: free units, optionally by minimum size and date range.
router.get('/availability', async (req, res) => {
  const { minSize, maxSize, from, to } = req.query;
  const filter = { status: { $nin: ['maintenance'] } };
  if (minSize) filter.sizeSqf = { ...filter.sizeSqf, $gte: Number(minSize) };
  if (maxSize) filter.sizeSqf = { ...filter.sizeSqf, $lte: Number(maxSize) };
  const units = await Unit.find(filter).sort({ sizeSqf: 1, unitNumber: 1 });

  // A unit is unavailable for the range if an open contract overlaps it,
  // or it is in in-house use (occupied without a contract).
  const fromD = from ? new Date(from) : new Date();
  const toD = to ? new Date(to) : fromD;
  const busy = await Contract.find({
    status: { $in: ['draft', 'pending_signature', 'active'] },
    startDate: { $lte: toD },
    endDate: { $gte: fromD },
  }).select('unit');
  const busyIds = new Set(busy.map((c) => String(c.unit)));
  const contractedUnitIds = new Set(
    (await Contract.find({ status: { $in: ['draft', 'pending_signature', 'active'] } }).select('unit')).map((c) => String(c.unit))
  );

  res.json(
    units.filter((u) => {
      if (busyIds.has(String(u._id))) return false;
      // occupied/reserved without any open contract = in-house use, not rentable
      if (['occupied', 'reserved'].includes(u.status) && !contractedUnitIds.has(String(u._id))) return false;
      return true;
    })
  );
});

// Upcoming vacancies: active contracts ending within N days.
router.get('/vacancies', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ status: 'active', endDate: { $gte: now, $lte: until } })
    .populate('customer', 'fullName')
    .populate('unit')
    .sort({ endDate: 1 });
  res.json(contracts);
});

export default router;
