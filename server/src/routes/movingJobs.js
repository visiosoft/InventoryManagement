import { Router } from 'express';
import { MovingJob, nextMovingJobNo } from '../models/index.js';

const router = Router();

const POPULATE_JOB = [
  { path: 'customer', select: 'fullName phone email' },
  { path: 'lead', select: 'prospectName prospectPhone status' },
  { path: 'crew.worker', select: 'name phone role' },
  { path: 'trucks.truck', select: 'name plateNumber type capacityCbm' },
  { path: 'teamLead', select: 'name phone' },
  { path: 'materialUsage.item', select: 'name sku' },
  { path: 'survey', select: 'totalEstimatedVolumeCbm recommendedTruckType surveyedAt' },
  { path: 'quote', select: 'quoteNo status total' },
  { path: 'invoice', select: 'invoiceNo status total balanceDue' },
];

// ── Schedule range query (must be BEFORE /:id) ─────────────────────────────
router.get('/schedule', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
    const jobs = await MovingJob.find({
      scheduledDate: { $gte: new Date(from), $lte: new Date(to) },
      status: { $nin: ['cancelled'] },
    })
      .populate({ path: 'customer', select: 'fullName' })
      .populate({ path: 'crew.worker', select: 'name role' })
      .populate({ path: 'trucks.truck', select: 'name plateNumber' })
      .sort({ scheduledDate: 1 });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List jobs
router.get('/', async (req, res) => {
  try {
    const { status, q, customer, limit = 100, skip = 0 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (customer) filter.customer = customer;
    if (q) {
      filter.$or = [
        { jobNo: { $regex: q, $options: 'i' } },
        { pickupAddress: { $regex: q, $options: 'i' } },
        { deliveryAddress: { $regex: q, $options: 'i' } },
      ];
    }
    const [jobs, total] = await Promise.all([
      MovingJob.find(filter)
        .populate('customer', 'fullName phone')
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit)),
      MovingJob.countDocuments(filter),
    ]);
    res.json({ jobs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create job
router.post('/', async (req, res) => {
  try {
    const jobNo = await nextMovingJobNo();
    const job = await MovingJob.create({ ...req.body, jobNo });
    res.status(201).json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single job (populated)
router.get('/:id', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id).populate(POPULATE_JOB);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update job
router.put('/:id', async (req, res) => {
  try {
    const { jobNo, ...update } = req.body;
    const job = await MovingJob.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).populate(POPULATE_JOB);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const job = await MovingJob.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch costs
router.patch('/:id/costs', async (req, res) => {
  try {
    const job = await MovingJob.findByIdAndUpdate(
      req.params.id,
      { $set: { costs: req.body } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job.costs);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add timeline note
router.post('/:id/notes', async (req, res) => {
  try {
    const { text, author } = req.body;
    const job = await MovingJob.findByIdAndUpdate(
      req.params.id,
      { $push: { timeline: { text, author, at: new Date() } } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job.timeline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete timeline note by index
router.delete('/:id/notes/:idx', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= job.timeline.length) return res.status(400).json({ error: 'Invalid index' });
    job.timeline.splice(idx, 1);
    await job.save();
    res.json(job.timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link quote to job
router.patch('/:id/link-quote', async (req, res) => {
  try {
    const job = await MovingJob.findByIdAndUpdate(req.params.id, { quote: req.body.quoteId }, { new: true });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Link invoice to job
router.patch('/:id/link-invoice', async (req, res) => {
  try {
    const job = await MovingJob.findByIdAndUpdate(req.params.id, { invoice: req.body.invoiceId }, { new: true });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete job
router.delete('/:id', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (['in_progress', 'invoiced'].includes(job.status)) {
      return res.status(409).json({ error: 'Cannot delete a job that is in progress or invoiced' });
    }
    await job.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
