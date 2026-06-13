import { Router } from 'express';
import multer from 'multer';
import { Purchase, Vendor, nextPurchaseNo } from '../models/index.js';
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
        vendor: String(body.vendor || ''),
        orderNumber: String(body.orderNumber || ''),
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : new Date(),
        terms: String(body.terms || ''),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        purchaser: String(body.purchaser || ''),
        bankInformation: String(body.bankInformation || ''),
        subject: String(body.subject || ''),
        items,
        vendorNotes: String(body.vendorNotes || ''),
        subTotal,
        total,
        termsAndConditions: String(body.termsAndConditions || ''),
        status: String(body.status || 'draft'),
    };
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.vendor) filter.vendor = String(req.query.vendor);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ purchaseNo: re }, { orderNumber: re }, { subject: re }, { purchaser: re }];
    }
    const purchases = await Purchase.find(filter).populate('vendor', 'contactName companyName email phone').sort({ createdAt: -1 });
    res.json(purchases);
});

router.get('/:id', async (req, res) => {
    const purchase = await Purchase.findById(req.params.id).populate('vendor', 'contactName companyName email phone');
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json(purchase);
});

router.post('/', async (req, res) => {
    const body = normalizeBody(req.body || {});
    if (!body.vendor) return res.status(400).json({ error: 'Vendor is required' });
    if (!body.dueDate) return res.status(400).json({ error: 'Due date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const vendor = await Vendor.findById(body.vendor).select('_id');
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const purchase = await Purchase.create({ ...body, purchaseNo: await nextPurchaseNo() });
    res.status(201).json(await purchase.populate('vendor', 'contactName companyName email phone'));
});

router.put('/:id', async (req, res) => {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const body = normalizeBody(req.body || {});
    if (!body.vendor) return res.status(400).json({ error: 'Vendor is required' });
    if (!body.dueDate) return res.status(400).json({ error: 'Due date is required' });
    if (!body.items.length) return res.status(400).json({ error: 'At least one item is required' });

    const vendor = await Vendor.findById(body.vendor).select('_id');
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    Object.assign(purchase, body);
    await purchase.save();
    res.json(await purchase.populate('vendor', 'contactName companyName email phone'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['draft', 'sent', 'received', 'partial', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid purchase status' });
    }
    const purchase = await Purchase.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate('vendor', 'contactName companyName email phone');
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json(purchase);
});

router.delete('/:id', async (req, res) => {
    const purchase = await Purchase.findByIdAndDelete(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    res.json({ ok: true });
});

router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });
    if ((purchase.attachments?.length || 0) + files.length > 10) {
        return res.status(400).json({ error: 'You can upload a maximum of 10 files' });
    }

    for (const file of files) {
        const stored = await uploadFile({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
        });
        purchase.attachments.push({
            name: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            ...stored,
        });
    }

    await purchase.save();
    res.json(purchase);
});

router.delete('/:id/attachments/:index', async (req, res) => {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= purchase.attachments.length) {
        return res.status(400).json({ error: 'Invalid attachment index' });
    }
    purchase.attachments.splice(idx, 1);
    await purchase.save();
    res.json(purchase);
});

export default router;
