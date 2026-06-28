import { Router } from 'express';
import { MovingClaim, MovingJob, nextMovingClaimNo } from '../models/index.js';

const router = Router();

const POPULATE = [
  { path: 'job', select: 'jobNo status pickupAddress deliveryAddress scheduledDate' },
  { path: 'customer', select: 'fullName phone email' },
];

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.job) filter.job = req.query.job;
    if (req.query.customer) filter.customer = req.query.customer;
    if (req.query.search) {
      const re = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ claimNo: re }, { itemDescription: re }, { damageDescription: re }];
    }
    const claims = await MovingClaim.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(200);
    res.json(claims);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.body.job);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const claimNo = await nextMovingClaimNo();
    const claim = await MovingClaim.create({
      claimNo,
      job: job._id,
      customer: job.customer,
      itemDescription: req.body.itemDescription,
      damageDescription: req.body.damageDescription || '',
      claimedAmount: Number(req.body.claimedAmount || 0),
      reportedBy: req.body.reportedBy || req.user?.name || '',
      insuranceRef: req.body.insuranceRef || '',
      notes: req.body.notes || '',
      timeline: [{ text: 'Claim reported', author: req.user?.name || 'System' }],
    });
    res.status(201).json(await claim.populate(POPULATE));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const claim = await MovingClaim.findById(req.params.id).populate(POPULATE);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { claimNo, ...update } = req.body;
    const claim = await MovingClaim.findByIdAndUpdate(req.params.id, update, { new: true }).populate(POPULATE);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, approvedAmount, settledAmount, resolution } = req.body;
    const claim = await MovingClaim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    claim.status = status;
    if (approvedAmount !== undefined) claim.approvedAmount = Number(approvedAmount);
    if (settledAmount !== undefined) { claim.settledAmount = Number(settledAmount); claim.settledDate = new Date(); }
    if (resolution) claim.resolution = resolution;
    claim.timeline.push({ text: `Status changed to ${status}`, author: req.user?.name || 'System' });
    await claim.save();
    res.json(await claim.populate(POPULATE));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/notes', async (req, res) => {
  try {
    const claim = await MovingClaim.findByIdAndUpdate(
      req.params.id,
      { $push: { timeline: { text: req.body.text, author: req.body.author || req.user?.name || '' } } },
      { new: true }
    );
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim.timeline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const claim = await MovingClaim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status === 'settled') return res.status(409).json({ error: 'Cannot delete a settled claim' });
    await claim.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
