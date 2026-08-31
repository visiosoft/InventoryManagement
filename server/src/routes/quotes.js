import { Router } from 'express';
import crypto from 'crypto';
import { Contract, Customer, Invoice, Lead, Payment, Quote, Unit, nextQuoteNo, nextContractNo, nextInvoiceNo } from '../models/index.js';
import { availableUnitsResponse } from '../services/unitAvailability.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { companyForQuote } from '../services/companyIdentity.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { archivePdf } from '../utils/archivePdf.js';

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

function toNumber(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapItem(item, idx) {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.rate);
    const discountPct = toNumber(item.discountPct);
    const gross = quantity * rate;
    const amount = Number((gross - (gross * discountPct) / 100).toFixed(2));
    return {
        sortOrder: toNumber(item.sortOrder, idx),
        itemDetails: String(item.itemDetails || '').trim(),
        quantity,
        rate,
        discountPct,
        amount,
    };
}

function calcUnitPeriodTotal(rate, discountPct, startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const days = Math.round((endDate - startDate) / 86400000);
    if (days <= 0) return 0;
    const totalWeeks = Math.ceil(days / 7);
    const weeklyFull = rate / 4;
    const weeklyDisc = weeklyFull - (weeklyFull * discountPct) / 100;
    const discWeeks = Math.min(4, totalWeeks);
    const fullWeeks = Math.max(0, totalWeeks - 4);
    return Math.round((discWeeks * weeklyDisc + fullWeeks * weeklyFull) * 100) / 100;
}

function calcUnitAdvance(rate, startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const days = Math.round((endDate - startDate) / 86400000);
    if (days <= 0) return 0;
    const weeks = Math.ceil(days / 7);
    const advWeeks = weeks % 4 === 0 ? 4 : weeks % 4;
    return Math.round((rate / 4) * advWeeks * 100) / 100;
}

function isShortTerm(startDate, endDate) {
    if (!startDate || !endDate) return false;
    const days = Math.round((endDate - startDate) / 86400000);
    return days > 0 && Math.ceil(days / 7) <= 4;
}

function mapUnit(u) {
    const rate = toNumber(u.rate);
    const discountPct = toNumber(u.discountPct);
    const startDate = u.startDate ? new Date(u.startDate) : null;
    const endDate = u.endDate ? new Date(u.endDate) : null;
    const amount = calcUnitPeriodTotal(rate, discountPct, startDate, endDate);
    return {
        unit: String(u.unit || ''),
        unitNumber: String(u.unitNumber || ''),
        sizeSqf: toNumber(u.sizeSqf),
        floor: String(u.floor || ''),
        startDate,
        endDate,
        rate,
        discountPct,
        amount,
    };
}

function mapAddOn(a) {
    const quantity = toNumber(a.quantity, 1);
    const rate = toNumber(a.rate);
    return {
        name: String(a.name || '').trim(),
        description: String(a.description || '').trim(),
        quantity,
        rate,
        amount: Number((quantity * rate).toFixed(2)),
    };
}

function normalizeBody(body, { holdAdvance = true } = {}) {
    const items = (Array.isArray(body.items) ? body.items : [])
        .map((it, idx) => mapItem(it, idx))
        .filter((it) => it.itemDetails && it.quantity >= 0 && it.rate >= 0);

    const units = (Array.isArray(body.units) ? body.units : [])
        .map(mapUnit)
        .filter((u) => u.unit && u.startDate && u.endDate);

    const addOns = (Array.isArray(body.addOns) ? body.addOns : [])
        .map(mapAddOn)
        .filter((a) => a.name);

    const unitsTotal = units.reduce((s, u) => s + u.amount, 0);
    const addOnsTotal = addOns.reduce((s, a) => s + a.amount, 0);
    const itemsTotal = items.reduce((s, it) => s + it.amount, 0);
    const subTotal = Number((unitsTotal + addOnsTotal + itemsTotal).toFixed(2));
    const adjustment = toNumber(body.adjustment, 0);
    const deposit = toNumber(body.deposit, 0);

    // The server owns the total — client-sent totals are ignored so every edit
    // path yields the same figure. Rule: rent + add-ons/items + the refundable
    // advance for short terms + security deposit. For terms over 4 weeks the
    // advance prepays the final period already counted inside unitsTotal, so it
    // adds nothing; for terms of 4 weeks or less it is held on top of the rent.
    const advanceExtra = !holdAdvance ? 0 : units.reduce((sum, u) => {
        const days = Math.round((u.endDate - u.startDate) / 86400000);
        const tw = Math.max(1, Math.ceil(days / 7));
        if (tw > 4) return sum;
        return sum + (u.rate / 4) * tw;
    }, 0);
    /* VAT on the supply only.
     *
     * The security deposit and the refundable advance are money held and
     * handed back, not something sold, so they sit outside the tax base —
     * charging on them would bill the customer 5% of a sum they are owed.
     * Absent from an older quote's body means on, which is the standing rule. */
    const vatEnabled = body.vatEnabled === undefined ? true : Boolean(body.vatEnabled);
    const vatRate = vatEnabled ? 5 : 0;
    const vatAmount = Number((Math.max(0, subTotal + adjustment) * (vatRate / 100)).toFixed(2));

    const total = Number((subTotal + adjustment + vatAmount + advanceExtra + deposit).toFixed(2));

    return {
        quoteDate: body.quoteDate ? new Date(body.quoteDate) : new Date(),
        creationDate: body.creationDate ? new Date(body.creationDate) : new Date(),
        salesperson: String(body.salesperson || ''),
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        pdfTemplate: String(body.pdfTemplate || 'Standard Template'),
        customer: String(body.customer || ''),
        lead: body.lead ? String(body.lead) : undefined,
        billingPeriod: ['weekly', 'monthly'].includes(body.billingPeriod) ? body.billingPeriod : 'monthly',
        billingAddress: String(body.billingAddress || ''),
        shippingAddress: String(body.shippingAddress || ''),
        subject: String(body.subject || ''),
        items,
        units,
        addOns,
        deposit,
        holdAdvance,
        subTotal,
        adjustment,
        vatEnabled,
        vatRate,
        vatAmount,
        total,
        notes: String(body.notes || ''),
        /* Undefined leaves the schema default in place on a new quote and the
           stored copy in place on an existing one — only an explicit value
           changes them, so a save that does not mention terms never quietly
           blanks the ones a customer was sent. */
        ...(body.termsAndConditions !== undefined
            ? { termsAndConditions: String(body.termsAndConditions || '') }
            : {}),
        status: String(body.status || 'draft'),
    };
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
    res.json({ sent: true, to });
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

    const userName = req.user.name || req.user.email || 'user';
    const quote = await Quote.create({
        ...body,
        quoteNo: await nextQuoteNo(),
        assignedTo: req.user.id,
        timeline: [{ type: 'created', text: `Quote created by ${userName}`, user: req.user.id }],
    });
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

    // Keep the current status unless the caller explicitly changes it
    Object.assign(quote, body, req.body.status ? {} : { status: quote.status });
    await quote.save();

    // Keep a not-yet-booked contract + its unpaid invoice in sync with the edit
    await syncContractFromQuote(quote, userName);

    res.json(await quote.populate('customer', 'fullName email phone'));
});

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
    res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
    const quote = await Quote.findByIdAndDelete(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ ok: true });
});

// First invoice for a quote-sourced contract, created as DRAFT with prices locked
// from the quote: first 4-week period per unit + one-time add-ons + deposit.
async function createFirstInvoiceFromQuote(quote, contract, userName) {
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const items = [];
    let advanceTotal = 0;

    for (const u of quote.units) {
        const rate = toNumber(u.rate);
        const discountPct = toNumber(u.discountPct);
        const discounted = Number((rate - (rate * discountPct) / 100).toFixed(2));

        // Compute actual period weeks
        const periodStart = new Date(u.startDate);
        const periodEnd = new Date(u.endDate);
        const days = Math.round((periodEnd - periodStart) / 86400000);
        const weeklyRate = Number((discounted / 4).toFixed(2));
        const fullMonths = Math.floor(days / 28);
        const rem = days % 28;
        const extraWeeks = rem > 0 ? Math.ceil(rem / 7) : 0;
        const totalWeeks = fullMonths * 4 + extraWeeks;
        const tw = totalWeeks || 1;

        // First invoice bills only the FIRST period (up to 4 weeks). Later
        // months are invoiced per period ("Add next period"), and the advance
        // deposit covers the final period.
        const firstWeeks = Math.min(4, tw);
        const rentAmount = Number((weeklyRate * firstWeeks).toFixed(2));
        const firstPeriodEnd = new Date(periodStart);
        firstPeriodEnd.setDate(firstPeriodEnd.getDate() + firstWeeks * 7);
        const displayEnd = new Date(Math.min(firstPeriodEnd.getTime(), periodEnd.getTime()));
        displayEnd.setDate(displayEnd.getDate() - 1);
        const wkRate = Number((rate / 4).toFixed(2));
        items.push({
            sortOrder: items.length,
            itemDetails: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · Unit ${u.unitNumber}`,
            quantity: firstWeeks,
            rate: wkRate,
            discountPct,
            amount: rentAmount,
        });

        // Skipped entirely when the quote opts out of holding the advance
        if (quote.holdAdvance === false) continue;

        // Advance covers the FINAL rental period, so its length is whatever the
        // term leaves over after the whole 4-week periods (a 6-week term runs
        // 4 + 2, so the advance is 2 weeks — not 4). For terms of 4 weeks or
        // Advance/security deposit = always 4 weeks, adjusted in the last 4 weeks
        const advWeeks = Math.min(4, tw);
        const advAmount = Number((wkRate * advWeeks).toFixed(2));
        const isShortTerm = tw <= 4;
        advanceTotal += advAmount;

        // Label the advance with the period it prepays (the last one)
        const advStart = new Date(periodEnd);
        advStart.setDate(advStart.getDate() - advWeeks * 7);
        const advEnd = new Date(periodEnd);
        advEnd.setDate(advEnd.getDate() - 1);
        items.push({
            sortOrder: items.length,
            itemDetails: isShortTerm
                ? `Refundable Advance · Unit ${u.unitNumber}`
                : `Advance Rent ${fmt(advStart)} – ${fmt(advEnd)} · Unit ${u.unitNumber}`,
            description: isShortTerm
                ? 'Held and refunded or adjusted at the end of the rental'
                : 'Prepays the final rental period — no invoice is raised for it',
            quantity: advWeeks,
            rate: wkRate,
            discountPct: 0,
            amount: advAmount,
        });
    }

    for (const a of quote.addOns || []) {
        items.push({
            sortOrder: items.length,
            itemDetails: a.description ? `${a.name} — ${a.description}` : a.name,
            quantity: toNumber(a.quantity, 1),
            rate: toNumber(a.rate),
            discountPct: 0,
            amount: toNumber(a.amount),
        });
    }

    const depositAmt = toNumber(quote.deposit);
    if (depositAmt > 0) {
        items.push({
            sortOrder: items.length,
            itemDetails: `Security Deposit · Unit ${quote.units[0].unitNumber}`,
            quantity: 1,
            rate: depositAmt,
            discountPct: 0,
            amount: depositAmt,
        });
    }

    const invoiceTotal = Number(items.reduce((s, it) => s + it.amount, 0).toFixed(2));
    const dueDate = new Date(Math.min(...quote.units.map((u) => new Date(u.startDate).getTime())));

    const unitNo = quote.units[0]?.unitNumber || '-';
    const invoice = await Invoice.create({
        invoiceNo: await nextInvoiceNo(unitNo, contract._id),
        customer: quote.customer,
        invoiceDate: new Date(),
        dueDate,
        orderNumber: contract.contractNo,
        terms: 'Due on receipt',
        subject: `Storage Rent · ${contract.contractNo} · from ${quote.quoteNo}`,
        items,
        customerNotes: `Generated from quote ${quote.quoteNo} — prices locked as quoted.`,
        subTotal: invoiceTotal,
        total: invoiceTotal,
        paymentMade: 0,
        status: 'draft',
        createdBy: userName,
    });

    const rentAndAddOns = Number((invoiceTotal - depositAmt - advanceTotal).toFixed(2));
    if (rentAndAddOns > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: rentAndAddOns,
            dueDate,
            status: 'pending',
            notes: `Storage Rent (first period) · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }
    if (advanceTotal > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: advanceTotal,
            dueDate,
            status: 'pending',
            notes: `Refundable / Adjustable Security Deposit (last period) · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }
    if (depositAmt > 0) {
        await Payment.create({
            contract: contract._id,
            invoice: invoice._id,
            amount: depositAmt,
            dueDate,
            status: 'pending',
            notes: `Security deposit · ${quote.quoteNo}`,
            recordedBy: userName,
        });
    }

    return invoice;
}

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
    if (quote.status !== 'accepted') {
        return res.status(409).json({ error: 'Only accepted quotes can be converted to a contract' });
    }
    if (quote.contract) {
        const existing = await Contract.findById(quote.contract).select('_id contractNo');
        if (existing) {
            return res.status(409).json({ error: `Quote already converted to contract ${existing.contractNo}`, contractId: existing._id });
        }
        quote.contract = undefined; // stale ref — allow re-conversion
    }
    if (!quote.units?.length) {
        return res.status(400).json({ error: 'Quote has no units to convert' });
    }

    const unitIds = quote.units.map((u) => u.unit);
    const startDate = new Date(Math.min(...quote.units.map((u) => new Date(u.startDate).getTime())));
    const endDate = new Date(Math.max(...quote.units.map((u) => new Date(u.endDate).getTime())));
    const rate = Number(quote.units.reduce((s, u) => s + toNumber(u.rate), 0).toFixed(2));
    const discounts = [...new Set(quote.units.map((u) => toNumber(u.discountPct)))];
    const firstMonthDiscountPct = discounts.length === 1 ? discounts[0] : 0;

    const noteParts = [];
    if (quote.notes) noteParts.push(quote.notes);
    if (quote.addOns?.length) {
        noteParts.push('Add-ons: ' + quote.addOns.map((a) => `${a.name} x${a.quantity} (${a.amount} AED)`).join(', '));
    }

    const userName = req.user.name || req.user.email || 'user';

    // Optional contract options supplied at conversion time
    const authorizedPersons = (Array.isArray(req.body?.authorizedPersons) ? req.body.authorizedPersons : [])
        .map((p) => ({
            name: String(p.name || '').trim(),
            phone: String(p.phone || '').trim(),
            relation: String(p.relation || '').trim(),
            idType: String(p.idType || '').trim(),
            idNumber: String(p.idNumber || '').trim(),
        }))
        .filter((p) => p.name);

    const contract = await Contract.create({
        contractNo: await nextContractNo(),
        customer: quote.customer,
        unit: unitIds[0],
        units: unitIds.length > 1 ? unitIds : [],
        billingPeriod: quote.billingPeriod || 'monthly',
        rate,
        deposit: toNumber(quote.deposit),
        startDate,
        endDate,
        firstMonthDiscountPct,
        notes: noteParts.join('\n'),
        paymentMethod: String(req.body?.paymentMethod || ''),
        authorizedPersons,
        totalQuotation: Number(quote.total || 0),
        quote: quote._id,
        salesRep: quote.assignedTo || req.user.id,
        source: 'quote',
        approvalStatus: 'not_required',
        status: 'draft',
        timeline: [{ at: new Date(), text: `Created from quote ${quote.quoteNo} by ${userName}`, author: userName }],
    });

    // If anything below fails, undo the contract we just created rather than
    // leaving an orphan draft with no invoice — that orphan previously caused
    // retries to pile up duplicate contracts on every failed attempt.
    try {
        quote.contract = contract._id;
        quote.timeline.push({ type: 'converted', text: `Converted to contract ${contract.contractNo} by ${userName}`, user: req.user.id });

        const invoice = await createFirstInvoiceFromQuote(quote, contract, userName);
        contract.timeline.push({ at: new Date(), text: `Draft invoice ${invoice.invoiceNo} generated from quote (prices locked)`, author: userName });
        await contract.save();
        await quote.save();

        await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));

        res.status(201).json({ contractId: contract._id, contractNo: contract.contractNo, invoiceId: invoice._id, invoiceNo: invoice.invoiceNo });
    } catch (err) {
        await Contract.deleteOne({ _id: contract._id });
        res.status(500).json({ error: `Could not finish converting the quote: ${err.message}` });
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
