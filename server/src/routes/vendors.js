import { Router } from 'express';
import multer from 'multer';
import { Vendor, Purchase, Expense } from '../models/index.js';
import { parseCsv } from '../services/csv.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseNum(v, d = 0) {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : d;
}

function categoryFlags(record) {
    const flags = ['Steel', 'Electrical', 'CAMERA CCTV', 'Fire Alarm', 'Civil Works'];
    return flags.filter((f) => String(record[f] || '').trim());
}

function mapVendor(record) {
    const status = String(record.Status || '').toLowerCase() === 'active' ? 'active' : 'inactive';
    return {
        contactId: String(record['Contact ID'] || '').trim(),
        contactName: String(record['Contact Name'] || '').trim(),
        companyName: String(record['Company Name'] || '').trim(),
        displayName: String(record['Display Name'] || '').trim(),
        email: String(record.EmailID || '').trim(),
        phone: String(record.Phone || '').trim(),
        mobilePhone: String(record.MobilePhone || '').trim(),
        currencyCode: String(record['Currency Code'] || 'AED').trim() || 'AED',
        notes: String(record.Notes || '').trim(),
        website: String(record.Website || '').trim(),
        status,
        openingBalance: parseNum(record['Opening Balance'], 0),
        paymentTermsLabel: String(record['Payment Terms Label'] || '').trim(),
        paymentTerms: parseNum(record['Payment Terms'], 0),
        ownerName: String(record['Owner Name'] || '').trim(),
        source: String(record.Source || '').trim(),
        categories: categoryFlags(record),
        billingAddress: {
            attention: String(record['Billing Attention'] || '').trim(),
            address: String(record['Billing Address'] || '').trim(),
            street2: String(record['Billing Street2'] || '').trim(),
            city: String(record['Billing City'] || '').trim(),
            state: String(record['Billing State'] || '').trim(),
            country: String(record['Billing Country'] || '').trim(),
            code: String(record['Billing Code'] || '').trim(),
            phone: String(record['Billing Phone'] || '').trim(),
            fax: String(record['Billing Fax'] || '').trim(),
        },
        shippingAddress: {
            attention: String(record['Shipping Attention'] || '').trim(),
            address: String(record['Shipping Address'] || '').trim(),
            street2: String(record['Shipping Street2'] || '').trim(),
            city: String(record['Shipping City'] || '').trim(),
            state: String(record['Shipping State'] || '').trim(),
            country: String(record['Shipping Country'] || '').trim(),
            code: String(record['Shipping Code'] || '').trim(),
            phone: String(record['Shipping Phone'] || '').trim(),
            fax: String(record['Shipping Fax'] || '').trim(),
        },
        importedAt: new Date(),
        raw: record,
    };
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ contactName: re }, { companyName: re }, { displayName: re }, { email: re }, { phone: re }];
    }
    if (req.query.category) filter.categories = String(req.query.category);
    const vendors = await Vendor.find(filter).sort({ contactName: 1, createdAt: -1 });
    res.json(vendors);
});

router.get('/:id', async (req, res) => {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
});

router.post('/', async (req, res) => {
    const contactName = String(req.body?.contactName || '').trim();
    const contactId = String(req.body?.contactId || '').trim();
    if (!contactName) return res.status(400).json({ error: 'Vendor contact name is required' });
    if (!contactId) return res.status(400).json({ error: 'Vendor contact id is required' });

    const exists = await Vendor.findOne({ contactId }).select('_id');
    if (exists) return res.status(409).json({ error: 'Vendor with this contact id already exists' });

    const vendor = await Vendor.create({
        contactId,
        contactName,
        companyName: String(req.body?.companyName || '').trim(),
        displayName: String(req.body?.displayName || '').trim(),
        email: String(req.body?.email || '').trim(),
        phone: String(req.body?.phone || '').trim(),
        mobilePhone: String(req.body?.mobilePhone || '').trim(),
        currencyCode: String(req.body?.currencyCode || 'AED').trim() || 'AED',
        status: ['active', 'inactive'].includes(String(req.body?.status || 'active')) ? req.body.status : 'active',
        notes: String(req.body?.notes || '').trim(),
        website: String(req.body?.website || '').trim(),
        paymentTermsLabel: String(req.body?.paymentTermsLabel || '').trim(),
        paymentTerms: parseNum(req.body?.paymentTerms, 0),
        openingBalance: parseNum(req.body?.openingBalance, 0),
        ownerName: String(req.body?.ownerName || '').trim(),
        source: String(req.body?.source || '').trim(),
        categories: Array.isArray(req.body?.categories) ? req.body.categories.filter(Boolean) : [],
    });

    res.status(201).json(vendor);
});

router.put('/:id', async (req, res) => {
    const update = {
        contactName: String(req.body?.contactName || '').trim(),
        companyName: String(req.body?.companyName || '').trim(),
        displayName: String(req.body?.displayName || '').trim(),
        email: String(req.body?.email || '').trim(),
        phone: String(req.body?.phone || '').trim(),
        mobilePhone: String(req.body?.mobilePhone || '').trim(),
        currencyCode: String(req.body?.currencyCode || 'AED').trim() || 'AED',
        status: ['active', 'inactive'].includes(String(req.body?.status || 'active')) ? req.body.status : 'active',
        notes: String(req.body?.notes || '').trim(),
        website: String(req.body?.website || '').trim(),
        paymentTermsLabel: String(req.body?.paymentTermsLabel || '').trim(),
        paymentTerms: parseNum(req.body?.paymentTerms, 0),
        openingBalance: parseNum(req.body?.openingBalance, 0),
        ownerName: String(req.body?.ownerName || '').trim(),
        source: String(req.body?.source || '').trim(),
        categories: Array.isArray(req.body?.categories) ? req.body.categories.filter(Boolean) : [],
    };
    if (!update.contactName) return res.status(400).json({ error: 'Vendor contact name is required' });

    const vendor = await Vendor.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
});

router.delete('/:id', async (req, res) => {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ ok: true });
});

router.post('/import/csv', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const content = req.file.buffer.toString('utf8');
    const rows = parseCsv(content);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
        const mapped = mapVendor(row);
        if (!mapped.contactId || !mapped.contactName) {
            skipped += 1;
            continue;
        }
        try {
            const existing = await Vendor.findOne({ contactId: mapped.contactId });
            if (!existing) {
                await Vendor.create(mapped);
                created += 1;
            } else {
                Object.assign(existing, mapped);
                await existing.save();
                updated += 1;
            }
        } catch {
            errors += 1;
        }
    }

    res.json({ ok: true, summary: { created, updated, skipped, errors, total: rows.length } });
});

router.get('/:id/summary', async (req, res) => {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const [purchases, expenses] = await Promise.all([
        Purchase.find({ vendor: req.params.id }),
        Expense.find({ vendor: req.params.id }),
    ]);

    const totalBills = purchases.reduce((s, p) => s + p.total, 0);
    const totalPaid = purchases.reduce((s, p) => s + (p.paymentMade || 0), 0);
    const now = new Date();
    const overdueBills = purchases.filter((p) =>
        !['received', 'cancelled'].includes(p.status) &&
        p.dueDate && new Date(p.dueDate) < now &&
        (p.paymentMade || 0) < p.total
    ).length;
    const totalExpenses = expenses.reduce((s, e) => s + (e.total || 0), 0);

    // Last 6 months
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const mBills = Object.fromEntries(months.map((m) => [m, 0]));
    const mPaid = Object.fromEntries(months.map((m) => [m, 0]));
    for (const p of purchases) {
        const k = `${new Date(p.purchaseDate).getFullYear()}-${String(new Date(p.purchaseDate).getMonth() + 1).padStart(2, '0')}`;
        if (k in mBills) { mBills[k] += p.total; mPaid[k] += (p.paymentMade || 0); }
    }

    res.json({
        stats: {
            totalBills: Number(totalBills.toFixed(2)),
            totalPaid: Number(totalPaid.toFixed(2)),
            outstanding: Number((totalBills - totalPaid).toFixed(2)),
            overdueBills,
            totalExpenses: Number(totalExpenses.toFixed(2)),
            billCount: purchases.length,
            expenseCount: expenses.length,
        },
        monthlyData: months.map((m) => ({
            month: m,
            bills: Number(mBills[m].toFixed(2)),
            paid: Number(mPaid[m].toFixed(2)),
        })),
    });
});

export default router;
