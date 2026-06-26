import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { Customer, Invoice, Payment, nextInvoiceNo } from '../models/index.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';
import { uploadFile } from '../services/drive.js';
import { sendWhatsAppText, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

async function syncLinkedPayment(invoice) {
    // An invoice may have multiple linked payment records (e.g. rent + deposit on invoice 1).
    // Update ALL of them so the payment schedule group reflects the correct status.
    const payments = await Payment.find({ invoice: invoice._id });
    if (!payments.length) return;

    const fullyPaid = Number(invoice.paymentMade || 0) >= Number(invoice.total || 0);
    const latest = (invoice.paymentHistory || []).at(-1);

    if (invoice.status === 'paid' || fullyPaid) {
        await Payment.updateMany(
            { invoice: invoice._id },
            {
                $set: {
                    status: 'paid',
                    paidDate: latest?.date ? new Date(latest.date) : new Date(),
                    method: latest?.method || 'other',
                },
            }
        );
        return;
    }

    // Unpaid — reset all linked records to pending/overdue based on due date.
    const now = new Date();
    for (const p of payments) {
        p.status = new Date(p.dueDate) < now ? 'overdue' : 'pending';
        p.paidDate = undefined;
        p.method = '';
        await p.save();
    }
}

async function detachLinkedPayment(invoiceId) {
    const linked = await Payment.findOne({ invoice: invoiceId });
    if (!linked) return;

    linked.invoice = undefined;
    linked.status = new Date(linked.dueDate) < new Date() ? 'overdue' : 'pending';
    linked.paidDate = undefined;
    linked.method = '';
    await linked.save();
}

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

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.customer) filter.customer = String(req.query.customer);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ invoiceNo: re }, { orderNumber: re }, { subject: re }, { salesperson: re }];
    }
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
    const skip  = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
      Invoice.find(filter).populate('customer', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Invoice.countDocuments(filter),
    ]);
    res.json({ data: invoices, total, page, pages: Math.ceil(total / limit), limit });
});

router.get('/:id', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // For contract-linked invoices, sync paymentMade and status from linked Payment records.
    const contractPayments = await Payment.find({ invoice: invoice._id });
    if (contractPayments.length > 0) {
        const totalPaid = Math.round(
            contractPayments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0) * 100
        ) / 100;
        const allPaid = contractPayments.every(p => p.status === 'paid');
        const updates = {};
        if (totalPaid > Number(invoice.paymentMade || 0)) updates.paymentMade = totalPaid;
        if (allPaid && totalPaid >= Number(invoice.total || 0) && invoice.status !== 'paid') updates.status = 'paid';
        if (Object.keys(updates).length > 0) {
            await Invoice.findByIdAndUpdate(invoice._id, { $set: updates });
            Object.assign(invoice, updates);
        }
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

router.post('/bulk-delete', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    await detachLinkedPayment(invoice._id);

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

    invoice.paymentHistory.push({
        date: date ? new Date(date) : new Date(),
        amount: n,
        method: method || 'cash',
        notes: notes || '',
    });
    invoice.paymentMade = Number(invoice.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (invoice.paymentMade >= invoice.total && invoice.status !== 'paid') {
        invoice.status = 'paid';
    }

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
    if (invoice.paymentMade < invoice.total && invoice.status === 'paid') {
        invoice.status = 'sent';
    }

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

export default router;
