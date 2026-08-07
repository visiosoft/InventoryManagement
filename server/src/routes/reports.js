import { Router } from 'express';
import { Unit, Contract, Payment, Expense } from '../models/index.js';
import { siteScope } from '../utils/siteScope.js';

const router = Router();

const SIZE_BUCKETS = [10, 25, 35, 50, 100, 150, 200];

// Dashboard summary: occupancy, revenue this month, expiring soon, overdue.
router.get('/summary', async (req, res) => {
  const scope = await siteScope(req.query.site);
  const uF = scope ? scope.unitFilter : {};
  const cF = scope ? scope.contractFilter : {};
  const pF = scope ? scope.paymentFilter : {};

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const in15 = new Date(now.getTime() + 15 * 86400000);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Fire-and-forget: mark overdue payments without blocking the response
  Payment.updateMany(
    { status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  ).exec();

  // Use aggregation for unit stats instead of loading all unit documents
  const [unitStats, unitsBySize, unitsByFloor, availableUnits,
    revenueAgg, dueAgg, expiring, overdue, activeContracts,
    moveInsThisMonthList, moveOutsThisMonthList, moveInsLastMonth, moveOutsLastMonth] = await Promise.all([
    Unit.aggregate([
      { $match: uF },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Unit.aggregate([
      { $match: uF },
      { $group: { _id: { sizeSqf: '$sizeSqf', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Unit.aggregate([
      { $match: uF },
      { $group: { _id: { floor: '$floor', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Unit.find({ ...uF, status: 'available' }).select('unitNumber floor sizeSqf price').lean(),
    Payment.aggregate([
      { $match: { ...pF, status: 'paid', paidDate: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { ...pF, status: { $in: ['pending', 'overdue'] }, dueDate: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Contract.find({ ...cF, status: 'active', endDate: { $gte: now, $lte: in15 } })
      .populate('customer', 'fullName')
      .populate('unit', 'unitNumber')
      .sort({ endDate: 1 }).lean(),
    Payment.find({ ...pF, status: 'overdue' })
      .populate({ path: 'contract', select: 'contractNo customer unit', populate: [{ path: 'customer', select: 'fullName' }, { path: 'unit', select: 'unitNumber' }] })
      .sort({ dueDate: 1 }).limit(20).lean(),
    Contract.countDocuments({ ...cF, status: 'active' }),
    Contract.find({ ...cF, status: { $in: ['active', 'ended'] }, startDate: { $gte: monthStart, $lt: monthEnd } })
      .populate('customer', 'fullName').populate('unit', 'unitNumber').sort({ startDate: 1 }).lean(),
    Contract.find({ ...cF, status: 'ended', endDate: { $gte: monthStart, $lt: monthEnd } })
      .populate('customer', 'fullName').populate('unit', 'unitNumber').sort({ endDate: 1 }).lean(),
    Contract.countDocuments({ ...cF, status: { $in: ['active', 'ended'] }, startDate: { $gte: lastMonthStart, $lt: monthStart } }),
    Contract.countDocuments({ ...cF, status: 'ended', endDate: { $gte: lastMonthStart, $lt: monthStart } }),
  ]);

  // Build unit status counts from aggregation
  const byStatus = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
  let totalUnits = 0;
  for (const r of unitStats) { byStatus[r._id] = r.count; totalUnits += r.count; }

  // Build size breakdown from aggregation
  const sizeMap = new Map();
  for (const r of unitsBySize) {
    const s = r._id.sizeSqf;
    if (!sizeMap.has(s)) sizeMap.set(s, { sizeSqf: `${s} sq ft`, total: 0, available: 0, occupied: 0, maintenance: 0 });
    const b = sizeMap.get(s);
    b.total += r.count;
    if (r._id.status === 'available') b.available += r.count;
    else if (r._id.status === 'occupied') b.occupied += r.count;
    else if (r._id.status === 'maintenance') b.maintenance += r.count;
  }
  const bySize = SIZE_BUCKETS.filter(s => sizeMap.has(s)).map(s => sizeMap.get(s));

  // Build floor breakdown from aggregation
  const floorMap = new Map();
  for (const r of unitsByFloor) {
    const f = r._id.floor;
    if (!floorMap.has(f)) floorMap.set(f, { floor: f, total: 0, available: 0, occupied: 0, maintenance: 0 });
    const b = floorMap.get(f);
    b.total += r.count;
    if (r._id.status === 'available') b.available += r.count;
    else if (r._id.status === 'occupied') b.occupied += r.count;
    else if (r._id.status === 'maintenance') b.maintenance += r.count;
  }
  const byFloor = ['F1', 'F2'].filter(f => floorMap.has(f)).map(f => floorMap.get(f));

  // Attach payment status to move lists in one pass
  const allMoveIds = [...moveInsThisMonthList, ...moveOutsThisMonthList].map(c => c._id);
  if (allMoveIds.length > 0) {
    const paymentsByContract = await Payment.aggregate([
      { $match: { contract: { $in: allMoveIds } } },
      { $group: { _id: '$contract', total: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } } } },
    ]);
    const payMap = new Map(paymentsByContract.map(p => [String(p._id), p]));
    for (const c of [...moveInsThisMonthList, ...moveOutsThisMonthList]) {
      const pay = payMap.get(String(c._id));
      c.paymentStatus = pay ? (pay.paid >= pay.total ? 'paid' : 'pending') : 'no_invoice';
    }
  }

  const rentable = byStatus.available + byStatus.occupied + byStatus.reserved;
  res.json({
    totalUnits,
    byStatus,
    bySize,
    byFloor,
    occupancyPct: rentable ? Math.round(((byStatus.occupied + byStatus.reserved) / rentable) * 100) : 0,
    activeContracts,
    revenueThisMonth: revenueAgg[0]?.total || 0,
    expectedThisMonth: (revenueAgg[0]?.total || 0) + (dueAgg[0]?.total || 0),
    expiringContracts: expiring,
    overduePayments: overdue,
    moveInsThisMonth: moveInsThisMonthList.length,
    moveInsLastMonth,
    moveOutsThisMonth: moveOutsThisMonthList.length,
    moveOutsLastMonth,
    moveInsList: moveInsThisMonthList,
    moveOutsList: moveOutsThisMonthList,
    availableUnitsList: availableUnits.map(u => ({ _id: u._id, unitNumber: u.unitNumber, floor: u.floor, sizeSqf: u.sizeSqf, monthlyRent: u.price || 0 })),
  });
});

// Revenue by month for the last N months (paid payments).
router.get('/revenue', async (req, res) => {
  const scope = await siteScope(req.query.site);
  const pF = scope ? scope.paymentFilter : {};
  const months = Math.min(Number(req.query.months) || 6, 24);
  const start = new Date();
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const agg = await Payment.aggregate([
    { $match: { ...pF, status: 'paid', paidDate: { $gte: start } } },
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
  const scope = await siteScope(req.query.site);
  const { minSize, maxSize, from, to } = req.query;
  const filter = { ...(scope ? scope.unitFilter : {}), status: { $nin: ['maintenance'] } };
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
  const scope = await siteScope(req.query.site);
  const days = Math.min(Number(req.query.days) || 30, 365);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ ...(scope ? scope.contractFilter : {}), status: 'active', endDate: { $gte: now, $lte: until } })
    .populate('customer', 'fullName')
    .populate('unit')
    .sort({ endDate: 1 });
  res.json(contracts);
});

// Expiring contracts — active contracts ending within N days (default 30)
router.get('/expiring', async (req, res) => {
  const scope = await siteScope(req.query.site);
  const days = Math.min(Number(req.query.days) || 30, 365);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ ...(scope ? scope.contractFilter : {}), status: 'active', endDate: { $gte: now, $lte: until } })
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
  const overdueScope = await siteScope(req.query.site);
  const payments = await Payment.find({ ...(overdueScope ? overdueScope.paymentFilter : {}), status: 'overdue' })
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
  const mon = raw ? parseInt(raw.split('-')[1]) - 1 : now.getMonth();
  const monthStart = new Date(year, mon, 1);
  const monthEnd = new Date(year, mon + 1, 1);

  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  // Payments whose due date falls in this month OR were paid in this month
  const tpScope = await siteScope(req.query.site);
  const payments = await Payment.find({
    ...(tpScope ? tpScope.paymentFilter : {}),
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
    const total = ps.reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidAmt = ps.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0);
    const allPaid = ps.every((p) => p.status === 'paid');
    const anyOverdue = ps.some((p) => p.status === 'overdue');
    const status = allPaid ? 'paid' : anyOverdue ? 'overdue' : 'pending';
    const latestPaidDate = ps.filter((p) => p.paidDate).map((p) => p.paidDate).sort().pop() || null;
    const methods = [...new Set(ps.filter((p) => p.method).map((p) => p.method))];
    return { ...entry, total, paidAmt, status, latestPaidDate, methods };
  });

  const paid = rows.filter((r) => r.status === 'paid');
  const pending = rows.filter((r) => r.status !== 'paid');

  res.json({
    month: monthStart.toLocaleString('en', { month: 'long', year: 'numeric' }),
    monthISO: `${year}-${String(mon + 1).padStart(2, '0')}`,
    paid,
    pending,
    totalPaid: paid.reduce((s, r) => s + r.total, 0),
    totalPending: pending.reduce((s, r) => s + r.total, 0),
    countPaid: paid.length,
    countPending: pending.length,
  });
});

// ── NEW: Revenue and occupancy breakdown per unit size ─────────────────────────
router.get('/unit-revenue', async (req, res) => {
  const scope = await siteScope(req.query.site);
  const [units, activeContracts, revenueAgg] = await Promise.all([
    Unit.find(scope ? scope.unitFilter : {}).sort({ sizeSqf: 1, unitNumber: 1 }),
    Contract.find({ ...(scope ? scope.contractFilter : {}), status: 'active' }).select('unit rate'),
    Payment.aggregate([
      { $match: { ...(scope ? scope.paymentFilter : {}), status: 'paid' } },
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
  const yearEnd = new Date(year + 1, 0, 1);

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

  const scope = await siteScope(req.query.site);
  const pF = scope ? scope.paymentFilter : {};
  const [contracts, overdueAgg] = await Promise.all([
    Contract.find({ ...(scope ? scope.contractFilter : {}), status: 'active' })
      .populate('customer', 'fullName')
      .populate('unit', 'unitNumber sizeSqf'),
    Payment.aggregate([
      { $match: { ...pF, status: { $in: ['pending', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  // Historical: actual paid per month (last 3 months)
  const histStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const historicalAgg = await Payment.aggregate([
    { $match: { ...pF, status: 'paid', paidDate: { $gte: histStart } } },
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

// ── Income Analysis: Expected vs Actual, discount loss, extras ─────────────────
router.get('/income-analysis', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const payments = await Payment.aggregate([
    { $match: { dueDate: { $gte: yearStart, $lt: yearEnd } } },
    { $lookup: { from: 'contracts', localField: 'contract', foreignField: '_id', as: 'c' } },
    { $unwind: '$c' },
    { $lookup: { from: 'units', localField: 'c.unit', foreignField: '_id', as: 'u' } },
    { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'invoices', localField: 'invoice', foreignField: '_id', as: 'inv' } },
    { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
    { $project: {
      amount: 1, status: 1, dueDate: 1, notes: 1,
      'c.rate': 1, 'c.contractNo': 1,
      'u.unitNumber': 1, 'u.sizeSqf': 1, 'u.price': 1, 'u.floor': 1,
      'inv.items': 1,
    }},
  ]);

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: new Date(year, i).toLocaleString('en', { month: 'short' }),
    expected: 0, actual: 0, discountLoss: 0, extras: 0, pending: 0,
  }));

  const unitMap = new Map();

  for (const p of payments) {
    const monthIdx = new Date(p.dueDate).getMonth();
    const m = months[monthIdx];
    const listPrice = Number(p.u?.price || 0);
    const contractRate = Number(p.c?.rate || 0);
    const weeklyList = Math.round((listPrice / 4) * 100) / 100;
    const weeklyActual = Math.round((contractRate / 4) * 100) / 100;
    const isDeposit = /security deposit/i.test(p.notes || '');

    // Check invoice items for non-rent extras
    let extraFromInvoice = 0;
    if (p.inv?.items) {
      for (const item of p.inv.items) {
        if (!/^Storage Rent/i.test(item.itemDetails || '') && !/Security Deposit/i.test(item.itemDetails || '')) {
          extraFromInvoice += Number(item.amount || 0);
        }
      }
    }

    if (isDeposit) continue;

    if (extraFromInvoice > 0) {
      m.extras += extraFromInvoice;
      if (p.status === 'paid') m.actual += p.amount;
      else m.pending += p.amount;
      m.expected += p.amount;
      continue;
    }

    // Expected at list price
    const weeks = weeklyActual > 0 ? Math.max(1, Math.round(p.amount / weeklyActual)) : 1;
    m.expected += weeklyList > 0 ? weeklyList * weeks : p.amount;

    if (p.status === 'paid') m.actual += p.amount;
    else m.pending += p.amount;

    if (listPrice > 0 && contractRate < listPrice) {
      m.discountLoss += (weeklyList - weeklyActual) * weeks;
    }

    // Per unit
    const unitKey = p.u?.unitNumber || 'Unknown';
    if (!unitMap.has(unitKey)) {
      unitMap.set(unitKey, { unitNumber: unitKey, floor: p.u?.floor, sizeSqf: p.u?.sizeSqf, listPrice, expected: 0, actual: 0, discountLoss: 0 });
    }
    const uu = unitMap.get(unitKey);
    uu.expected += weeklyList > 0 ? weeklyList * weeks : p.amount;
    if (p.status === 'paid') uu.actual += p.amount;
    if (listPrice > 0 && contractRate < listPrice) {
      uu.discountLoss += (weeklyList - weeklyActual) * weeks;
    }
  }

  for (const m of months) {
    m.expected = Math.round(m.expected); m.actual = Math.round(m.actual);
    m.discountLoss = Math.round(m.discountLoss); m.extras = Math.round(m.extras);
    m.pending = Math.round(m.pending);
  }

  const byUnit = Array.from(unitMap.values()).map(u => ({
    ...u, expected: Math.round(u.expected), actual: Math.round(u.actual), discountLoss: Math.round(u.discountLoss),
  })).sort((a, b) => b.discountLoss - a.discountLoss);

  const totals = {
    expected: months.reduce((s, m) => s + m.expected, 0),
    actual: months.reduce((s, m) => s + m.actual, 0),
    discountLoss: months.reduce((s, m) => s + m.discountLoss, 0),
    extras: months.reduce((s, m) => s + m.extras, 0),
    pending: months.reduce((s, m) => s + m.pending, 0),
  };

  res.json({ year, months, byUnit, totals });
});

export default router;
