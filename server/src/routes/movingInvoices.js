import { Router } from 'express';
import crypto from 'crypto';
import { MovingInvoice, Customer, MovingJob, nextMovingInvoiceNo } from '../models/index.js';
import { generateMovingInvoicePdf } from '../services/movingInvoicePdf.js';
import { notifyInvoiceReady, notifyPaymentReceived } from '../services/movingNotifications.js';

const router = Router();

const POPULATE_INV = [
  { path: 'customer', select: 'fullName phone email address' },
  { path: 'job', select: 'jobNo status scheduledDate pickupAddress deliveryAddress' },
];

// Public payment page data (no auth — uses share token)
// MUST be before /:id to prevent Express matching "pay" as an ObjectId
router.get('/pay/:token', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findOne({ shareToken: req.params.token })
      .populate('customer', 'fullName email phone')
      .populate('job', 'jobNo pickupAddress deliveryAddress scheduledDate');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({
      invoiceNo: invoice.invoiceNo,
      customer: invoice.customer?.fullName,
      jobNo: invoice.job?.jobNo,
      items: invoice.items,
      total: invoice.total,
      depositPaid: invoice.depositPaid,
      balanceDue: invoice.balanceDue,
      status: invoice.status,
      bankInformation: invoice.bankInformation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    const customer = await Customer.findById(invoice.customer).select('fullName phone');
    if (customer) notifyPaymentReceived(customer, invoice.invoiceNo, Number(amount));

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

    const customer = await Customer.findById(invoice.customer).select('fullName phone');
    const job = invoice.job ? await MovingJob.findById(invoice.job).select('jobNo') : null;
    if (customer && job) {
      const baseUrl = process.env.APP_URL || req.headers.origin || '';
      const invoiceUrl = `${baseUrl}/moving/invoices/${invoice._id}/pdf?token=${token}`;
      notifyInvoiceReady(job, customer, invoiceUrl);
    }

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate payment link — sends WhatsApp with pay URL
router.post('/:id/payment-link', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findById(req.params.id).populate('customer', 'fullName phone email').populate('job', 'jobNo');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.balanceDue <= 0) return res.status(400).json({ error: 'Invoice already fully paid' });

    if (!invoice.shareToken) {
      invoice.shareToken = crypto.randomUUID();
      await invoice.save();
    }

    const baseUrl = process.env.APP_URL || req.headers.origin || '';
    const payUrl = `${baseUrl}/pay/moving/${invoice.shareToken}`;

    const customer = invoice.customer;
    if (customer?.phone) {
      const { sendWhatsAppText, whatsappSendConfigured } = await import('../services/whatsapp.js');
      if (whatsappSendConfigured()) {
        const msg = [
          `Hi ${customer.fullName},`,
          ``,
          `Your invoice *${invoice.invoiceNo}* is ready.`,
          `Balance due: *AED ${invoice.balanceDue.toLocaleString()}*`,
          ``,
          `💳 Pay online: ${payUrl}`,
          ``,
          `You can also pay via bank transfer. Contact us for bank details.`,
          ``,
          `Thank you! — PurpleBox Moving`,
        ].filter(Boolean).join('\n');
        try { await sendWhatsAppText({ to: customer.phone, body: msg }); } catch {}
      }
    }

    res.json({ payUrl, token: invoice.shareToken, balanceDue: invoice.balanceDue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revise invoice and resend (supervisor adds extra work after job)
router.post('/:id/revise', async (req, res) => {
  try {
    const { items, supervisorNote } = req.body;
    const invoice = await MovingInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(400).json({ error: 'Cannot revise a fully paid invoice' });

    const total = (items || []).reduce((s, i) => s + (i.amount || 0), 0);
    const totalPaid = (invoice.depositPaid || 0) + (invoice.paymentHistory || []).reduce((s, p) => s + p.amount, 0);
    const balanceDue = Math.max(0, total - totalPaid);

    invoice.items = items;
    invoice.total = total;
    invoice.balanceDue = balanceDue;
    invoice.status = 'sent';
    if (supervisorNote) invoice.notes = [invoice.notes, `[Revision] ${supervisorNote}`].filter(Boolean).join('\n\n');
    await invoice.save();

    const customer = await Customer.findById(invoice.customer).select('fullName phone');
    if (customer?.phone) {
      const { sendWhatsAppText, whatsappSendConfigured } = await import('../services/whatsapp.js');
      if (whatsappSendConfigured()) {
        const msg = [
          `Hi ${customer.fullName},`,
          ``,
          `Your invoice *${invoice.invoiceNo}* has been revised.`,
          supervisorNote ? `Note: ${supervisorNote}` : ``,
          ``,
          `New total: *AED ${total.toLocaleString()}*`,
          `Balance due: *AED ${balanceDue.toLocaleString()}*`,
          ``,
          `Thank you! — PurpleBox Moving`,
        ].filter(l => l !== undefined).join('\n');
        try { await sendWhatsAppText({ to: customer.phone, body: msg }); } catch {}
      }
    }

    await invoice.populate(POPULATE_INV);
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
