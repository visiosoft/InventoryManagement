import { Router } from 'express';
import crypto from 'crypto';
import { MovingQuote, nextMovingQuoteNo } from '../models/index.js';
import { generateMovingQuotePdf } from '../services/movingQuotePdf.js';

const router = Router();

// List quotes
router.get('/', async (req, res) => {
  try {
    const { status, customer } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (customer) filter.customer = customer;
    const quotes = await MovingQuote.find(filter)
      .populate('customer', 'fullName phone email')
      .populate('job', 'jobNo status')
      .sort({ createdAt: -1 });
    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create quote
router.post('/', async (req, res) => {
  try {
    const quoteNo = await nextMovingQuoteNo();
    const quote = await MovingQuote.create({ ...req.body, quoteNo });
    res.status(201).json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single quote
router.get('/:id', async (req, res) => {
  try {
    const quote = await MovingQuote.findById(req.params.id)
      .populate('customer', 'fullName phone email address')
      .populate('job', 'jobNo status scheduledDate pickupAddress deliveryAddress');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update quote
router.put('/:id', async (req, res) => {
  try {
    const { quoteNo, ...update } = req.body;
    const quote = await MovingQuote.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate('customer', 'fullName phone email address')
      .populate('job', 'jobNo status');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const quote = await MovingQuote.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate PDF (with optional share token for public access)
router.get('/:id/pdf', async (req, res) => {
  try {
    const { token } = req.query;
    const quote = await MovingQuote.findById(req.params.id)
      .populate('customer')
      .populate('job', 'jobNo pickupAddress deliveryAddress scheduledDate');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    // Allow access if authenticated OR has valid share token
    if (!req.user && !token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (token && quote.shareToken !== token) {
      return res.status(403).json({ error: 'Invalid share token' });
    }

    const pdf = await generateMovingQuotePdf(quote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.quoteNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate share token
router.post('/:id/share-token', async (req, res) => {
  try {
    const token = crypto.randomUUID();
    const quote = await MovingQuote.findByIdAndUpdate(req.params.id, { shareToken: token }, { new: true });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete quote
router.delete('/:id', async (req, res) => {
  try {
    await MovingQuote.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
