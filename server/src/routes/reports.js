import { Router } from 'express';
import { Unit, Contract, Payment, Expense } from '../models/index.js';

const router = Router();

const SIZE_BUCKETS = [10, 25, 35, 50, 100, 150, 200];

// Dashboard summary: occupancy, revenue this month, expiring soon, overdue.
router.get('/summary', async (_req, res) => {
  const units = await Unit.find();

  const byStatus = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
  for (const u of units) byStatus[u.status] += 1;

  const bySize = SIZE_BUCKETS.map((size) => {
    const inBucket = units.filter((u) => u.sizeSqf === size);
    return {
      sizeSqf: `${size} sq ft`,
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
  const in15 = new Date(now.getTime() + 15 * 86400000);

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
    Contract.find({ status: 'active', endDate: { $gte: now, $lte: in15 } })
      .populate('customer', 'fullName')
      .populate({ path: 'unit', select: 'unitNumber' })
      .sort({ endDate: 1 }),
    Payment.find({ status: 'overdue' })
      .populate({ path: 'contract', populate: [{ path: 'customer', select: 'fullName' }, { path: 'unit', select: 'unitNumber' }] })
      .sort({ dueDate: 1 })
      .limit(20),
    Contract.countDocuments({ status: 'active' }),
  ]);

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

// Expiring contracts — active contracts ending within N days (default 30)
router.get('/expiring', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ status: 'active', endDate: { $gte: now, $lte: until } })
    .populate('customer', 'fullName phone')
    .populate('unit', 'unitNumber sizeSqf floor')
    .sort({ endDate: 1 });
  res.json(contracts);
});

// Overdue payments — all currently overdue, with full contract/customer/unit info
router.get('/overdue', async (req, res) => {
  const now = new Date();
  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );
  const payments = await Payment.find({ status: 'overdue' })
    .populate({
      path: 'contract',
      populate: [
        { path: 'customer', select: 'fullName phone' },
        { path: 'unit', select: 'unitNumber sizeSqf' },
      ],
    })
    .sort({ dueDate: 1 });
  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  res.json({ payments, total: Math.round(total * 100) / 100 });
});

// ── NEW: Tenant payment status for a given month ───────────────────────────────
// Query: ?month=YYYY-MM  (defaults to current month)
router.get('/tenant-payments', async (req, res) => {
  const now = new Date();
  const raw = req.query.month; // 'YYYY-MM'
  const year = raw ? parseInt(raw.split('-')[0]) : now.getFullYear();
  const mon  = raw ? parseInt(raw.split('-')[1]) - 1 : now.getMonth();
  const monthStart = new Date(year, mon, 1);
  const monthEnd   = new Date(year, mon + 1, 1);

  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  // Payments whose due date falls in this month OR were paid in this month
  const payments = await Payment.find({
    $or: [
      { dueDate: { $gte: monthStart, $lt: monthEnd } },
      { status: 'paid', paidDate: { $gte: monthStart, $lt: monthEnd } },
    ],
  })
    .populate({
      path: 'contract',
      populate: [
        { path: 'customer', select: 'fullName phone email' },
        { path: 'unit', select: 'unitNumber sizeSqf floor' },
      ],
    })
    .populate('invoice', 'invoiceNo')
    .sort({ dueDate: 1 });

  // Deduplicate by contract: group payments per contract into a single row
  const contractMap = new Map();
  for (const p of payments) {
    const cid = String(p.contract?._id ?? p.contract);
    if (!contractMap.has(cid)) {
      contractMap.set(cid, {
        contractId: cid,
        contractNo: p.contract?.contractNo,
        customer: p.contract?.customer,
        unit: p.contract?.unit,
        payments: [],
      });
    }
    contractMap.get(cid).payments.push(p);
  }

  const rows = Array.from(contractMap.values()).map((entry) => {
    const ps = entry.payments;
    const total   = ps.reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidAmt = ps.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0);
    const allPaid = ps.every((p) => p.status === 'paid');
    const anyOverdue = ps.some((p) => p.status === 'overdue');
    const status  = allPaid ? 'paid' : anyOverdue ? 'overdue' : 'pending';
    const latestPaidDate = ps.filter((p) => p.paidDate).map((p) => p.paidDate).sort().pop() || null;
    const methods = [...new Set(ps.filter((p) => p.method).map((p) => p.method))];
    return { ...entry, total, paidAmt, status, latestPaidDate, methods };
  });

  const paid    = rows.filter((r) => r.status === 'paid');
  const pending = rows.filter((r) => r.status !== 'paid');

  res.json({
    month: monthStart.toLocaleString('en', { month: 'long', year: 'numeric' }),
    monthISO: `${year}-${String(mon + 1).padStart(2, '0')}`,
    paid,
    pending,
    totalPaid:    paid.reduce((s, r) => s + r.total, 0),
    totalPending: pending.reduce((s, r) => s + r.total, 0),
    countPaid:    paid.length,
    countPending: pending.length,
  });
});

// ── NEW: Revenue and occupancy breakdown per unit size ─────────────────────────
router.get('/unit-revenue', async (req, res) => {
  const [units, activeContracts, revenueAgg] = await Promise.all([
    Unit.find().sort({ sizeSqf: 1, unitNumber: 1 }),
    Contract.find({ status: 'active' }).select('unit rate'),
    Payment.aggregate([
      { $match: { status: 'paid' } },
      {
        $lookup: {
          from: 'contracts',
          localField: 'contract',
          foreignField: '_id',
          as: 'c',
        },
      },
      { $unwind: '$c' },
      {
        $group: {
          _id: '$c.unit',
          totalRevenue: { $sum: '$amount' },
          paymentCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const revenueMap = new Map(revenueAgg.map((r) => [String(r._id), r]));
  const occupiedUnitIds = new Set(activeContracts.map((c) => String(c.unit)));
  const contractRateMap = new Map(activeContracts.map((c) => [String(c.unit), Number(c.rate || 0)]));

  // Per-unit rows
  const unitRows = units.map((u) => {
    const rev = revenueMap.get(String(u._id));
    const isOccupied = occupiedUnitIds.has(String(u._id));
    return {
      _id: u._id,
      unitNumber: u.unitNumber,
      floor: u.floor,
      sizeSqf: u.sizeSqf,
      status: u.status,
      monthlyRate: isOccupied ? contractRateMap.get(String(u._id)) : (u.price || 0),
      listPrice: u.price || 0,
      totalRevenue: rev?.totalRevenue || 0,
      paymentCount: rev?.paymentCount || 0,
      isOccupied,
    };
  });

  // Group by size
  const sizeMap = new Map();
  for (const u of unitRows) {
    const key = u.sizeSqf ?? 0;
    if (!sizeMap.has(key)) {
      sizeMap.set(key, {
        sizeSqf: u.sizeSqf,
        unitCount: 0, occupiedCount: 0, availableCount: 0,
        totalRevenue: 0, monthlyCapacity: 0,
      });
    }
    const g = sizeMap.get(key);
    g.unitCount++;
    if (u.isOccupied) g.occupiedCount++;
    else g.availableCount++;
    g.totalRevenue += u.totalRevenue;
    g.monthlyCapacity += u.listPrice;
  }

  const emptyUnits = unitRows.filter((u) => !u.isOccupied && u.status !== 'maintenance');

  res.json({
    bySizeGroup: Array.from(sizeMap.values()).sort((a, b) => (a.sizeSqf || 0) - (b.sizeSqf || 0)),
    unitRows,
    emptyUnits,
    totalRevenueEver: unitRows.reduce((s, u) => s + u.totalRevenue, 0),
    totalMonthlyCapacity: units.reduce((s, u) => s + (u.price || 0), 0),
    currentMonthlyIncome: Array.from(contractRateMap.values()).reduce((s, r) => s + r, 0),
  });
});

// ── NEW: Expense breakdown by category and month ───────────────────────────────
router.get('/expenses-breakdown', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd   = new Date(year + 1, 0, 1);

  const expenses = await Expense.find({
    expenseDate: { $gte: yearStart, $lt: yearEnd },
    status: { $ne: 'cancelled' },
  }).sort({ expenseDate: 1 });

  // Monthly totals
  const monthly = Array.from({ length: 12 }, (_, m) => {
    const ms = new Date(year, m, 1);
    const me = new Date(year, m + 1, 1);
    const inMonth = expenses.filter((e) => {
      const d = new Date(e.expenseDate);
      return d >= ms && d < me;
    });
    return {
      month: ms.toLocaleString('en', { month: 'short' }),
      monthIndex: m,
      total: Math.round(inMonth.reduce((s, e) => s + (e.total || 0), 0) * 100) / 100,
      count: inMonth.length,
    };
  });

  // By account/category
  const catMap = new Map();
  for (const e of expenses) {
    const cat = e.expenseAccount || e.expenseType || 'Uncategorized';
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, total: 0, count: 0 });
    const g = catMap.get(cat);
    g.total = Math.round((g.total + (e.total || 0)) * 100) / 100;
    g.count++;
  }
  const byCategory = Array.from(catMap.values()).sort((a, b) => b.total - a.total);

  // Recent expense list (last 20)
  const recent = expenses.slice(-20).reverse().map((e) => ({
    _id: e._id,
    date: e.expenseDate,
    description: e.description || e.expenseType || '',
    category: e.expenseAccount || e.expenseType || 'Uncategorized',
    vendor: e.vendorName || '',
    total: e.total || 0,
    status: e.status,
  }));

  res.json({
    year,
    monthly,
    byCategory,
    recent,
    totalExpenses: Math.round(expenses.reduce((s, e) => s + (e.total || 0), 0) * 100) / 100,
  });
});

// ── NEW: Payment forecast for upcoming months from active contracts ─────────────
router.get('/forecast', async (req, res) => {
  const months = Math.min(Number(req.query.months) || 6, 12);
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [contracts, overdueAgg] = await Promise.all([
    Contract.find({ status: 'active' })
      .populate('customer', 'fullName')
      .populate('unit', 'unitNumber sizeSqf'),
    Payment.aggregate([
      { $match: { status: { $in: ['pending', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  // Historical: actual paid per month (last 3 months)
  const histStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const historicalAgg = await Payment.aggregate([
    { $match: { status: 'paid', paidDate: { $gte: histStart } } },
    { $group: { _id: { y: { $year: '$paidDate' }, m: { $month: '$paidDate' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ]);

  const forecast = [];
  for (let i = -2; i < months; i++) {
    const ms = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const me = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const isPast = me <= now;
    const isCurrent = ms <= now && me > now;

    // Contracts active during this month
    const active = contracts.filter((c) => {
      const s = new Date(c.startDate);
      const e = new Date(c.endDate);
      return s < me && e > ms;
    });
    const expected = Math.round(active.reduce((s, c) => s + (Number(c.rate) || 0), 0) * 100) / 100;

    // Actual for past/current months
    const hit = historicalAgg.find((a) => a._id.y === ms.getFullYear() && a._id.m === ms.getMonth() + 1);
    const actual = (isPast || isCurrent) ? (Math.round((hit?.total || 0) * 100) / 100) : null;

    forecast.push({
      month: ms.toLocaleString('en', { month: 'short', year: '2-digit' }),
      monthISO: ms.toISOString().slice(0, 7),
      isPast,
      isCurrent,
      expected,
      actual,
      contractCount: active.length,
      contracts: active.map((c) => ({
        _id: c._id,
        contractNo: c.contractNo,
        customer: c.customer?.fullName,
        unit: c.unit?.unitNumber,
        monthlyRate: Number(c.rate || 0),
        endDate: c.endDate,
      })),
    });
  }

  // Outstanding (pending + overdue) payments
  const overdueTotal = overdueAgg[0]?.total || 0;

  res.json({
    forecast,
    overdueBalance: Math.round(overdueTotal * 100) / 100,
    activeContracts: contracts.length,
    monthlyRunRate: Math.round(contracts.reduce((s, c) => s + Number(c.rate || 0), 0) * 100) / 100,
  });
});

export default router;
