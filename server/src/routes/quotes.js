import { Router } from 'express';
import { Customer, Quote, nextQuoteNo } from '../models/index.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = Router();

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
    const adjustment = toNumber(body.adjustment, 0);
    const total = Number((subTotal + adjustment).toFixed(2));

    return {
        quoteDate: body.quoteDate ? new Date(body.quoteDate) : new Date(),
        creationDate: body.creationDate ? new Date(body.creationDate) : new Date(),
        salesperson: String(body.salesperson || ''),
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        pdfTemplate: String(body.pdfTemplate || 'Standard Template'),
        customer: String(body.customer || ''),
        billingAddress: String(body.billingAddress || ''),
        shippingAddress: String(body.shippingAddress || ''),
        subject: String(body.subject || ''),
        items,
        subTotal,
        adjustment,
        total,
        notes: String(body.notes || ''),
        status: String(body.status || 'draft'),
    };
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.customer) filter.customer = String(req.query.customer);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ quoteNo: re }, { subject: re }, { salesperson: re }];
    }
    const quotes = await Quote.find(filter).populate('customer', 'fullName email').sort({ createdAt: -1 });
    res.json(quotes);
});

router.get('/:id', async (req, res) => {
    const quote = await Quote.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
});

router.post('/', async (req, res) => {
    const body = normalizeBody(req.body || {});
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.expiryDate) return res.status(400).json({ error: 'Expiry date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const quote = await Quote.create({ ...body, quoteNo: await nextQuoteNo() });
    res.status(201).json(await quote.populate('customer', 'fullName email'));
});

router.put('/:id', async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const body = normalizeBody(req.body || {});
    if (!body.customer) return res.status(400).json({ error: 'Customer is required' });
    if (!body.expiryDate) return res.status(400).json({ error: 'Expiry date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const customer = await Customer.findById(body.customer).select('_id');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    Object.assign(quote, body);
    await quote.save();
    res.json(await quote.populate('customer', 'fullName email'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(status)) {
        return res.status(400).json({ error: 'Invalid quote status' });
    }
    const quote = await Quote.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('customer', 'fullName email');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
});

router.delete('/:id', async (req, res) => {
    const quote = await Quote.findByIdAndDelete(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ ok: true });
});

router.get('/:id/pdf', async (req, res) => {
    const quote = await Quote.findById(req.params.id).populate('customer', 'fullName email phone address');
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf({ quote });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.quoteNo}.pdf"`);
    res.send(pdf);
});

export default router;
