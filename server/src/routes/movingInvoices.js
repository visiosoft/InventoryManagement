import { Router } from 'express';
import crypto from 'crypto';
import { MovingInvoice, nextMovingInvoiceNo } from '../models/index.js';
import { generateMovingInvoicePdf } from '../services/movingInvoicePdf.js';

const router = Router();

const POPULATE_INV = [
  { path: 'customer', select: 'fullName phone email address' },
  { path: 'job', select: 'jobNo status scheduledDate pickupAddress deliveryAddress' },
];

// List invoices
router.get('/', async (req, res) => {
  try {
    const { status, customer } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (customer) filter.customer = customer;
    const invoices = await MovingInvoice.find(filter)
      .populate('customer', 'fullName phone email')
      .populate('job', 'jobNo status')
      .sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create invoice
router.post('/', async (req, res) => {
  try {
    const invoiceNo = await nextMovingInvoiceNo();
    const body = req.body;
    const balanceDue = (body.total || 0) - (body.depositPaid || 0);
    const invoice = await MovingInvoice.create({ ...body, invoiceNo, balanceDue });
    res.status(201).json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get invoice
router.get('/:id', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findById(req.params.id).populate(POPULATE_INV);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update invoice
router.put('/:id', async (req, res) => {
  try {
    const { invoiceNo, ...update } = req.body;
    if (update.total !== undefined || update.depositPaid !== undefined) {
      const inv = await MovingInvoice.findById(req.params.id);
      const total = update.total ?? inv.total;
      const paid = (update.depositPaid ?? inv.depositPaid) +
        (inv.paymentHistory?.reduce((s, p) => s + p.amount, 0) ?? 0);
      update.balanceDue = Math.max(0, total - paid);
    }
    const invoice = await MovingInvoice.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate(POPULATE_INV);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const invoice = await MovingInvoice.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Record payment
router.post('/:id/record-payment', async (req, res) => {
  try {
    const { amount, method, date, notes } = req.body;
    const invoice = await MovingInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    invoice.paymentHistory.push({ amount: Number(amount), method, date: date ? new Date(date) : new Date(), notes });
    const totalPaid = invoice.depositPaid + invoice.paymentHistory.reduce((s, p) => s + p.amount, 0);
    invoice.balanceDue = Math.max(0, invoice.total - totalPaid);
    invoice.status = invoice.balanceDue <= 0 ? 'paid' : 'partial';
    await invoice.save();

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate PDF (with optional share token for public access)
router.get('/:id/pdf', async (req, res) => {
  try {
    const { token } = req.query;
    const invoice = await MovingInvoice.findById(req.params.id).populate(POPULATE_INV);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Allow access if authenticated OR has valid share token
    if (!req.user && !token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (token && invoice.shareToken !== token) {
      return res.status(403).json({ error: 'Invalid share token' });
    }

    const pdf = await generateMovingInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Share token
router.post('/:id/share-token', async (req, res) => {
  try {
    const token = crypto.randomUUID();
    const invoice = await MovingInvoice.findByIdAndUpdate(req.params.id, { shareToken: token }, { new: true });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const inv = await MovingInvoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (['paid'].includes(inv.status)) return res.status(409).json({ error: 'Cannot delete a paid invoice' });
    await inv.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
