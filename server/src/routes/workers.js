import { Router } from 'express';
import { Worker, MovingJob } from '../models/index.js';

const router = Router();

function escRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// List workers
router.get('/', async (req, res) => {
  try {
    const { q, status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) filter.name = { $regex: escRegex(q), $options: 'i' };
    const workers = await Worker.find(filter).sort({ name: 1 });
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create worker
router.post('/', async (req, res) => {
  try {
    const worker = await Worker.create(req.body);
    res.status(201).json(worker);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get worker
router.get('/:id', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Recent jobs this worker was assigned to
    const recentJobs = await MovingJob.find({ 'crew.worker': worker._id })
      .select('jobNo scheduledDate status customer')
      .populate('customer', 'fullName')
      .sort({ scheduledDate: -1 })
      .limit(20);

    res.json({ worker, recentJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update worker
router.put('/:id', async (req, res) => {
  try {
    const worker = await Worker.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json(worker);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const worker = await Worker.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json(worker);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete worker
router.delete('/:id', async (req, res) => {
  try {
    const inUse = await MovingJob.exists({ 'crew.worker': req.params.id, status: { $in: ['confirmed', 'in_progress'] } });
    if (inUse) return res.status(409).json({ error: 'Worker is assigned to an active job' });
    await Worker.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
