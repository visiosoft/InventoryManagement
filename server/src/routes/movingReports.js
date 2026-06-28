import { Router } from 'express';
import { MovingJob, MovingInvoice } from '../models/index.js';

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
    const rows = await MovingJob.aggregate([
      { $match: { status: { $nin: ['cancelled', 'draft'] } } },
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
    const rows = await MovingJob.aggregate([
      { $match: { status: { $nin: ['cancelled', 'draft'] } } },
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
      { $unwind: { path: '$_truck', preserveNullAndEmpty: true } },
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

// Job profitability — revenue vs cost per job
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
      .limit(200);

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

    res.json({ rows, summary: { totalRevenue, totalCost, totalProfit, avgMargin, jobCount: rows.length } });
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
