import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import crypto from 'crypto';
import multer from 'multer';
import { Customer, Invoice, Payment, Contract, nextInvoiceNo } from '../models/index.js';
import { archivePdf } from '../utils/archivePdf.js';
import { parseCsv } from '../services/csv.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';
import { uploadFile } from '../services/drive.js';
import { sendWhatsAppText, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { zohoBooksConfigured, createZohoInvoice, recordZohoPayment } from '../services/zohoBooks.js';
import { applyInvoicePayment, syncLinkedPayment } from '../services/invoicePayments.js';
import { stripeConfigured, createCheckoutSession } from '../services/stripe.js';
import { resolveFeePct } from '../services/paymentFee.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Archive a rendered invoice PDF into the Documents section (fire-and-forget)
function archiveInvoicePdf(invoice, pdf) {
    const run = async () => {
        const contract = invoice.orderNumber
            ? await Contract.findOne({ contractNo: invoice.orderNumber }).select('_id')
            : null;
        await archivePdf({
            buffer: pdf,
            name: `${invoice.invoiceNo}.pdf`,
            customerId: invoice.customer?._id ?? invoice.customer,
            customerName: invoice.customer?.fullName,
            contractId: contract?._id,
            sourceUpdatedAt: invoice.updatedAt,
        });
    };
    run().catch(() => { });
}

const DEFAULT_BANK_INFORMATION =
    'Account Number: 019101745789\n' +
    'IBAN Number: AE500330000019101745789\n' +
    'Address: Unit 12, ABA Avenue Al Quoz 2, Dubai';

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
    // When rate is 0 (extra/custom items), use the direct amount field rather than computing 0
    const amount = rate === 0
        ? Number(toNumber(item.amount).toFixed(2))
        : Number((gross - (gross * discountPct) / 100).toFixed(2));
    return {
        sortOrder: toNumber(item.sortOrder, idx),
        itemDetails: String(item.itemDetails || '').trim(),
        quantity,
        rate,
        discountPct,
        amount,
    };
}

function normalizeBody(body) {
    const items = (Array.isArray(body.items) ? body.items : [])
        .map((it, idx) => mapItem(it, idx))
        .filter((it) => it.itemDetails && it.quantity >= 0 && it.rate >= 0);
    const subTotal = Number(items.reduce((s, it) => s + it.amount, 0).toFixed(2));
    const total = Number(toNumber(body.total, subTotal).toFixed(2));

    return {
        orderNumber: String(body.orderNumber || ''),
        invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : new Date(),
        terms: String(body.terms || ''),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        salesperson: String(body.salesperson || ''),
        bankInformation: String(body.bankInformation || DEFAULT_BANK_INFORMATION),
        subject: String(body.subject || ''),
        customer: String(body.customer || ''),
        items,
        customerNotes: String(body.customerNotes || ''),
        subTotal,
        total,
        paymentMade: toNumber(body.paymentMade, 0),
        termsAndConditions: String(body.termsAndConditions || ''),
        status: String(body.status || 'draft'),
    };
}

// syncLinkedPayment moved to services/invoicePayments.js — the Stripe
// webhook needed it too, and two copies of "when is an invoice paid" is
// exactly the kind of thing that quietly drifts apart.

async function detachLinkedPayment(invoiceId) {
    const linked = await Payment.findOne({ invoice: invoiceId });
    if (!linked) return;

    linked.invoice = undefined;
    linked.status = new Date(linked.dueDate) < new Date() ? 'overdue' : 'pending';
    linked.paidDate = undefined;
    linked.method = '';
    await linked.save();
}

// ── CSV import helpers ────────────────────────────────────────────────────────
function parseZohoMoney(v) {
    return parseFloat(String(v || '0').replace(/[^0-9.]/g, '')) || 0;
}

function parseZohoDate(v) {
    if (!v) return null;
    // "13-Feb-26" → "Feb 13 2026"
    const m = String(v).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (m) { const d = new Date(`${m[2]} ${m[1]} 20${m[3]}`); return isNaN(d.getTime()) ? null : d; }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function mapZohoInvoiceStatus(v) {
    switch (String(v || '').trim().toLowerCase()) {
        case 'paid': return 'paid';
        case 'overdue': return 'overdue';
        case 'sent': return 'sent';
        case 'draft': return 'draft';
        case 'void': return 'cancelled';
        default: return 'draft';
    }
}

// Build lookup: normalized fullName → { _id, fullName }
async function buildCustomerNameLookup() {
    const customers = await Customer.find({}).select('_id fullName');
    // Store as array for fuzzy scanning
    return customers.map(c => ({ _id: c._id, name: String(c.fullName || '').trim(), lower: String(c.fullName || '').trim().toLowerCase() }));
}

// Multi-tier name matching:
// 1. Exact (case-insensitive)
// 2. System name STARTS WITH csv name  (e.g. "Katya" → "Katya Ekaterini De Nysschen")
// 3. CSV name STARTS WITH system name
// 4. First word of csv name matches first word of system name (min 3 chars)
function matchCustomer(csvName, customers) {
    const needle = csvName.toLowerCase().trim();
    const needleWords = needle.split(/\s+/);

    // Tier 1: exact
    const exact = customers.find(c => c.lower === needle);
    if (exact) return exact._id;

    // Tier 2: system name starts with full csv name
    const fwd = customers.find(c => c.lower.startsWith(needle + ' ') || c.lower === needle);
    if (fwd) return fwd._id;

    // Tier 3: csv name starts with system name
    const rev = customers.find(c => needle.startsWith(c.lower + ' '));
    if (rev) return rev._id;

    // Tier 4: first word of csv matches first word of system (min 3 chars)
    const needleFirst = needleWords[0];
    if (needleFirst.length >= 3) {
        const firstWord = customers.find(c => {
            const sysFirst = c.lower.split(/\s+/)[0];
            return sysFirst === needleFirst;
        });
        if (firstWord) return firstWord._id;
    }

    return null;
}

// Rollback all invoices + customers created by a specific import batch
router.delete('/import/rollback/:batch', requireAdmin, async (req, res) => {
    const batch = req.params.batch;
    const invoices = await Invoice.find({ importBatch: batch }).select('_id');
    const invoiceIds = invoices.map(i => i._id);
    await Invoice.deleteMany({ importBatch: batch });
    const customers = await Customer.deleteMany({ importBatch: batch });
    res.json({ ok: true, invoicesDeleted: invoiceIds.length, customersDeleted: customers.deletedCount });
});

// List import batches
router.get('/import/batches', async (req, res) => {
    const batches = await Invoice.distinct('importBatch', { importBatch: { $ne: null } });
    res.json(batches.filter(Boolean));
});

// One-time cleanup: delete stub customers (source=import_csv OR recently created with no contracts/units)
// and their linked invoices, created within the last N hours
router.delete('/import/cleanup-stubs', requireAdmin, async (req, res) => {
    const hours = Math.min(72, Math.max(1, parseInt(req.query.hours) || 24));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Find customers created recently with source=import_csv
    const stubCustomers = await Customer.find({
        source: 'import_csv',
        createdAt: { $gte: since },
    }).select('_id fullName');

    // Also find customers created recently that have no contracts/units
    // (These are the ones from the first bad import that had no source tag)
    const recentNoSource = await Customer.find({
        createdAt: { $gte: since },
        source: { $in: ['manual', null, undefined] },
    }).select('_id fullName');

    // Filter: only delete if they have no contracts, no units, and invoices only from recent import
    const { Contract, Unit } = await import('../models/index.js');
    const stubIds = [];
    for (const c of recentNoSource) {
        const hasContract = await Contract.exists({ customer: c._id });
        const hasUnit = await Unit.exists({ customer: c._id });
        if (!hasContract && !hasUnit) {
            stubIds.push(c._id);
        }
    }

    const allStubIds = [...stubCustomers.map(c => c._id), ...stubIds];

    // Delete invoices linked to stub customers
    const invResult = await Invoice.deleteMany({ customer: { $in: allStubIds } });
    // Delete stub customers
    const custResult = await Customer.deleteMany({ _id: { $in: allStubIds } });

    res.json({
        ok: true,
        customersDeleted: custResult.deletedCount,
        invoicesDeleted: invResult.deletedCount,
        names: [...stubCustomers.map(c => c.fullName), ...recentNoSource.filter(c => stubIds.some(id => id.equals(c._id))).map(c => c.fullName)],
    });
});

router.post('/import/csv', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mode = String(req.query.mode || 'skip');
    const batch = new Date().toISOString(); // unique batch ID per run

    let rows;
    try { rows = parseCsv(req.file.buffer); }
    catch (e) { return res.status(400).json({ error: `CSV parse error: ${e.message}` }); }

    const customers = await buildCustomerNameLookup();
    // in-run cache so we only create one stub per unique unmatched name
    const stubCache = new Map(); // lowerName → _id
    const summary = { created: 0, updated: 0, skipped: 0, errors: 0, stubsCreated: 0, total: rows.length };
    const errorLines = [];
    const stubNames = []; // names that became stubs

    for (const row of rows) {
        try {
            const invoiceNo = String(row['Invoice#'] || '').trim();
            const customerName = String(row['Customer Name'] || '').trim();
            if (!invoiceNo || !customerName) { summary.errors++; continue; }

            const amount = parseZohoMoney(row['Amount']);
            const balanceDue = parseZohoMoney(row['Balance Due']);
            const paymentMade = Math.max(0, Math.round((amount - balanceDue) * 100) / 100);
            const invoiceDate = parseZohoDate(row['Date']) || new Date();
            const dueDate = parseZohoDate(row['Due Date']) || invoiceDate;
            const status = mapZohoInvoiceStatus(row['Status']);
            const orderNumber = String(row['Order Number'] || '').trim();

            // Match customer — create a tagged stub if no match so user can merge later
            let customerId = matchCustomer(customerName, customers);
            if (!customerId) {
                const key = customerName.toLowerCase();
                if (stubCache.has(key)) {
                    customerId = stubCache.get(key);
                } else {
                    // Check if a stub for this name already exists from a prior run
                    const existing = await Customer.findOne({ fullName: customerName, source: 'import_csv' });
                    if (existing) {
                        customerId = existing._id;
                    } else {
                        const stub = await Customer.create({ fullName: customerName, source: 'import_csv', importBatch: batch });
                        customerId = stub._id;
                        customers.push({ _id: stub._id, name: customerName, lower: key });
                        summary.stubsCreated++;
                        stubNames.push(customerName);
                    }
                    stubCache.set(key, customerId);
                }
            }

            const existing = await Invoice.findOne({ invoiceNo });

            if (existing) {
                if (mode === 'skip') { summary.skipped++; continue; }
                existing.customer = customerId;
                existing.invoiceDate = invoiceDate;
                existing.dueDate = dueDate;
                existing.status = status;
                existing.orderNumber = orderNumber;
                existing.total = amount;
                existing.subTotal = amount;
                const oldHistSum = (existing.paymentHistory || []).reduce((s, e) => s + (e.amount || 0), 0);
                if (paymentMade > oldHistSum + 0.01) {
                    const gap = Math.round((paymentMade - oldHistSum) * 100) / 100;
                    existing.paymentHistory.push({ date: invoiceDate, amount: gap, method: 'bank_transfer', notes: 'Imported from Zoho' });
                }
                const newHistSum = existing.paymentHistory.reduce((s, e) => s + (e.amount || 0), 0);
                existing.paymentMade = Math.round(Math.max(Number(existing.paymentMade || 0), newHistSum) * 100) / 100;
                existing.source = 'import_csv';
                existing.importBatch = batch;
                await existing.save();
                summary.updated++;
            } else {
                const items = [{ itemDetails: 'Moving / Storage Service', quantity: 1, rate: amount, discountPct: 0, amount }];
                const paymentHistory = paymentMade > 0
                    ? [{ date: invoiceDate, amount: paymentMade, method: 'bank_transfer', notes: 'Imported from Zoho' }]
                    : [];
                await Invoice.create({
                    invoiceNo, orderNumber, invoiceDate, dueDate,
                    customer: customerId,
                    items, subTotal: amount, total: amount, paymentMade,
                    paymentHistory, status,
                    bankInformation: DEFAULT_BANK_INFORMATION,
                    source: 'import_csv',
                    importBatch: batch,
                });
                summary.created++;
            }
        } catch (err) {
            summary.errors++;
            errorLines.push(`${row['Invoice#'] || '?'}: ${err.message}`);
        }
    }

    res.json({ ok: true, batch, summary, stubs: stubNames, errors: errorLines.slice(0, 20) });
});

// Public: view invoice PDF by share token (no auth required)
router.get('/public/:token/pdf', async (req, res) => {
    const invoice = await Invoice.findOne({ shareToken: req.params.token })
        .populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found or link expired' });

    const pdfPayments = await Payment.find({ invoice: invoice._id, status: 'paid' });
    if (pdfPayments.length > 0) {
        const totalPaid2 = Math.round(pdfPayments.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
        if (totalPaid2 > Number(invoice.paymentMade || 0)) invoice.paymentMade = totalPaid2;
    }

    const pdf = await renderInvoicePdf({ invoice });
    archiveInvoicePdf(invoice, pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
    res.send(pdf);
});

// Generate (or return existing) share link for an invoice
router.post('/:id/share', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.shareToken) {
        invoice.shareToken = crypto.randomUUID();
        await invoice.save();
    }
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${proto}://${host}/api/invoices/public/${invoice.shareToken}/pdf`;
    res.json({ token: invoice.shareToken, url });
});

// Short redirect to the current Stripe payment link — see the identical
// comment on moving-invoices' version of this route. Public: a customer
// clicks this from WhatsApp or email with no login.
router.get('/pay/link/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).select('stripePaymentLinkUrl');
        if (!invoice?.stripePaymentLinkUrl) return res.status(404).send('Payment link not found or expired');
        res.redirect(302, invoice.stripePaymentLinkUrl);
    } catch {
        res.status(404).send('Payment link not found');
    }
});

// Create (or reuse) a Stripe Checkout session for the outstanding balance.
// The card fee, if any, comes only from the global Settings switch — never
// from the request — so switching it off genuinely stops it everywhere.
router.post('/:id/payment-link', async (req, res) => {
    try {
        if (!stripeConfigured()) {
            return res.status(400).json({ error: 'Stripe is not connected — add a secret key in Settings → Payments' });
        }
        const channel = req.body?.channel;
        if (!['whatsapp', 'email', 'link'].includes(channel)) {
            return res.status(400).json({ error: 'Pick a channel: whatsapp, email or link' });
        }
        const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        if (invoice.status === 'cancelled') return res.status(409).json({ error: 'This invoice is cancelled' });
        const balanceDue = Math.max(0, Number(invoice.total || 0) - Number(invoice.paymentMade || 0));
        if (balanceDue <= 0) return res.status(400).json({ error: 'Invoice already fully paid' });

        const customer = invoice.customer;
        if (channel === 'whatsapp' && !customer?.phone) {
            return res.status(400).json({ error: 'This customer has no phone number on file' });
        }
        if (channel === 'email' && !customer?.email) {
            return res.status(400).json({ error: 'This customer has no email on file' });
        }

        const feePct = await resolveFeePct();
        const clientOrigin = process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae';
        const session = await createCheckoutSession({
            amountAed: balanceDue,
            productName: `Invoice ${invoice.invoiceNo}`,
            description: 'Storage invoice balance due — PurpleBox',
            metadata: { storageInvoiceId: String(invoice._id), invoiceNo: invoice.invoiceNo },
            customerEmail: customer?.email,
            successUrl: `${clientOrigin}/pay/success?invoice=${invoice.invoiceNo}`,
            cancelUrl: `${clientOrigin}/invoices/${invoice._id}`,
            feePct,
        });

        invoice.stripeCheckoutSessionId = session.id;
        invoice.stripePaymentLinkUrl = session.url;
        await invoice.save();

        const apiBase = (process.env.API_PUBLIC_URL || process.env.APP_URL || req.headers.origin || 'https://api.purplebox.ae').replace(/\/$/, '');
        const payUrl = `${apiBase}/api/invoices/pay/link/${invoice._id}`;
        const totalCharged = balanceDue + session.feeAmount;

        // Storage's own convention for WhatsApp is a client-side wa.me deep
        // link (see the invoice detail page's Share button) rather than a
        // server-initiated Cloud API send — kept the same way here, so this
        // route only ever emails, and 'whatsapp'/'link' both just hand the
        // URL back for the client to deliver.
        if (channel === 'email') {
            if (!mailConfigured()) return res.status(400).json({ error: 'Email is not connected — connect Gmail in Settings' });
            const feeLine = session.feeAmount > 0
                ? `<br/>Card processing fee (${feePct}%): <strong>AED ${session.feeAmount.toLocaleString()}</strong><br/>Total to pay: <strong>AED ${totalCharged.toLocaleString()}</strong>`
                : '';
            const html = [
                `<p>Hi ${customer.fullName},</p>`,
                `<p>Your invoice <strong>${invoice.invoiceNo}</strong> is ready.<br/>`,
                `Balance due: <strong>AED ${balanceDue.toLocaleString()}</strong>${feeLine}</p>`,
                `<p><a href="${payUrl}" style="display:inline-block;background:#5B2BC9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:bold;">Pay Online →</a></p>`,
                `<p>Thank you!<br/>PurpleBox</p>`,
            ].join('\n');
            const text = `Hi ${customer.fullName},

Your invoice ${invoice.invoiceNo} is ready.
Balance due: AED ${balanceDue.toLocaleString()}${session.feeAmount > 0 ? `
Card processing fee (${feePct}%): AED ${session.feeAmount.toLocaleString()}
Total to pay: AED ${totalCharged.toLocaleString()}` : ''}

Pay online: ${payUrl}

Thank you! — PurpleBox`;
            const invoicePdf = await renderInvoicePdf({ invoice, co: {} }).catch(() => null);
            await sendMail({
                to: customer.email,
                subject: `Payment due — Invoice ${invoice.invoiceNo} — PurpleBox`,
                text, html,
                attachments: invoicePdf ? [{ filename: `${invoice.invoiceNo}.pdf`, content: invoicePdf, contentType: 'application/pdf' }] : [],
            });
        }

        res.json({ payUrl, balanceDue, channel, feePct, feeAmount: session.feeAmount, totalCharged });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.customer) filter.customer = String(req.query.customer);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ invoiceNo: re }, { orderNumber: re }, { subject: re }, { salesperson: re }];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
    const skip = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
        Invoice.find(filter).populate('customer', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit),
        Invoice.countDocuments(filter),
    ]);
    res.json({ data: invoices, total, page, pages: Math.ceil(total / limit), limit });
});

router.get('/:id', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Recalculate paymentMade from the two authoritative sources:
    // 1) paymentHistory (embedded array on the invoice)
    // 2) linked Payment records (from the contract payment schedule)
    const historySum = Number((invoice.paymentHistory || []).reduce((s, p) => s + (p.amount || 0), 0).toFixed(2));
    const contractPayments = await Payment.find({ invoice: invoice._id });
    const paymentRecordSum = Math.round(
        contractPayments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0) * 100
    ) / 100;
    const correctPaid = Math.round(Math.min(Math.max(historySum, paymentRecordSum), Number(invoice.total || 0)) * 100) / 100;
    const allPaid = contractPayments.length > 0 && contractPayments.every(p => p.status === 'paid');

    const updates = {};
    if (Math.abs(correctPaid - Number(invoice.paymentMade || 0)) > 0.01) updates.paymentMade = correctPaid;
    if (allPaid && correctPaid >= Number(invoice.total || 0) && invoice.status !== 'paid') updates.status = 'paid';
    else if (!allPaid && correctPaid > 0 && correctPaid < Number(invoice.total || 0) && invoice.status === 'paid') updates.status = 'partial';
    if (correctPaid >= invoice.total && invoice.status !== 'paid' && !updates.status) updates.status = 'paid';
    if (Object.keys(updates).length > 0) {
        await Invoice.findByIdAndUpdate(invoice._id, { $set: updates });
        Object.assign(invoice, updates);
    }

    res.json(invoice);
});

router.post('/', async (req, res) => {
    const body = normalizeBody(req.body || {});
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.dueDate) return res.status(400).json({ error: 'Due date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const invoice = await Invoice.create({ ...body, invoiceNo: await nextInvoiceNo() });
    res.status(201).json(await invoice.populate('customer', 'fullName email'));
});

router.put('/:id', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const body = normalizeBody(req.body || {});
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.dueDate) return res.status(400).json({ error: 'Due date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    Object.assign(invoice, body);
    await invoice.save();

    // Sync all linked payment amounts to match updated invoice items
    const payments = await Payment.find({ invoice: invoice._id }).sort({ dueDate: 1 });
    const sortedItems = [...body.items].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < payments.length; i++) {
        const item = sortedItems[i];
        if (item) {
            payments[i].amount = item.amount;
            payments[i].notes = item.itemDetails;
            await payments[i].save();
        }
    }

    res.json(await invoice.populate('customer', 'fullName email'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid invoice status' });
    }
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('customer', 'fullName email');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    await syncLinkedPayment(invoice);
    res.json(invoice);
});

router.post('/bulk-delete', requireAdmin, async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((id) => String(id || '').trim()).filter(Boolean)
        : [];

    if (!ids.length) {
        return res.status(400).json({ error: 'ids array is required' });
    }

    const uniqueIds = Array.from(new Set(ids));
    const invoices = await Invoice.find({ _id: { $in: uniqueIds } }).select('_id');
    const foundIds = invoices.map((invoice) => String(invoice._id));

    await Invoice.deleteMany({ _id: { $in: uniqueIds } });

    for (const invoiceId of foundIds) {
        await detachLinkedPayment(invoiceId);
    }

    res.json({ ok: true, deleted: foundIds.length, requested: uniqueIds.length });
});

router.delete('/:id', requireAdmin, async (req, res) => {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    await Payment.deleteMany({ invoice: invoice._id });

    res.json({ ok: true });
});

router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });
    if ((invoice.attachments?.length || 0) + files.length > 10) {
        return res.status(400).json({ error: 'You can upload a maximum of 10 files' });
    }

    for (const file of files) {
        const stored = await uploadFile({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
            customerName: invoice.customer?.fullName,
        });
        invoice.attachments.push({
            name: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            ...stored,
        });
    }

    await invoice.save();
    res.json(invoice);
});

router.delete('/:id/attachments/:index', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= invoice.attachments.length) {
        return res.status(400).json({ error: 'Invalid attachment index' });
    }
    invoice.attachments.splice(idx, 1);
    await invoice.save();
    res.json(invoice);
});

// Record a payment against an invoice.
router.post('/:id/record-payment', async (req, res) => {
    const { amount, method, date, notes } = req.body;
    const n = toNumber(amount);
    if (n <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'cancelled') {
        return res.status(409).json({ error: 'Cannot record payment for a cancelled invoice' });
    }

    applyInvoicePayment(invoice, { amount: n, method, date, notes });

    await invoice.save();
    await syncLinkedPayment(invoice);

    res.json(invoice);
});

// Remove a payment entry by index.
router.delete('/:id/payments/:idx', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (invoice.paymentHistory?.length || 0)) {
        return res.status(400).json({ error: 'Invalid payment index' });
    }

    invoice.paymentHistory.splice(idx, 1);
    invoice.paymentMade = Number(invoice.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (invoice.paymentMade >= invoice.total) invoice.status = 'paid';
    else if (invoice.paymentMade > 0) invoice.status = 'partial';
    else invoice.status = 'sent';

    await invoice.save();
    await syncLinkedPayment(invoice);
    res.json(invoice);
});

// Update a payment entry by index.
router.put('/:id/payments/:idx', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (invoice.paymentHistory?.length || 0)) {
        return res.status(400).json({ error: 'Invalid payment index' });
    }

    const { amount, method, date, notes } = req.body;
    const entry = invoice.paymentHistory[idx];
    if (amount != null) { const n = toNumber(amount); if (n <= 0) return res.status(400).json({ error: 'Amount must be > 0' }); entry.amount = n; }
    if (method) entry.method = method;
    if (date) entry.date = new Date(date);
    if (notes != null) entry.notes = notes;

    invoice.paymentMade = Number(invoice.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (invoice.paymentMade >= invoice.total) invoice.status = 'paid';
    else if (invoice.paymentMade > 0) invoice.status = 'partial';
    else invoice.status = 'sent';

    await invoice.save();
    await syncLinkedPayment(invoice);
    res.json(invoice);
});

router.get('/:id/pdf', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const pdfPaymentsPaid = await Payment.find({ invoice: invoice._id, status: 'paid' });
    if (pdfPaymentsPaid.length > 0) {
        const pdfTotalPaid = Math.round(pdfPaymentsPaid.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
        if (pdfTotalPaid > Number(invoice.paymentMade || 0)) invoice.paymentMade = pdfTotalPaid;
    }

    const pdf = await renderInvoicePdf({ invoice });
    archiveInvoicePdf(invoice, pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
    res.send(pdf);
});

router.post('/:id/whatsapp-send', async (req, res) => {
    if (!whatsappSendConfigured()) {
        return res.status(400).json({
            error: 'WhatsApp send is not configured in server environment',
            missing: whatsappSendMissing(),
        });
    }

    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone phones address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const customerPhone = invoice.customer?.phones?.find(Boolean) || invoice.customer?.phone || '';
    if (!customerPhone) {
        return res.status(400).json({ error: 'Customer has no phone number' });
    }

    const dueLabel = new Date(invoice.dueDate).toLocaleDateString('en-GB');
    const totalLabel = Number(invoice.total || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    const body = [
        `Hello ${invoice.customer?.fullName || 'Customer'},`,
        '',
        `Your invoice ${invoice.invoiceNo} is ready.`,
        `Amount: AED ${totalLabel}`,
        `Due date: ${dueLabel}`,
        '',
        'Please contact us to confirm payment. Thank you.',
    ].join('\n');

    try {
        const result = await sendWhatsAppText({ to: customerPhone, body });
        res.json({ ok: true, to: customerPhone, result });
    } catch (err) {
        res.status(502).json({ error: err.message || 'Failed to send invoice via WhatsApp' });
    }
});

// ── Zoho Books sync ───────────────────────────────────────────────────────────

// GET sync status config
router.get('/zoho-books/status', (req, res) => {
    res.json({ configured: zohoBooksConfigured() });
});

// POST sync a single invoice to Zoho Books
router.post('/:id/sync-zoho-books', async (req, res) => {
    try {
        if (!zohoBooksConfigured()) {
            return res.status(400).json({ error: 'Zoho Books is not configured. Add credentials in server .env file.' });
        }
        const invoice = await Invoice.findById(req.params.id).populate('customer');
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        if (!invoice.customer) return res.status(400).json({ error: 'Invoice has no customer linked. Please assign a customer first.' });
        if (!invoice.customer.fullName) return res.status(400).json({ error: 'Customer has no name. Please update customer details.' });
        if (!invoice.items?.length) return res.status(400).json({ error: 'Invoice has no line items. Cannot sync an empty invoice.' });

        const result = await createZohoInvoice(invoice);
        invoice.zohoBooksSyncId = result.zohoInvoiceId;
        invoice.zohoBooksSyncedAt = new Date();
        invoice.zohoBooksSyncError = null;
        await invoice.save();

        res.json({ ok: true, zohoInvoiceId: result.zohoInvoiceId });
    } catch (err) {
        const msg = err.response?.data?.message || err.message || 'Zoho Books sync failed';
        // Save the error on the invoice for visibility
        try {
            await Invoice.findByIdAndUpdate(req.params.id, { zohoBooksSyncError: msg });
        } catch { /* ignore */ }
        res.status(502).json({ error: msg });
    }
});

// POST bulk sync multiple invoices
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
                const invoice = await Invoice.findById(invoiceId).populate('customer');
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
                    await Invoice.findByIdAndUpdate(invoiceId, {
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

// Send invoice PDF via email
router.post('/:id/send-email', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone');
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        if (!mailConfigured()) return res.status(400).json({ error: 'SMTP not configured — set SMTP_PASS in server/.env' });
        const { to, subject, body } = req.body;
        const email = to || invoice.customer?.email;
        if (!email) return res.status(400).json({ error: 'Customer has no email address' });
        const subjectLine = subject || `Invoice ${invoice.invoiceNo} — PurpleBox`;
        const bodyText = body || `Dear ${invoice.customer.fullName},\n\nPlease find your invoice ${invoice.invoiceNo} for AED ${Number(invoice.total || 0).toFixed(2)} attached.\n\nThank you,\nPurpleBox`;
        const bodyHtml = bodyText.replace(/\n/g, '<br/>');
        const pdf = await renderInvoicePdf({ invoice });
        archiveInvoicePdf(invoice, pdf);
        await sendMail({
            to: email,
            subject: subjectLine,
            text: bodyText,
            html: bodyHtml,
            attachments: [{ filename: `${invoice.invoiceNo}.pdf`, content: pdf, contentType: 'application/pdf' }],
        });
        if (invoice.status === 'draft') { invoice.status = 'sent'; await invoice.save(); }

        // Invoices hang off a contract by contract number; log the send there
        // so the tenant's activity feed shows every email they were sent.
        if (invoice.orderNumber) {
            await Contract.updateOne(
                { contractNo: invoice.orderNumber },
                {
                    $push: {
                        timeline: {
                            at: new Date(),
                            text: `Email "${subjectLine}" sent to ${email}`,
                            author: req.user?.name || req.user?.email || '',
                        },
                    },
                },
            );
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('send-email error:', err);
        res.status(500).json({ error: err.message || 'Failed to send email' });
    }
});

export default router;
