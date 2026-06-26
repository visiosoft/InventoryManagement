import { Router } from 'express';
import multer from 'multer';
import { Purchase, Vendor, nextPurchaseNo } from '../models/index.js';
import { uploadToVendorFolder } from '../services/drive.js';
import { parseCsv } from '../services/csv.js';

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
        filter.$or = [{ purchaseNo: re }, { orderNumber: re }, { subject: re }, { purchaser: re }, { vendorName: re }];
    }
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
        Purchase.find(filter).populate('vendor', 'contactName companyName email phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
        Purchase.countDocuments(filter),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
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
    const purchase = await Purchase.findById(req.params.id).populate('vendor', 'contactName companyName');
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });
    if ((purchase.attachments?.length || 0) + files.length > 10) {
        return res.status(400).json({ error: 'You can upload a maximum of 10 files' });
    }

    const vendorName = purchase.vendor?.companyName || purchase.vendor?.contactName || purchase.vendorName || 'Unknown Vendor';

    for (const file of files) {
        const stored = await uploadToVendorFolder({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
            vendorName,
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

// Record payment against a purchase bill
router.post('/:id/record-payment', async (req, res) => {
    const { amount, method, date, notes } = req.body;
    const n = toNumber(amount);
    if (n <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

    const purchase = await Purchase.findById(req.params.id).populate('vendor', 'contactName companyName email phone');
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.status === 'cancelled') {
        return res.status(409).json({ error: 'Cannot record payment for a cancelled bill' });
    }

    purchase.paymentHistory.push({
        date: date ? new Date(date) : new Date(),
        amount: n,
        method: method || 'cash',
        notes: notes || '',
    });
    purchase.paymentMade = Number(purchase.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (purchase.paymentMade >= purchase.total && purchase.status !== 'received') {
        purchase.status = 'received';
    }

    await purchase.save();
    res.json(purchase);
});

// Remove a payment entry by index
router.delete('/:id/payments/:idx', async (req, res) => {
    const purchase = await Purchase.findById(req.params.id).populate('vendor', 'contactName companyName email phone');
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (purchase.paymentHistory?.length || 0)) {
        return res.status(400).json({ error: 'Invalid payment index' });
    }

    purchase.paymentHistory.splice(idx, 1);
    purchase.paymentMade = Number(purchase.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (purchase.paymentMade < purchase.total && purchase.status === 'received') {
        purchase.status = 'partial';
    }

    await purchase.save();
    res.json(purchase);
});

function normalizeVendorName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function buildVendorLookup() {
    const vendors = await Vendor.find({}).select('_id contactName companyName displayName');
    const map = new Map();
    for (const v of vendors) {
        const keys = [v.contactName, v.companyName, v.displayName]
            .map((x) => normalizeVendorName(x))
            .filter(Boolean);
        for (const key of keys) {
            if (!map.has(key)) map.set(key, v._id);
        }
    }
    return map;
}

function mapBillStatus(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'paid') return 'received';
    if (s === 'open') return 'sent';
    if (s === 'overdue') return 'sent';
    if (s.includes('partial')) return 'partial';
    if (s === 'void' || s === 'cancelled') return 'cancelled';
    if (s === 'draft') return 'draft';
    return 'sent';
}

router.post('/import/csv', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    const mode = String(req.query.mode || 'skip');
    const content = req.file.buffer.toString('utf8');
    const rows = parseCsv(content);
    const vendorMap = await buildVendorLookup();

    // Group rows by Bill ID (a bill can have multiple line-item rows)
    const billGroups = new Map();
    for (const row of rows) {
        const billId = String(row['Bill ID'] || '').trim();
        if (!billId) continue;
        if (!billGroups.has(billId)) billGroups.set(billId, []);
        billGroups.get(billId).push(row);
    }

    let created = 0, updated = 0, skipped = 0, errors = 0, vendorLinked = 0;

    for (const [billId, billRows] of billGroups) {
        const first = billRows[0];

        const total = toNumber(first['Total'], 0);
        if (!total || total <= 0) { skipped++; continue; }

        const vendorName = String(first['Vendor Name'] || '').trim();
        const vendorId = vendorMap.get(normalizeVendorName(vendorName));
        if (vendorId) vendorLinked++;

        const status = mapBillStatus(first['Bill Status']);

        const items = billRows.map((r, idx) => {
            const desc = String(r['Description'] || r['Item Name'] || '').trim();
            const qty = toNumber(r['Quantity'], 1);
            const rate = toNumber(r['Rate'], 0);
            const amount = toNumber(r['Item Total'], qty * rate);
            return {
                sortOrder: idx,
                itemDetails: desc || String(r['Bill Number'] || 'Imported bill'),
                quantity: qty,
                rate,
                discountPct: toNumber(r['Discount'], 0),
                discountType: String(r['Discount Type'] || '').trim(),
                discount: toNumber(r['Discount'], 0),
                discountAmount: toNumber(r['Discount Amount'], 0),
                amount,
                taxAmount: toNumber(r['Tax Amount'], 0),
                account: String(r['Account'] || '').trim(),
                accountCode: String(r['Account Code'] || '').trim(),
                sku: String(r['SKU'] || '').trim(),
                isBillable: String(r['Is Billable'] || '').toLowerCase() === 'true',
            };
        }).filter((it) => it.amount >= 0);

        if (!items.length) {
            items.push({ sortOrder: 0, itemDetails: String(first['Bill Number'] || 'Imported bill'), quantity: 1, rate: total, discountPct: 0, discountType: '', discount: 0, discountAmount: 0, amount: total, taxAmount: 0, account: '', accountCode: '', sku: '', isBillable: false });
        }

        const subTotal = toNumber(first['SubTotal'], total);
        const balance = toNumber(first['Balance'], 0);
        const paidAmount = Number((total - balance).toFixed(2));

        const paymentHistory = [];
        if (paidAmount > 0) {
            paymentHistory.push({
                date: first['Due Date'] ? new Date(first['Due Date']) : new Date(first['Bill Date'] || Date.now()),
                amount: paidAmount,
                method: 'bank_transfer',
                notes: 'Imported from Zoho Bills',
            });
        }

        const catFlags = ['Steel', 'Electrical', 'CAMERA CCTV', 'Fire Alarm', 'Civil Works'];
        const categories = catFlags.filter((f) => String(first[f] || '').trim());

        const doc = {
            billId,
            vendor: vendorId || undefined,
            vendorName,
            orderNumber: String(first['Bill Number'] || '').trim(),
            purchaseOrderRef: String(first['PurchaseOrder'] || first['Purchase Order Number'] || '').trim(),
            purchaseDate: first['Bill Date'] ? new Date(first['Bill Date']) : new Date(),
            dueDate: first['Due Date'] ? new Date(first['Due Date']) : undefined,
            terms: String(first['Payment Terms Label'] || '').trim(),
            vendorNotes: String(first['Vendor Notes'] || '').trim(),
            termsAndConditions: String(first['Terms & Conditions'] || '').trim(),
            items,
            subTotal,
            total,
            paymentMade: paidAmount,
            paymentHistory,
            status,
            categories,
            source: 'import_csv',
            currencyCode: String(first['Currency Code'] || 'AED').trim() || 'AED',
            exchangeRate: toNumber(first['Exchange Rate'], 1),
            taxAmount: items.reduce((s, it) => s + (it.taxAmount || 0), 0),
            taxName: String(first['Tax Name'] || '').trim(),
            taxPercentage: toNumber(first['Tax Percentage'], 0),
            taxType: String(first['Tax Type'] || '').trim(),
            adjustment: toNumber(first['Adjustment'], 0),
            adjustmentDescription: String(first['Adjustment Description'] || '').trim(),
            billType: String(first['Bill Type'] || '').trim(),
            isInclusiveTax: String(first['Is Inclusive Tax'] || '').toLowerCase() === 'true',
            entityDiscountPercent: toNumber(first['Entity Discount Percent'], 0),
            entityDiscountAmount: toNumber(first['Entity Discount Amount'], 0),
            customerName: String(first['Customer Name'] || '').trim(),
            projectName: String(first['Project Name'] || '').trim(),
            submittedBy: String(first['Submitted By'] || '').trim(),
            approvedBy: String(first['Approved By'] || '').trim(),
            submittedDate: first['Submitted Date'] ? new Date(first['Submitted Date']) : undefined,
            approvedDate: first['Approved Date'] ? new Date(first['Approved Date']) : undefined,
            tinNumber: String(first['TIN Number'] || '').trim(),
            legalName: String(first['Legal Name'] || '').trim(),
        };

        try {
            const existing = await Purchase.findOne({ billId });
            if (!existing) {
                await Purchase.create({ ...doc, purchaseNo: await nextPurchaseNo() });
                created++;
            } else if (mode === 'update') {
                Object.assign(existing, doc);
                await existing.save();
                updated++;
            } else {
                skipped++;
            }
        } catch {
            errors++;
        }
    }

    res.json({ ok: true, summary: { created, updated, skipped, errors, vendorLinked, total: billGroups.size } });
});

export default router;
