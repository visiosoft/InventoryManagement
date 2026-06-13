import { Router } from 'express';
import multer from 'multer';
import { Customer, Invoice, nextInvoiceNo } from '../models/index.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';
import { uploadFile } from '../services/drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
        bankInformation: String(body.bankInformation || ''),
        subject: String(body.subject || ''),
        customer: String(body.customer || ''),
        items,
        customerNotes: String(body.customerNotes || ''),
        subTotal,
        total,
        termsAndConditions: String(body.termsAndConditions || ''),
        status: String(body.status || 'draft'),
    };
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.customer) filter.customer = String(req.query.customer);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ invoiceNo: re }, { orderNumber: re }, { subject: re }, { salesperson: re }];
    }
    const invoices = await Invoice.find(filter).populate('customer', 'fullName email').sort({ createdAt: -1 });
    res.json(invoices);
});

router.get('/:id', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
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
    res.json(await invoice.populate('customer', 'fullName email'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid invoice status' });
    }
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('customer', 'fullName email');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
});

router.delete('/:id', async (req, res) => {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ok: true });
});

router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
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

router.get('/:id/pdf', async (req, res) => {
    const invoice = await Invoice.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const pdf = await renderInvoicePdf({ invoice });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
    res.send(pdf);
});

export default router;
