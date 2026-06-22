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
          totalEarnings: { $sum: '$crew.dailyRate' },
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
      { $unwind: { path: '$_worker', preserveNullAndEmpty: true } },
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

export default router;
