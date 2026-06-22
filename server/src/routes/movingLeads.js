import { Router } from 'express';
import { MovingLead, MovingJob, nextMovingJobNo } from '../models/index.js';

const router = Router();

// List leads
router.get('/', async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { prospectName: { $regex: q, $options: 'i' } },
        { prospectPhone: { $regex: q, $options: 'i' } },
      ];
    }
    const leads = await MovingLead.find(filter)
      .populate('customer', 'fullName phone email')
      .sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create lead
router.post('/', async (req, res) => {
  try {
    const lead = await MovingLead.create(req.body);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get lead
router.get('/:id', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id).populate('customer', 'fullName phone email address');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const lead = await MovingLead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('customer', 'fullName phone email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await MovingLead.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add timeline note
router.post('/:id/notes', async (req, res) => {
  try {
    const { text, author } = req.body;
    const lead = await MovingLead.findByIdAndUpdate(
      req.params.id,
      { $push: { timeline: { text, author, at: new Date() } } },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead.timeline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete timeline note by index
router.delete('/:id/notes/:idx', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= lead.timeline.length) return res.status(400).json({ error: 'Invalid index' });
    lead.timeline.splice(idx, 1);
    await lead.save();
    res.json(lead.timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert lead to job
router.post('/:id/convert', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const jobNo = await nextMovingJobNo();
    const job = await MovingJob.create({
      jobNo,
      customer: lead.customer || req.body.customer,
      lead: lead._id,
      pickupAddress: lead.pickupAddress,
      deliveryAddress: lead.deliveryAddress,
      scheduledDate: lead.moveDate,
      status: 'draft',
      notes: lead.notes,
    });

    await MovingLead.findByIdAndUpdate(lead._id, { status: 'won' });

    res.status(201).json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    await MovingLead.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
