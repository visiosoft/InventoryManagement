import { Router } from 'express';
import { MovingJob, MovingInvoice, MovingLead, MovingQuote, MovingClaim } from '../models/index.js';

const router = Router();

// Dashboard summary
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [
      totalJobs,
      jobsThisMonth,
      activeJobs,
      revenueResult,
      revenueThisMonthResult,
      upcomingJobs,
    ] = await Promise.all([
      MovingJob.countDocuments({ status: { $ne: 'cancelled' } }),
      MovingJob.countDocuments({ scheduledDate: { $gte: startOfMonth, $lte: endOfMonth }, status: { $ne: 'cancelled' } }),
      MovingJob.countDocuments({ status: { $in: ['confirmed', 'in_progress'] } }),
      MovingInvoice.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      MovingInvoice.aggregate([
        { $match: { status: 'paid', invoiceDate: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      MovingJob.find({ scheduledDate: { $gte: now }, status: { $nin: ['cancelled', 'completed', 'invoiced'] } })
        .populate('customer', 'fullName')
        .populate('trucks.truck', 'name')
        .sort({ scheduledDate: 1 })
        .limit(10),
    ]);

    res.json({
      totalJobs,
      jobsThisMonth,
      activeJobs,
      totalRevenue: revenueResult[0]?.total ?? 0,
      revenueThisMonth: revenueThisMonthResult[0]?.total ?? 0,
      upcomingJobs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Monthly revenue
router.get('/revenue', async (req, res) => {
  try {
    const months = Number(req.query.months) || 12;
    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const rows = await MovingInvoice.aggregate([
      { $match: { status: 'paid', invoiceDate: { $gte: from } } },
      {
        $group: {
          _id: { year: { $year: '$invoiceDate' }, month: { $month: '$invoiceDate' } },
          revenue: { $sum: '$total' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jobs by status / type
router.get('/jobs', async (req, res) => {
  try {
    const [byStatus, byType] = await Promise.all([
      MovingJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      MovingJob.aggregate([{ $group: { _id: '$jobType', count: { $sum: 1 } } }]),
    ]);
    res.json({ byStatus, byType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crew utilisation — jobs per worker in date range
router.get('/crew', async (req, res) => {
  try {
    const match = { status: { $nin: ['cancelled', 'draft'] } };
    if (req.query.from || req.query.to) {
      match.scheduledDate = {};
      if (req.query.from) match.scheduledDate.$gte = new Date(req.query.from);
      if (req.query.to) match.scheduledDate.$lte = new Date(req.query.to);
    }
    const rows = await MovingJob.aggregate([
      { $match: match },
      { $unwind: '$crew' },
      {
        $group: {
          _id: '$crew.worker',
          jobCount: { $sum: 1 },
          totalEarnings: { $sum: { $multiply: [{ $ifNull: ['$crew.dailyRate', 0] }, { $ifNull: ['$crew.days', 1] }] } },
        },
      },
      {
        $lookup: {
          from: 'workers',
          localField: '_id',
          foreignField: '_id',
          as: '_worker',
        },
      },
      { $unwind: { path: '$_worker', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          workerId: '$_id',
          name: '$_worker.name',
          role: '$_worker.role',
          jobCount: 1,
          totalEarnings: 1,
        },
      },
      { $sort: { jobCount: -1 } },
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fleet utilisation — jobs per truck
router.get('/fleet', async (req, res) => {
  try {
    const match = { status: { $nin: ['cancelled', 'draft'] } };
    if (req.query.from || req.query.to) {
      match.scheduledDate = {};
      if (req.query.from) match.scheduledDate.$gte = new Date(req.query.from);
      if (req.query.to) match.scheduledDate.$lte = new Date(req.query.to);
    }
    const rows = await MovingJob.aggregate([
      { $match: match },
      { $unwind: '$trucks' },
      {
        $group: {
          _id: '$trucks.truck',
          jobCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'trucks',
          localField: '_id',
          foreignField: '_id',
          as: '_truck',
        },
      },
      { $unwind: { path: '$_truck', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          truckId: '$_id',
          name: '$_truck.name',
          plateNumber: '$_truck.plateNumber',
          type: '$_truck.type',
          jobCount: 1,
        },
      },
      { $sort: { jobCount: -1 } },
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Job profitability — revenue vs cost per job, plus a monthly rollup for the trend chart
router.get('/profitability', async (req, res) => {
  try {
    const filter = { status: { $in: ['completed', 'invoiced'] } };
    if (req.query.from) filter.scheduledDate = { ...filter.scheduledDate, $gte: new Date(req.query.from) };
    if (req.query.to) filter.scheduledDate = { ...filter.scheduledDate, $lte: new Date(req.query.to) };

    const jobs = await MovingJob.find(filter)
      .populate('customer', 'fullName')
      .populate('invoice', 'invoiceNo total status')
      .select('jobNo customer scheduledDate costs invoice status')
      .sort({ scheduledDate: -1 })
      .limit(500);

    const rows = jobs.map(j => {
      const revenue = j.invoice?.total ?? 0;
      const cost = j.costs?.total ?? 0;
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        _id: j._id, jobNo: j.jobNo, customer: j.customer?.fullName,
        scheduledDate: j.scheduledDate, status: j.status,
        invoiceNo: j.invoice?.invoiceNo, invoiceStatus: j.invoice?.status,
        revenue, cost, profit, margin: Math.round(margin * 10) / 10,
        costs: j.costs,
      };
    });

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMargin = totalRevenue > 0 ? Math.round(((totalProfit / totalRevenue) * 100) * 10) / 10 : 0;

    const byMonth = new Map();
    for (const r of rows) {
      if (!r.scheduledDate) continue;
      const d = new Date(r.scheduledDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = byMonth.get(key) || { month: key, revenue: 0, cost: 0, jobCount: 0 };
      m.revenue += r.revenue; m.cost += r.cost; m.jobCount += 1;
      byMonth.set(key, m);
    }
    const monthly = [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, profit: m.revenue - m.cost, margin: m.revenue > 0 ? Math.round(((m.revenue - m.cost) / m.revenue) * 1000) / 10 : 0 }));

    res.json({ rows, monthly, summary: { totalRevenue, totalCost, totalProfit, avgMargin, jobCount: rows.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accounts Receivable — outstanding invoices bucketed by days past due
router.get('/ar', async (req, res) => {
  try {
    const now = new Date();
    const invoices = await MovingInvoice.find({ status: { $in: ['sent', 'partial'] }, balanceDue: { $gt: 0 } })
      .populate('customer', 'fullName phone email')
      .populate('job', 'jobNo')
      .select('invoiceNo customer job total balanceDue dueDate invoiceDate status')
      .sort({ dueDate: 1 })
      .lean();

    const bucketOf = (dueDate) => {
      const days = Math.floor((now - new Date(dueDate)) / 86400000);
      if (days <= 0) return 'current';
      if (days <= 30) return 'd30';
      if (days <= 60) return 'd60';
      if (days <= 90) return 'd90';
      return 'd90plus';
    };

    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    const byCustomer = new Map();

    for (const inv of invoices) {
      const bucket = bucketOf(inv.dueDate);
      buckets[bucket] += inv.balanceDue;

      const custId = String(inv.customer?._id || 'unknown');
      if (!byCustomer.has(custId)) {
        byCustomer.set(custId, {
          customerId: custId,
          customer: inv.customer?.fullName || 'Unknown',
          phone: inv.customer?.phone || '',
          email: inv.customer?.email || '',
          totalOutstanding: 0,
          worstBucket: 'current',
          invoices: [],
        });
      }
      const row = byCustomer.get(custId);
      row.totalOutstanding += inv.balanceDue;
      const order = ['current', 'd30', 'd60', 'd90', 'd90plus'];
      if (order.indexOf(bucket) > order.indexOf(row.worstBucket)) row.worstBucket = bucket;
      row.invoices.push({
        invoiceId: inv._id, invoiceNo: inv.invoiceNo, jobNo: inv.job?.jobNo,
        total: inv.total, balanceDue: inv.balanceDue, dueDate: inv.dueDate, invoiceDate: inv.invoiceDate, bucket,
      });
    }

    const rows = [...byCustomer.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    const totalOutstanding = Object.values(buckets).reduce((s, v) => s + v, 0);

    res.json({ rows, buckets, totalOutstanding });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Monthly cost breakdown — labor / truck / materials / packing / extras / external hires
router.get('/costs', async (req, res) => {
  try {
    const months = Number(req.query.months) || 12;
    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const jobs = await MovingJob.find({
      status: { $in: ['completed', 'invoiced'] },
      scheduledDate: { $gte: from },
    }).select('scheduledDate costs clientPackage invoice').populate('invoice', 'total').lean();

    // What the client was actually billed. Most moving jobs go through the
    // agreed package price (set at booking) rather than a formal invoice —
    // only fall back to the linked invoice total when no package was agreed.
    const clientTotalOf = (j) => {
      const pkg = j.clientPackage;
      if (pkg && (pkg.agreedPrice > 0 || pkg.additionalCharges?.length)) {
        const addons = (pkg.additionalCharges || []).reduce((s, a) => s + (a.amount || 0), 0);
        return (pkg.agreedPrice || 0) + addons;
      }
      return j.invoice?.total ?? 0;
    };

    const byMonth = new Map();
    const categories = ['labor', 'truck', 'materials', 'packing', 'extras', 'externalHires'];
    for (const j of jobs) {
      if (!j.scheduledDate) continue;
      const d = new Date(j.scheduledDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) {
        byMonth.set(key, { month: key, labor: 0, truck: 0, materials: 0, packing: 0, extras: 0, externalHires: 0, total: 0, clientTotal: 0, jobCount: 0 });
      }
      const m = byMonth.get(key);
      for (const c of categories) m[c] += j.costs?.[c] ?? 0;
      m.total += j.costs?.total ?? 0;
      m.clientTotal += clientTotalOf(j);
      m.jobCount += 1;
    }

    const rows = [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ ...r, margin: r.clientTotal - r.total }));
    const totals = rows.reduce((t, r) => {
      for (const c of categories) t[c] += r[c];
      t.total += r.total;
      t.clientTotal += r.clientTotal;
      t.jobCount += r.jobCount;
      return t;
    }, { labor: 0, truck: 0, materials: 0, packing: 0, extras: 0, externalHires: 0, total: 0, clientTotal: 0, jobCount: 0 });
    totals.margin = totals.clientTotal - totals.total;

    res.json({ rows, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sales pipeline — lead funnel, win rate, quote-to-job conversion
router.get('/pipeline', async (req, res) => {
  try {
    const months = Number(req.query.months) || 6;
    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const [leadsByStatus, quotesByStatus] = await Promise.all([
      MovingLead.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      MovingQuote.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const leadCounts = Object.fromEntries(leadsByStatus.map(r => [r._id, r.count]));
    const quoteCounts = Object.fromEntries(quotesByStatus.map(r => [r._id, r.count]));

    const won = leadCounts.won ?? 0;
    const lost = leadCounts.lost ?? 0;
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : 0;

    const acceptedQuotes = quoteCounts.accepted ?? 0;
    const totalQuotes = Object.values(quoteCounts).reduce((s, v) => s + v, 0);
    const quoteConversionRate = totalQuotes > 0 ? Math.round((acceptedQuotes / totalQuotes) * 1000) / 10 : 0;

    const funnel = ['new', 'contacted', 'quoted', 'client_approved', 'won']
      .map(stage => ({ stage, count: leadCounts[stage] ?? 0 }));

    res.json({
      funnel,
      leadCounts,
      quoteCounts,
      winRate,
      quoteConversionRate,
      totalLeads: Object.values(leadCounts).reduce((s, v) => s + v, 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Damage claims — claimed vs approved vs settled, by month
router.get('/claims', async (req, res) => {
  try {
    const months = Number(req.query.months) || 12;
    const from = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const rows = await MovingClaim.aggregate([
      { $match: { createdAt: { $gte: from } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          claimed: { $sum: '$claimedAmount' },
          approved: { $sum: '$approvedAmount' },
          settled: { $sum: '$settledAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const byStatus = await MovingClaim.aggregate([
      { $match: { createdAt: { $gte: from } } },
      { $group: { _id: '$status', count: { $sum: 1 }, claimedAmount: { $sum: '$claimedAmount' } } },
    ]);

    res.json({ rows, byStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe payments received — accepts either ?months=N or explicit ?from&to
router.get('/stripe-payments', async (req, res) => {
  try {
    let from, to;
    if (req.query.from || req.query.to) {
      from = req.query.from ? new Date(req.query.from) : new Date(0);
      to = req.query.to ? new Date(req.query.to) : new Date();
    } else {
      const months = Number(req.query.months) || 12;
      from = new Date();
      from.setMonth(from.getMonth() - months + 1);
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      to = new Date();
    }

    const invoices = await MovingInvoice.find({ 'paymentHistory.notes': /Stripe Checkout/ })
      .populate('customer', 'fullName')
      .select('invoiceNo customer paymentHistory')
      .lean();

    const rows = [];
    for (const inv of invoices) {
      for (const p of inv.paymentHistory || []) {
        if (!p.notes?.includes('Stripe Checkout')) continue;
        const d = new Date(p.date);
        if (d < from || d > to) continue;
        rows.push({
          invoiceId: inv._id,
          invoiceNo: inv.invoiceNo,
          customer: inv.customer?.fullName || '',
          amount: p.amount,
          date: p.date,
          notes: p.notes,
        });
      }
    }
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));

    const byMonth = new Map();
    for (const r of rows) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, { month: key, count: 0, total: 0 });
      const m = byMonth.get(key);
      m.count += 1;
      m.total += r.amount;
    }
    const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

    const totalAmount = Number(rows.reduce((s, r) => s + r.amount, 0).toFixed(2));
    res.json({ rows, monthly, summary: { count: rows.length, totalAmount } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crew payroll — earnings per worker for a date range
router.get('/payroll', async (req, res) => {
  try {
    const match = { status: { $nin: ['cancelled', 'draft'] } };
    if (req.query.from || req.query.to) {
      match.scheduledDate = {};
      if (req.query.from) match.scheduledDate.$gte = new Date(req.query.from);
      if (req.query.to) match.scheduledDate.$lte = new Date(req.query.to);
    }

    const rows = await MovingJob.aggregate([
      { $match: match },
      { $unwind: '$crew' },
      {
        $group: {
          _id: '$crew.worker',
          jobCount: { $sum: 1 },
          basePay: { $sum: { $multiply: [{ $ifNull: ['$crew.dailyRate', 0] }, { $ifNull: ['$crew.days', 1] }] } },
          extraHours: { $sum: { $ifNull: ['$crew.extraHours', 0] } },
          extraPay: { $sum: { $multiply: [{ $ifNull: ['$crew.extraHours', 0] }, { $ifNull: ['$crew.extraHourRate', 0] }] } },
          supervisorDays: { $sum: { $cond: [{ $ifNull: ['$crew.isSupervisor', false] }, 1, 0] } },
          jobs: { $push: { jobId: '$_id', jobNo: '$jobNo', date: '$scheduledDate', dailyRate: '$crew.dailyRate', extraHours: '$crew.extraHours', extraHourRate: '$crew.extraHourRate', isSupervisor: '$crew.isSupervisor' } },
        },
      },
      {
        $lookup: { from: 'workers', localField: '_id', foreignField: '_id', as: '_worker' },
      },
      { $unwind: { path: '$_worker', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          workerId: '$_id', name: '$_worker.name', role: '$_worker.role', phone: '$_worker.phone',
          jobCount: 1, basePay: 1, extraHours: 1, extraPay: 1, supervisorDays: 1,
          totalPay: { $add: ['$basePay', '$extraPay'] },
          jobs: 1,
        },
      },
      { $sort: { totalPay: -1 } },
    ]);

    const totals = rows.reduce((t, r) => ({
      basePay: t.basePay + r.basePay,
      extraPay: t.extraPay + r.extraPay,
      totalPay: t.totalPay + r.totalPay,
      totalJobs: t.totalJobs + r.jobCount,
    }), { basePay: 0, extraPay: 0, totalPay: 0, totalJobs: 0 });

    res.json({ rows, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
