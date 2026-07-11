const express = require('express');
const Lead = require('../models/Lead');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { computeQuote, defaultTracking } = require('../utils/quote');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/moves?status=pending_review
router.get('/moves', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const leads = await Lead.find(filter).sort({ createdAt: -1 }).populate('user', 'phone name');
  res.json(leads);
});

// GET /api/admin/moves/:id
router.get('/moves/:id', async (req, res) => {
  const lead = await Lead.findById(req.params.id).populate('user', 'phone name');
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json(lead);
});

// POST /api/admin/moves/:id/quote
router.post('/moves/:id/quote', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found' });

    let lines = req.body.lines;
    let subtotal, vat, total;
    if (Array.isArray(lines) && lines.length) {
      subtotal = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
      vat = Math.round(subtotal * 0.05);
      total = subtotal + vat;
    } else {
      const q = computeQuote(lead);
      lines = q.lines; subtotal = q.subtotal; vat = q.vat; total = q.total;
    }

    const validDays = Number(req.body.validDays || 7);
    lead.quote = {
      lines, subtotal, vat, total,
      reviewedBy: req.body.reviewedBy || req.user.name || 'Ops team',
      validUntil: new Date(Date.now() + validDays * 864e5),
      createdAt: new Date(),
    };
    lead.tracking = defaultTracking(lead);
    lead.tracking[0].state = 'todo';
    lead.status = 'quoted';
    await lead.save();
    res.json(lead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/moves/:id/status  { status, stepIndex? }
router.post('/moves/:id/status', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (req.body.status) lead.status = req.body.status;

    if (typeof req.body.stepIndex === 'number' && lead.tracking.length) {
      lead.tracking = lead.tracking.map((s, i) => ({
        ...s.toObject?.() ?? s,
        state: i < req.body.stepIndex ? 'done' : i === req.body.stepIndex ? 'active' : 'todo',
      }));
    }
    await lead.save();
    res.json(lead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
