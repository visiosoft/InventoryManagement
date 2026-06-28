import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { MovingJob, MovingItem, MovingStockTxn, Customer, nextMovingJobNo } from '../models/index.js';
import { notifyJobConfirmed, notifyCrewOnTheWay, notifyJobCompleted } from '../services/movingNotifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_UPLOADS = path.resolve(__dirname, '../../../uploads/moving-jobs');
fs.mkdirSync(JOBS_UPLOADS, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: JOBS_UPLOADS,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

function recalcCosts(job) {
  job.costs.labor = job.crew.reduce((s, c) => s + ((c.dailyRate || 0) * (c.days || 1)) + ((c.extraHours || 0) * (c.extraHourRate || 0)), 0);
  job.costs.truck = job.trucks.reduce((s, t) => s + ((t.dailyRate || 0) * (t.days || 1)), 0);
  job.costs.materials = job.materialUsage.reduce((s, m) => s + (m.qty * m.unitCost), 0);
  job.costs.externalHires = job.externalHires.reduce((s, h) => s + (h.cost || 0), 0);
  job.costs.extras = (job.extraCharges || []).reduce((s, e) => s + (e.amount || 0), 0);
  job.costs.total = job.costs.labor + job.costs.truck + job.costs.materials +
    job.costs.packing + job.costs.extras + job.costs.externalHires;
}

const POPULATE_JOB = [
  { path: 'customer', select: 'fullName phone email' },
  { path: 'lead', select: 'prospectName prospectPhone status' },
  { path: 'crew.worker', select: 'name phone role' },
  { path: 'trucks.truck', select: 'name plateNumber type capacityCbm dailyRate' },
  { path: 'teamLead', select: 'name phone' },
  { path: 'materialUsage.item', select: 'name sku retailPrice' },
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
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    Object.assign(job, update);
    if (update.crew || update.trucks || update.extraCharges) recalcCosts(job);
    await job.save();
    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
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

    const customer = await Customer.findById(job.customer).select('fullName phone email');
    if (customer) {
      if (status === 'confirmed') notifyJobConfirmed(job, customer);
      if (status === 'in_progress') notifyCrewOnTheWay(job, customer);
      if (status === 'completed') notifyJobCompleted(job, customer);
    }

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

// ── Material usage ──────────────────────────────────────────────────────────
router.post('/:id/materials', async (req, res) => {
  try {
    const { itemId, qty, notes } = req.body;
    const item = await MovingItem.findById(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.onHand < qty) return res.status(400).json({ error: `Only ${item.onHand} in stock` });

    const unitCost = item.retailPrice || 0;
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    job.materialUsage.push({ item: itemId, qty, unitCost, notes: notes || '' });
    recalcCosts(job);
    await job.save();

    // Deduct stock
    const prev = item.onHand;
    item.onHand -= qty;
    await item.save();
    await MovingStockTxn.create({
      item: itemId, txnType: 'out', qty, previousOnHand: prev,
      reason: `Used on job ${job.jobNo}`, movingJob: job._id,
    });

    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/materials/:idx', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= job.materialUsage.length) return res.status(400).json({ error: 'Invalid index' });

    const removed = job.materialUsage[idx];
    job.materialUsage.splice(idx, 1);
    recalcCosts(job);
    await job.save();

    // Return stock
    const item = await MovingItem.findById(removed.item);
    if (item) {
      const prev = item.onHand;
      item.onHand += removed.qty;
      await item.save();
      await MovingStockTxn.create({
        item: removed.item, txnType: 'in', qty: removed.qty, previousOnHand: prev,
        reason: `Returned from job ${job.jobNo}`, movingJob: job._id,
      });
    }

    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── External hires ──────────────────────────────────────────────────────────
router.post('/:id/external-hires', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { title, name, duration, hours, rate, notes } = req.body;
    const cost = (rate || 0) * (hours || 0);
    job.externalHires.push({ title, name, duration, hours, rate, cost, notes });
    recalcCosts(job);
    await job.save();

    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/external-hires/:idx', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= job.externalHires.length) return res.status(400).json({ error: 'Invalid index' });
    job.externalHires.splice(idx, 1);
    recalcCosts(job);
    await job.save();

    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Extra charges ──────────────────────────────────────────────────────────
router.post('/:id/extras', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { description, amount, notes } = req.body;
    job.extraCharges.push({ description, amount: Number(amount || 0), notes: notes || '' });
    recalcCosts(job);
    await job.save();
    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/extras/:idx', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= job.extraCharges.length) return res.status(400).json({ error: 'Invalid index' });
    job.extraCharges.splice(idx, 1);
    recalcCosts(job);
    await job.save();
    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Set supervisor ──────────────────────────────────────────────────────────
router.patch('/:id/supervisor', async (req, res) => {
  try {
    const { workerIdx } = req.body;
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    job.crew.forEach((c, i) => { c.isSupervisor = i === workerIdx; });
    await job.save();

    const populated = await MovingJob.findById(job._id).populate(POPULATE_JOB);
    res.json(populated);
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

// ── Image upload ───────────────────────────────────────────────────────────
router.post('/:id/images', upload.array('images', 20), async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const newImages = (req.files || []).map(f => ({
      url: `/uploads/moving-jobs/${f.filename}`,
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      uploadedAt: new Date(),
    }));

    if (!job.images) job.images = [];
    job.images.push(...newImages);
    await job.save();
    res.json(job.images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/images/:idx', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const idx = Number(req.params.idx);
    const img = job.images?.[idx];
    if (!img) return res.status(404).json({ error: 'Image not found' });

    const filePath = path.join(JOBS_UPLOADS, img.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    job.images.splice(idx, 1);
    await job.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Supervisor field-price override ────────────────────────────────────────
router.patch('/:id/field-price', async (req, res) => {
  try {
    const { amount, notes, supervisorName } = req.body;
    const job = await MovingJob.findByIdAndUpdate(
      req.params.id,
      { fieldPriceOverride: { amount: Number(amount), notes: notes || '', supervisorName: supervisorName || '', adjustedAt: new Date() } },
      { new: true }
    ).populate(POPULATE_JOB);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
