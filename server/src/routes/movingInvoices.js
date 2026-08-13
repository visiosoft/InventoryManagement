import { Router } from 'express';
import crypto from 'crypto';
import { MovingInvoice, Customer, MovingJob, nextMovingInvoiceNo } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { generateMovingInvoicePdf } from '../services/movingInvoicePdf.js';
import { notifyInvoiceReady, notifyPaymentReceived } from '../services/movingNotifications.js';
import { zohoBooksConfigured, createZohoInvoice } from '../services/zohoBooks.js';
import { stripeConfigured, createInvoiceCheckoutSession } from '../services/stripe.js';
import { applyMovingInvoicePayment } from '../services/movingInvoicePayments.js';

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

// Short redirect to the current Stripe payment link — the raw Stripe
// checkout URL is 150+ characters (session id + signed fragment), which
// wraps into an ugly wall of text in WhatsApp. This gives a short,
// PurpleBox-branded link that 302s to whatever is currently stored, so it
// keeps working even if the session is regenerated later.
router.get('/pay/link/:id', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findById(req.params.id).select('stripePaymentLinkUrl');
    if (!invoice?.stripePaymentLinkUrl) return res.status(404).send('Payment link not found or expired');
    res.redirect(302, invoice.stripePaymentLinkUrl);
  } catch {
    res.status(404).send('Payment link not found');
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
    if (!body.dueDate) {
      const base = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
      base.setDate(base.getDate() + 1);
      body.dueDate = base;
    }
    const invoice = await MovingInvoice.create({ ...body, invoiceNo, balanceDue });
    res.status(201).json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Zoho Books sync (static routes before /:id) ──────────────────────────────

router.get('/zoho-books/status', (_req, res) => {
  res.json({ configured: zohoBooksConfigured() });
});

router.post('/zoho-books/bulk-sync', async (req, res) => {
  try {
    if (!zohoBooksConfigured()) {
      return res.status(400).json({ error: 'Zoho Books is not configured' });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide an array of invoice ids' });
    }

    const results = { synced: 0, failed: 0, errors: [] };
    for (const invoiceId of ids) {
      try {
        const invoice = await MovingInvoice.findById(invoiceId).populate('customer');
        if (!invoice) { results.failed++; continue; }
        const result = await createZohoInvoice(invoice);
        invoice.zohoBooksSyncId = result.zohoInvoiceId;
        invoice.zohoBooksSyncedAt = new Date();
        invoice.zohoBooksSyncError = null;
        await invoice.save();
        results.synced++;
      } catch (err) {
        results.failed++;
        results.errors.push({ id: invoiceId, error: err.response?.data?.message || err.message });
        try {
          await MovingInvoice.findByIdAndUpdate(invoiceId, {
            zohoBooksSyncError: err.response?.data?.message || err.message,
          });
        } catch { /* ignore */ }
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    const receivedBy = req.user.name || req.user.email || '';
    applyMovingInvoicePayment(invoice, { amount, method, date, notes, receivedBy });
    await invoice.save();

    const customer = await Customer.findById(invoice.customer).select('fullName phone');
    if (customer) notifyPaymentReceived(customer, invoice.invoiceNo, Number(amount));

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a payment entry
router.put('/:id/payments/:idx', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= invoice.paymentHistory.length) return res.status(404).json({ error: 'Payment entry not found' });
    const { amount, method, date, notes, receivedBy } = req.body;
    if (amount !== undefined) invoice.paymentHistory[idx].amount = Number(amount);
    if (method !== undefined) invoice.paymentHistory[idx].method = method;
    if (date !== undefined) invoice.paymentHistory[idx].date = new Date(date);
    if (notes !== undefined) invoice.paymentHistory[idx].notes = notes;
    if (receivedBy !== undefined) invoice.paymentHistory[idx].receivedBy = receivedBy;
    const totalPaid = invoice.depositPaid + invoice.paymentHistory.reduce((s, p) => s + p.amount, 0);
    invoice.balanceDue = Math.max(0, invoice.total - totalPaid);
    invoice.status = invoice.balanceDue <= 0 ? 'paid' : invoice.paymentHistory.length > 0 ? 'partial' : invoice.status;
    await invoice.save();
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a payment entry
router.delete('/:id/payments/:idx', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= invoice.paymentHistory.length) return res.status(404).json({ error: 'Payment entry not found' });
    invoice.paymentHistory.splice(idx, 1);
    const totalPaid = invoice.depositPaid + invoice.paymentHistory.reduce((s, p) => s + p.amount, 0);
    invoice.balanceDue = Math.max(0, invoice.total - totalPaid);
    invoice.status = invoice.balanceDue <= 0 ? 'paid' : invoice.paymentHistory.length > 0 ? 'partial' : 'sent';
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

    const customer = await Customer.findById(invoice.customer).select('fullName phone');
    const job = invoice.job ? await MovingJob.findById(invoice.job).select('jobNo') : null;
    if (customer && job) {
      // PDF lives on the API host, not the frontend — API_PUBLIC_URL wins
      const apiBase = process.env.API_PUBLIC_URL || process.env.APP_URL || req.headers.origin || '';
      const invoiceUrl = `${apiBase.replace(/\/$/, '')}/api/moving-invoices/${invoice._id}/pdf?token=${token}`;
      notifyInvoiceReady(job, customer, invoiceUrl);
    }

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a real Stripe Checkout payment link, and either send it via
// WhatsApp/email or just hand it back to copy. Body: { channel: 'whatsapp' |
// 'email' | 'link' } — required, picked from the button clicked.
router.post('/:id/payment-link', async (req, res) => {
  try {
    if (!stripeConfigured()) {
      return res.status(400).json({ error: 'Stripe is not connected — add a secret key in Settings → Payments' });
    }
    const channel = req.body?.channel;
    if (!['whatsapp', 'email', 'link'].includes(channel)) {
      return res.status(400).json({ error: 'Pick a channel: whatsapp, email or link' });
    }
    const feePct = Math.min(15, Math.max(0, Number(req.body?.feePct) || 0));
    const invoice = await MovingInvoice.findById(req.params.id).populate(POPULATE_INV);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.balanceDue <= 0) return res.status(400).json({ error: 'Invoice already fully paid' });

    const customer = invoice.customer;
    if (channel === 'whatsapp' && !customer?.phone) {
      return res.status(400).json({ error: 'This customer has no phone number on file' });
    }
    if (channel === 'email' && !customer?.email) {
      return res.status(400).json({ error: 'This customer has no email on file' });
    }

    const clientOrigin = process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae';
    const session = await createInvoiceCheckoutSession({
      invoice,
      customerEmail: customer?.email,
      successUrl: `${clientOrigin}/pay/success?invoice=${invoice.invoiceNo}`,
      cancelUrl: `${clientOrigin}/moving/invoices/${invoice._id}`,
      feePct,
    });

    invoice.stripeCheckoutSessionId = session.id;
    invoice.stripePaymentLinkUrl = session.url;
    await invoice.save();

    // The raw Stripe checkout URL is 150+ characters and wraps badly in
    // WhatsApp/plain text — send our own short redirect instead everywhere.
    const apiBase = (process.env.API_PUBLIC_URL || process.env.APP_URL || req.headers.origin || 'https://api.purplebox.ae').replace(/\/$/, '');
    const payUrl = `${apiBase}/api/moving-invoices/pay/link/${invoice._id}`;
    const totalCharged = invoice.balanceDue + session.feeAmount;
    const feeLine = feePct > 0 ? `Card processing fee (${feePct}%): AED ${session.feeAmount.toLocaleString()}\nTotal to pay: AED ${totalCharged.toLocaleString()}` : '';

    if (channel === 'whatsapp') {
      const { sendWhatsAppText, whatsappSendConfigured } = await import('../services/whatsapp.js');
      if (!whatsappSendConfigured()) return res.status(400).json({ error: 'WhatsApp is not connected' });
      const msg = [
        `Hi ${customer.fullName},`,
        ``,
        `Your invoice *${invoice.invoiceNo}* is ready.`,
        `Balance due: *AED ${invoice.balanceDue.toLocaleString()}*`,
        feePct > 0 ? `Card processing fee (${feePct}%): *AED ${session.feeAmount.toLocaleString()}*` : '',
        feePct > 0 ? `Total to pay: *AED ${totalCharged.toLocaleString()}*` : '',
        ``,
        `💳 Pay online: ${payUrl}`,
        ``,
        `Thank you! — PurpleBox Moving`,
      ].filter(Boolean).join('\n');
      await sendWhatsAppText({ to: customer.phone, body: msg });
    } else if (channel === 'email') {
      const { sendMail, mailConfigured } = await import('../services/mail.js');
      if (!mailConfigured()) return res.status(400).json({ error: 'Email is not connected — connect Gmail in Settings' });
      const text = [
        `Hi ${customer.fullName},`,
        ``,
        `Your invoice ${invoice.invoiceNo} is ready.`,
        `Balance due: AED ${invoice.balanceDue.toLocaleString()}`,
        feeLine,
        ``,
        `Pay online: ${payUrl}`,
        ``,
        `Thank you! — PurpleBox Moving`,
      ].filter(Boolean).join('\n');
      const html = [
        `<p>Hi ${customer.fullName},</p>`,
        `<p>Your invoice <strong>${invoice.invoiceNo}</strong> is ready.<br/>`,
        `Balance due: <strong>AED ${invoice.balanceDue.toLocaleString()}</strong>`,
        feePct > 0 ? `<br/>Card processing fee (${feePct}%): <strong>AED ${session.feeAmount.toLocaleString()}</strong><br/>Total to pay: <strong>AED ${totalCharged.toLocaleString()}</strong>` : '',
        `</p>`,
        `<p><a href="${payUrl}" style="display:inline-block;background:#5B2BC9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">Pay Online →</a></p>`,
        `<p>Thank you!<br/>PurpleBox Moving</p>`,
      ].filter(Boolean).join('\n');
      const invoicePdf = await generateMovingInvoicePdf(invoice);
      await sendMail({
        to: customer.email,
        subject: `Payment due — Invoice ${invoice.invoiceNo} — PurpleBox Moving`,
        text,
        html,
        attachments: [{ filename: `${invoice.invoiceNo}.pdf`, content: invoicePdf, contentType: 'application/pdf' }],
      });
    }
    // channel === 'link': nothing to send, just hand the URL back to copy

    res.json({ payUrl, balanceDue: invoice.balanceDue, channel, feePct, feeAmount: session.feeAmount, totalCharged });
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
    // Allow revising even paid invoices

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
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const inv = await MovingInvoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    await inv.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/sync-zoho-books', async (req, res) => {
  try {
    if (!zohoBooksConfigured()) {
      return res.status(400).json({ error: 'Zoho Books is not configured. Add credentials in server .env file.' });
    }
    const invoice = await MovingInvoice.findById(req.params.id).populate('customer');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.customer) return res.status(400).json({ error: 'Invoice has no customer linked.' });
    if (!invoice.customer.fullName) return res.status(400).json({ error: 'Customer has no name.' });
    if (!invoice.items?.length) return res.status(400).json({ error: 'Invoice has no line items.' });

    const result = await createZohoInvoice(invoice);
    invoice.zohoBooksSyncId = result.zohoInvoiceId;
    invoice.zohoBooksSyncedAt = new Date();
    invoice.zohoBooksSyncError = null;
    await invoice.save();

    res.json({ ok: true, zohoInvoiceId: result.zohoInvoiceId });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Zoho Books sync failed';
    try {
      await MovingInvoice.findByIdAndUpdate(req.params.id, { zohoBooksSyncError: msg });
    } catch { /* ignore */ }
    res.status(502).json({ error: msg });
  }
});

export default router;
