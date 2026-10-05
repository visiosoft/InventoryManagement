import { Router } from 'express';
import crypto from 'crypto';
import { Contract, Customer, Invoice, Lead, Payment, Quote, Unit, nextQuoteNo, nextContractNo, nextInvoiceNo } from '../models/index.js';
import { creditFor, markLeadWon, leadForCustomer } from '../services/dealCredit.js';
import { promoteToCustomer } from '../services/customerStage.js';
import { availableUnitsResponse } from '../services/unitAvailability.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { companyForQuote } from '../services/companyIdentity.js';
import { isRefundableRow, vatBase, vatOn } from '../services/quoteVat.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { archivePdf } from '../utils/archivePdf.js';
import { stripeConfigured, createCheckoutSession } from '../services/stripe.js';
import { softDelete } from '../utils/softDelete.js';
import { toNumber, normalizeBody, createFirstInvoiceFromQuote } from '../services/quotePricing.js';
import { convertQuoteToContract } from '../services/quoteConversion.js';

const router = Router();

// Archive a rendered quotation PDF into the Documents section (fire-and-forget)
function archiveQuotePdf(quote, pdf) {
    archivePdf({
        buffer: pdf,
        name: `${quote.quoteNo}.pdf`,
        customerId: quote.customer?._id ?? quote.customer,
        customerName: quote.customer?.fullName,
        sourceUpdatedAt: quote.updatedAt,
    }).catch(() => { });
}


function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// Public quote PDF — reachable without auth via share token
router.get('/public/:token/pdf', async (req, res) => {
    const quote = await Quote.findOne({ shareToken: req.params.token })
        .populate('customer', 'fullName email phone address');
    if (!quote) return res.status(404).json({ error: 'Quote not found or link expired' });
    const pdf = await renderQuotePdf({ quote, co: await companyForQuote(quote) });
    archiveQuotePdf(quote, pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.quoteNo}.pdf"`);
    res.send(pdf);
});

// Generate (or return existing) share link and mark the quote as sent.
// Body: { channel: 'whatsapp' | 'email' } — recorded on the timeline.
router.post('/:id/share', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    if (!quote.shareToken) quote.shareToken = crypto.randomUUID();

    const channel = ['whatsapp', 'email'].includes(String(req.body?.channel)) ? String(req.body.channel) : '';
    const userName = req.user.name || req.user.email || 'user';
    if (quote.status === 'draft') quote.status = 'sent';
    quote.timeline.push({
        type: 'sent',
        text: channel ? `Quote sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'email'} by ${userName}` : `Share link created by ${userName}`,
        user: req.user.id,
    });
    await quote.save();
    await resyncQuoteUnits(quote.units.map((u) => u.unit));

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${proto}://${host}/api/quotes/public/${quote.shareToken}/pdf`;
    res.json({ token: quote.shareToken, url });
});

// Email the quote PDF to the customer via SMTP (Gmail/Workspace).
router.post('/:id/send-email', async (req, res) => {
    if (!mailConfigured()) {
        return res.status(501).json({ error: 'SMTP is not configured', configured: false });
    }
    const quote = await Quote.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const to = String(req.body?.to || quote.customer?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Customer has no email address' });

    const pdf = await renderQuotePdf({ quote, co: await companyForQuote(quote) });
    archiveQuotePdf(quote, pdf);
    const userName = req.user.name || req.user.email || 'user';
    const subjectLine = req.body?.subject || `Storage Quotation ${quote.quoteNo} — PurpleBox`;
    const bodyText = req.body?.body ||
        `Hello ${quote.customer?.fullName || ''},\n\n` +
        `Please find attached your storage quotation ${quote.quoteNo} — ${quote.total.toFixed(2)} AED.\n\n` +
        `Thank you,\nPurpleBox`;
    const bodyHtml = bodyText.replace(/\n/g, '<br/>');
    try {
        await sendMail({
            to,
            subject: subjectLine,
            text: bodyText,
            html: bodyHtml,
            attachments: [{ filename: `${quote.quoteNo}.pdf`, content: pdf, contentType: 'application/pdf' }],
        });
    } catch (err) {
        return res.status(502).json({ error: `Email send failed: ${err.message}` });
    }

    if (quote.status === 'draft') quote.status = 'sent';
    quote.timeline.push({ type: 'sent', text: `Quote emailed to ${to} by ${userName}`, user: req.user.id });
    await quote.save();
    await resyncQuoteUnits(quote.units.map((u) => u.unit));
    res.json({ sent: true, to });
});

// Short redirect to the current Stripe payment link for this quote — same
// pattern as the moving-invoices and storage-invoices versions. Public: a
// customer clicks this from an email or a WhatsApp message, not logged in.
router.get('/pay/link/:id', async (req, res) => {
    try {
        const quote = await Quote.findById(req.params.id).select('stripePaymentLinkUrl');
        if (!quote?.stripePaymentLinkUrl) return res.status(404).send('Payment link not found or expired');
        res.redirect(302, quote.stripePaymentLinkUrl);
    } catch {
        res.status(404).send('Payment link not found');
    }
});

// Create a Stripe Checkout session for this quotation's total — a "pay
// online to confirm" link, priced exactly as the quote itself. Paying it
// marks the quote accepted; it does not convert it to a contract on its own,
// the same way accepting a quote never has — that step still asks for
// authorized persons and payment method, which a webhook cannot supply.
router.post('/:id/payment-link', async (req, res) => {
    try {
        if (!stripeConfigured()) {
            return res.status(400).json({ error: 'Stripe is not connected — add a secret key in Settings → Payments' });
        }
        const channel = req.body?.channel;
        if (!['whatsapp', 'email', 'link'].includes(channel)) {
            return res.status(400).json({ error: 'Pick a channel: whatsapp, email or link' });
        }
        const quote = await Quote.findById(req.params.id).populate('customer', 'fullName email phone address');
        if (!quote) return res.status(404).json({ error: 'Quote not found' });
        if (['rejected', 'expired'].includes(quote.status)) {
            return res.status(409).json({ error: `Cannot pay a ${quote.status} quote` });
        }
        if (quote.contract) return res.status(409).json({ error: 'This quote has already become a contract' });
        if (!(quote.total > 0)) return res.status(400).json({ error: 'This quote has nothing to charge' });

        const customer = quote.customer;
        if (channel === 'whatsapp' && !customer?.phone) {
            return res.status(400).json({ error: 'This customer has no phone number on file' });
        }
        if (channel === 'email' && !customer?.email) {
            return res.status(400).json({ error: 'This customer has no email on file' });
        }

        const feePct = quote.cardFeeEnabled ? quote.cardFeePct : 0;
        const clientOrigin = process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae';
        const session = await createCheckoutSession({
            amountAed: quote.total,
            productName: `Quotation ${quote.quoteNo}`,
            description: 'Storage quotation — PurpleBox',
            metadata: { storageQuoteId: String(quote._id), quoteNo: quote.quoteNo },
            customerEmail: customer?.email,
            successUrl: `${clientOrigin}/pay/success?quote=${quote.quoteNo}`,
            cancelUrl: `${clientOrigin}/quotes/new?quote=${quote._id}`,
            feePct,
        });

        quote.stripeCheckoutSessionId = session.id;
        quote.stripePaymentLinkUrl = session.url;
        await quote.save();

        const apiBase = (process.env.API_PUBLIC_URL || process.env.APP_URL || req.headers.origin || 'https://api.purplebox.ae').replace(/\/$/, '');
        const payUrl = `${apiBase}/api/quotes/pay/link/${quote._id}`;
        const totalCharged = quote.total + session.feeAmount;

        // Same convention as storage invoices: WhatsApp here is a client-side
        // wa.me deep link the page opens itself, not a server-initiated send.
        if (channel === 'email') {
            if (!mailConfigured()) return res.status(400).json({ error: 'Email is not connected — connect Gmail in Settings' });
            const feeLine = session.feeAmount > 0
                ? `<br/>Card processing fee (${feePct}%): <strong>AED ${session.feeAmount.toLocaleString()}</strong><br/>Total to pay: <strong>AED ${totalCharged.toLocaleString()}</strong>`
                : '';
            const html = [
                `<p>Hi ${customer.fullName},</p>`,
                `<p>Your storage quotation <strong>${quote.quoteNo}</strong> — <strong>AED ${quote.total.toLocaleString()}</strong>.${feeLine}</p>`,
                `<p><a href="${payUrl}" style="display:inline-block;background:#5B2BC9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">Pay Online →</a></p>`,
                `<p>Thank you!<br/>PurpleBox</p>`,
            ].join('\n');
            const text = `Hi ${customer.fullName},\n\nYour storage quotation ${quote.quoteNo} — AED ${quote.total.toLocaleString()}.${session.feeAmount > 0 ? `\nCard processing fee (${feePct}%): AED ${session.feeAmount.toLocaleString()}\nTotal to pay: AED ${totalCharged.toLocaleString()}` : ''}\n\nPay online: ${payUrl}\n\nThank you! — PurpleBox`;
            const pdf = await renderQuotePdf({ quote, co: await companyForQuote(quote) }).catch(() => null);
            await sendMail({
                to: customer.email,
                subject: `Payment link — Quotation ${quote.quoteNo} — PurpleBox`,
                text, html,
                attachments: pdf ? [{ filename: `${quote.quoteNo}.pdf`, content: pdf, contentType: 'application/pdf' }] : [],
            });
        }

        if (quote.status === 'draft') {
            quote.status = 'sent';
            quote.timeline.push({ type: 'sent', text: `Payment link created (${channel})`, user: req.user.id });
            await quote.save();
        }

        res.json({ payUrl, total: quote.total, channel, feePct, feeAmount: session.feeAmount, totalCharged });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/available-units', async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const includeAll = req.query.all === 'true';
    res.json(await availableUnitsResponse({ from, to, includeAll }));
});

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.customer) filter.customer = String(req.query.customer);
    if (req.query.lead) filter.lead = String(req.query.lead);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ quoteNo: re }, { subject: re }, { salesperson: re }];
    }
    const quotes = await Quote.find(filter)
        .populate('customer', 'fullName email phone')
        .populate('lead', 'fullName phone')
        .populate('contract', 'contractNo status approvalStatus')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 })
        .lean();
    res.json(quotes);
});

router.get('/:id', async (req, res) => {
    const quote = await Quote.findById(req.params.id)
        .populate('customer', 'fullName email phone address')
        .populate('lead', 'fullName phone email')
        .populate('units.unit', 'unitNumber sizeSqf floor price status')
        .populate('contract', 'contractNo status');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
});

router.post('/', async (req, res) => {
    const body = normalizeBody(req.body || {}, { holdAdvance: req.body?.holdAdvance !== false });
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.expiryDate) return res.status(400).json({ error: 'Expiry date is required' });
    if (!body.units.length && !body.items.length) return res.status(400).json({ error: 'At least one unit or item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    if (body.lead) {
        const lead = await Lead.findById(body.lead).select('_id');
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
    }

    /* Which enquiry this came from, recorded now rather than guessed later.
     *
     * Quotes have always had somewhere to put this and the pages almost never
     * filled it in: 1 of 57 quotes on production named a lead. Every deal
     * closed from one of the other 56 then had to be attributed by matching
     * phone numbers after the fact, which is right often enough to be
     * misleading. The number is known here, so the link is made here. */
    if (!body.lead) {
        const full = await Customer.findById(body.customer).select('phone phones').lean();
        const found = await leadForCustomer(full).catch(() => null);
        if (found) body.lead = found._id;
    }

    const userName = req.user.name || req.user.email || 'user';
    const quote = await Quote.create({
        ...body,
        quoteNo: await nextQuoteNo(),
        assignedTo: req.user.id,
        timeline: [{ type: 'created', text: `Quote created by ${userName}`, user: req.user.id }],
    });
    // A quote created as sent holds its units from that moment.
    await resyncQuoteUnits(quote.units.map((u) => u.unit));
    res.status(201).json(await quote.populate('customer', 'fullName email phone'));
});

router.put('/:id', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const holdAdvance = req.body?.holdAdvance !== undefined
        ? req.body.holdAdvance !== false
        : quote.holdAdvance !== false;
    const body = normalizeBody(req.body || {}, { holdAdvance });
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.expiryDate) return res.status(400).json({ error: 'Expiry date is required' });
    if (!body.units.length && !body.items.length) return res.status(400).json({ error: 'At least one unit or item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const userName = req.user.name || req.user.email || 'user';
    quote.timeline.push({ type: 'updated', text: `Quote updated by ${userName}`, user: req.user.id });

    // What it held before the edit, so a unit taken off the quote is released
    // rather than left reserved by a quote that no longer mentions it.
    const heldBefore = quote.units.map((u) => u.unit);

    // Keep the current status unless the caller explicitly changes it
    Object.assign(quote, body, req.body.status ? {} : { status: quote.status });
    await quote.save();

    await resyncQuoteUnits(heldBefore, quote.units.map((u) => u.unit));

    // Keep a not-yet-booked contract + its unpaid invoice in sync with the edit
    await syncContractFromQuote(quote, userName);

    res.json(await quote.populate('customer', 'fullName email phone'));
});

/* A quote's units, whichever of them it had before and after a change.
 *
 * Both sides matter: taking a unit off a quote has to release it just as
 * surely as putting one on has to hold it. */
async function resyncQuoteUnits(...lists) {
    const ids = [...new Set(lists.flat().filter(Boolean).map(String))];
    await Promise.all(ids.map((uid) => syncUnitStatus(uid)));
}

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(status)) {
        return res.status(400).json({ error: 'Invalid quote status' });
    }
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const userName = req.user.name || req.user.email || 'user';
    quote.status = status;
    quote.timeline.push({ type: 'status_changed', text: `Status changed to ${status} by ${userName}`, user: req.user.id });
    await quote.save();

    /* Sending it holds the units; rejecting or expiring it lets them go. Both
       directions run through the same recompute, which reads the world rather
       than trying to work out what this particular change implies. */
    await resyncQuoteUnits(quote.units.map((u) => u.unit));

    res.json(await quote.populate('customer', 'fullName email phone'));
});

router.patch('/:id/flow-step', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const step = Number(req.body?.step);
    if (!Number.isFinite(step) || step < 0 || step > 5) {
        return res.status(400).json({ error: 'Invalid step' });
    }
    quote.flowStep = step;
    if (Array.isArray(req.body?.stepsDone)) {
        quote.flowStepsDone = req.body.stepsDone.map(Boolean);
    }
    await quote.save();
    /* Reaching the quotation step is what holds the unit, so the stored
       status has to follow now rather than at the next hourly sweep — the
       availability check was already right, but the badge on the unit read
       "available" for up to an hour after somebody had been quoted it. */
    await resyncQuoteUnits(quote.units.map((u) => u.unit));
    res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    await softDelete(quote, req.user.id);
    // The hold went with the quote; the unit's badge should not wait an hour
    // for the sweep to notice.
    await resyncQuoteUnits(quote.units.map((u) => u.unit));
    res.json({ ok: true });
});


// Keep a not-yet-booked contract (and its unpaid first invoice) in sync when the
// quote is edited. Booked (active) contracts are never touched.
async function syncContractFromQuote(quote, userName) {
    if (!quote.contract || !quote.units?.length) return null;
    const contract = await Contract.findById(quote.contract);
    if (!contract || ['active', 'ended', 'cancelled'].includes(contract.status)) return null;

    const unitIds = quote.units.map((u) => u.unit);
    const discounts = [...new Set(quote.units.map((u) => toNumber(u.discountPct)))];
    contract.unit = unitIds[0];
    contract.units = unitIds.length > 1 ? unitIds : [];
    contract.startDate = new Date(Math.min(...quote.units.map((u) => new Date(u.startDate).getTime())));
    contract.endDate = new Date(Math.max(...quote.units.map((u) => new Date(u.endDate).getTime())));
    contract.rate = Number(quote.units.reduce((s, u) => s + toNumber(u.rate), 0).toFixed(2));
    contract.deposit = toNumber(quote.deposit);
    contract.firstMonthDiscountPct = discounts.length === 1 ? discounts[0] : 0;
    // Mirror the quote total so the contract's Total Quotation can't go stale
    contract.totalQuotation = Number(quote.total || 0);
    contract.timeline.push({ at: new Date(), text: `Contract updated from quote ${quote.quoteNo} by ${userName}`, author: userName });
    await contract.save();

    // Regenerate unpaid invoices so they match the updated quote. Paid or
    // partially-paid invoices are preserved.
    const invoices = await Invoice.find({ orderNumber: contract.contractNo });
    let removed = 0;
    for (const inv of invoices) {
        if (Number(inv.paymentMade || 0) === 0 && ['draft', 'sent'].includes(inv.status)) {
            await Payment.deleteMany({ invoice: inv._id });
            await Invoice.deleteOne({ _id: inv._id });
            removed++;
        }
    }
    if (removed === invoices.length) {
        const invoice = await createFirstInvoiceFromQuote(quote, contract, userName);
        contract.timeline.push({ at: new Date(), text: `Draft invoice ${invoice.invoiceNo} regenerated from updated quote`, author: userName });
        await contract.save();
    }

    await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));
    return contract;
}

// Force the contract's unpaid invoices to be rebuilt from the current quote, so
// the invoice always matches what the customer accepted. Refuses when any
// invoice already has a payment against it.
router.post('/:id/rebuild-invoice', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!quote.contract) return res.status(400).json({ error: 'This quote has no contract yet' });
    const contract = await Contract.findById(quote.contract);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const invoices = await Invoice.find({ orderNumber: contract.contractNo });
    const paidOnes = invoices.filter((i) => Number(i.paymentMade || 0) > 0 || i.status === 'paid');
    if (paidOnes.length) {
        return res.status(409).json({
            error: `Cannot rebuild — ${paidOnes.map((i) => i.invoiceNo).join(', ')} already has a recorded payment.`,
        });
    }

    const userName = req.user.name || req.user.email || 'user';
    for (const inv of invoices) {
        await Payment.deleteMany({ invoice: inv._id });
        await Invoice.deleteOne({ _id: inv._id });
    }
    const invoice = await createFirstInvoiceFromQuote(quote, contract, userName);
    contract.timeline.push({
        at: new Date(),
        text: `Invoice ${invoice.invoiceNo} rebuilt from quote ${quote.quoteNo} by ${userName}`,
        author: userName,
    });
    await contract.save();
    res.json(invoice);
});

// Mirrors syncUnitStatus in contracts.js for units touched by a conversion.

// Convert an accepted quote into a draft contract, auto-populating all terms.
router.post('/:id/convert-to-contract', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    try {
        const { contract, invoice } = await convertQuoteToContract(quote, {
            actor: { name: req.user.name || req.user.email || 'user', userId: req.user.id },
            authorizedPersons: Array.isArray(req.body?.authorizedPersons) ? req.body.authorizedPersons : [],
            paymentMethod: req.body?.paymentMethod,
        });
        res.status(201).json({ contractId: contract._id, contractNo: contract.contractNo, invoiceId: invoice._id, invoiceNo: invoice.invoiceNo });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, ...(err.contractId ? { contractId: err.contractId } : {}) });
    }
});

router.get('/:id/pdf', async (req, res) => {
    const quote = await Quote.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf({ quote, co: await companyForQuote(quote) });
    archiveQuotePdf(quote, pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.quoteNo}.pdf"`);
    res.send(pdf);
});

export default router;
