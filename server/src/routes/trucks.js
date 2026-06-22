import { Router } from 'express';
import { Truck, MovingJob } from '../models/index.js';

const router = Router();

// List trucks
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const trucks = await Truck.find(filter).sort({ name: 1 });
    res.json(trucks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create truck
router.post('/', async (req, res) => {
  try {
    const truck = await Truck.create(req.body);
    res.status(201).json(truck);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get truck
router.get('/:id', async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    const recentJobs = await MovingJob.find({ 'trucks.truck': truck._id })
      .select('jobNo scheduledDate status customer')
      .populate('customer', 'fullName')
      .sort({ scheduledDate: -1 })
      .limit(20);

    res.json({ truck, recentJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update truck
router.put('/:id', async (req, res) => {
  try {
    const truck = await Truck.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    res.json(truck);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const truck = await Truck.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    res.json(truck);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete truck
router.delete('/:id', async (req, res) => {
  try {
    const inUse = await MovingJob.exists({ 'trucks.truck': req.params.id, status: { $in: ['confirmed', 'in_progress'] } });
    if (inUse) return res.status(409).json({ error: 'Truck is assigned to an active job' });
    await Truck.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
