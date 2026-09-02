import { Router } from 'express';
import crypto from 'crypto';
import { MovingQuote, MovingInvoice, MovingJob, nextMovingQuoteNo, nextMovingInvoiceNo } from '../models/index.js';
import { generateMovingQuotePdf } from '../services/movingQuotePdf.js';
import { chargesVat, movingTotals } from '../services/movingTotals.js';

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
    /* The server owns the money.
     *
     * Sub total, VAT and total were whatever the browser posted, so two
     * screens could disagree and the document followed whichever saved last.
     * They are recomputed from the items here, which is also what puts VAT on
     * a quote raised by anything that does not know to add it. */
    /* New quotes carry VAT; documents raised before it existed do not, and are
       never given it retrospectively. See the note on the schema field. */
    const body = { vatEnabled: true, vatRate: 5, ...req.body };
    const quote = await MovingQuote.create({ ...body, quoteNo, ...movingTotals(body) });
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
    /* Recomputed on every edit, from the items and discount as they will be
       stored — the merge below is what the document ends up being. */
    const existing = await MovingQuote.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    const merged = { ...existing, ...update };
    Object.assign(update, movingTotals(merged));
    // Pinned, so the answer cannot change later: a draft charges VAT, and it
    // must go on charging it once it is sent or accepted.
    update.vatEnabled = chargesVat(merged);
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
    /* Leaving draft settles the VAT question for good.
     *
     * A draft raised before VAT existed here is priced at today's rules, which
     * is decided by its status — so without this, sending it would flip the
     * answer back and the total would quietly drop the tax it was showing. */
    const existing = await MovingQuote.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    const patch = { status };
    if (existing.vatEnabled === undefined) {
      patch.vatEnabled = chargesVat(existing);
      Object.assign(patch, movingTotals({ ...existing, vatEnabled: patch.vatEnabled }));
    }
    const quote = await MovingQuote.findByIdAndUpdate(req.params.id, patch, { new: true });
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

// Convert accepted quote to invoice
router.post('/:id/convert-to-invoice', async (req, res) => {
  try {
    const quote = await MovingQuote.findById(req.params.id)
      .populate('customer', 'fullName phone email')
      .populate('job', 'jobNo');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const invoiceNo = await nextMovingInvoiceNo();
    /* The invoice is a new document, so it charges VAT — recomputed from the
       quote's own lines rather than copied, because a quote raised before VAT
       existed carries a total without it. */
    const t = movingTotals({ ...quote, vatEnabled: true });
    const depositPaid = quote.depositRequired ? Math.round(t.total * (quote.depositPct || 0) / 100 * 100) / 100 : 0;
    const invoice = await MovingInvoice.create({
      invoiceNo,
      job: quote.job?._id || undefined,
      customer: quote.customer._id,
      status: 'draft',
      invoiceDate: new Date(),
      items: quote.items,
      subTotal: t.subTotal,
      discount: t.discount,
      vatEnabled: true,
      vatRate: t.vatRate,
      vatAmount: t.vatAmount,
      total: t.total,
      depositPaid,
      balanceDue: Math.max(0, t.total - depositPaid),
      notes: `Generated from quote ${quote.quoteNo}`,
      termsAndConditions: quote.termsAndConditions || '',
    });

    // Link invoice to job if exists
    if (quote.job?._id) {
      await MovingJob.findByIdAndUpdate(quote.job._id, { invoice: invoice._id });
    }

    // Mark quote as accepted if not already
    if (quote.status !== 'accepted') {
      quote.status = 'accepted';
      await quote.save();
    }

    res.status(201).json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send quote via WhatsApp
router.post('/:id/send-whatsapp', async (req, res) => {
  try {
    const quote = await MovingQuote.findById(req.params.id)
      .populate('customer', 'fullName phone email');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const customer = quote.customer;
    if (!customer?.phone) return res.status(400).json({ error: 'Customer has no phone number' });

    if (!quote.shareToken) {
      quote.shareToken = crypto.randomUUID();
      await quote.save();
    }

    // PDF lives on the API host, not the frontend — API_PUBLIC_URL wins
    const apiBase = process.env.API_PUBLIC_URL || process.env.APP_URL || req.headers.origin || '';
    const pdfUrl = `${apiBase.replace(/\/$/, '')}/api/moving-quotes/${quote._id}/pdf?token=${quote.shareToken}`;

    const { sendWhatsAppText, whatsappSendConfigured } = await import('../services/whatsapp.js');
    if (!whatsappSendConfigured()) {
      return res.status(400).json({ error: 'WhatsApp is not configured' });
    }

    const msg = [
      `Hi ${customer.fullName},`,
      ``,
      `Please find your quotation *${quote.quoteNo}* from PurpleBox Moving.`,
      ``,
      `Total: *AED ${(quote.total || 0).toLocaleString()}*`,
      ``,
      `📄 View quote: ${pdfUrl}`,
      ``,
      `If you have any questions, feel free to reach out.`,
      ``,
      `Thank you! — PurpleBox Moving`,
    ].join('\n');

    await sendWhatsAppText({ to: customer.phone, body: msg });
    res.json({ ok: true, phone: customer.phone });
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
