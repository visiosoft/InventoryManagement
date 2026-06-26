import { Router } from 'express';
import multer from 'multer';
import { Expense, Vendor } from '../models/index.js';
import { parseCsv } from '../services/csv.js';
import { uploadToVendorFolder } from '../services/drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const STATUS_VALUES = ['recorded', 'approved', 'paid', 'reimbursed', 'cancelled'];

function toNumber(v, d = 0) {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : d;
}

function toBool(v, d = false) {
    if (typeof v === 'boolean') return v;
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return d;
    if (['true', 'yes', 'y', '1'].includes(s)) return true;
    if (['false', 'no', 'n', '0'].includes(s)) return false;
    return d;
}

function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryFlags(record) {
    const flags = ['Steel', 'Electrical', 'CAMERA CCTV', 'Fire Alarm', 'Civil Works'];
    return flags.filter((f) => String(record[f] || '').trim());
}

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

function mapExpense(record, vendorIdByName) {
    const vendorName = String(record.Vendor || '').trim();
    const normalizedVendorName = normalizeVendorName(vendorName);
    const status = STATUS_VALUES.includes(String(record.Status || '').trim())
        ? String(record.Status || '').trim()
        : 'recorded';

    const body = {
        expenseDate: record['Expense Date'] ? new Date(record['Expense Date']) : new Date(),
        description: String(record['Expense Description'] || '').trim(),
        expenseAccount: String(record['Expense Account'] || '').trim(),
        expenseAccountCode: String(record['Expense Account Code'] || '').trim(),
        paidThrough: String(record['Paid Through'] || '').trim(),
        paidThroughAccountCode: String(record['Paid Through Account Code'] || '').trim(),
        vendorName,
        projectName: String(record['Project Name'] || '').trim(),
        entryNumber: toNumber(record['Entry Number'], 0),
        currencyCode: String(record['Currency Code'] || 'AED').trim() || 'AED',
        exchangeRate: toNumber(record['Exchange Rate'], 1),
        isInclusiveTax: toBool(record['Is Inclusive Tax'], false),
        mileageRate: toNumber(record['Mileage Rate'], 0),
        mileageUnit: String(record['Mileage Unit'] || '').trim(),
        distance: toNumber(record.Distance, 0),
        startOdometerReading: toNumber(record['Start Odometer Reading'], 0),
        endOdometerReading: toNumber(record['End Odometer Reading'], 0),
        mileageType: String(record['Mileage Type'] || '').trim(),
        vehicleName: String(record['Vehicle Name'] || '').trim(),
        claimantEmail: String(record['Claimant Email'] || '').trim(),
        taxName: String(record['Tax Name'] || '').trim(),
        taxPercentage: toNumber(record['Tax Percentage'], 0),
        taxType: String(record['Tax Type'] || '').trim(),
        taxAmount: toNumber(record['Tax Amount'], 0),
        expenseAmount: toNumber(record['Expense Amount'], 0),
        total: toNumber(record.Total, 0),
        referenceNo: String(record['Reference#'] || '').trim(),
        isBillable: toBool(record['Is Billable'], false),
        customerName: String(record['Customer Name'] || '').trim(),
        expenseReferenceId: String(record['Expense Reference ID'] || '').trim(),
        recurrenceName: String(record['Recurrence Name'] || '').trim(),
        expenseReportName: String(record['ExpenseReport Name'] || '').trim(),
        isReimbursable: toBool(record['Is Reimbursable'], false),
        categories: categoryFlags(record),
        status,
    };

    if (normalizedVendorName && vendorIdByName.has(normalizedVendorName)) {
        body.vendor = vendorIdByName.get(normalizedVendorName);
    }

    return body;
}

function normalizeBody(body) {
    const status = STATUS_VALUES.includes(String(body.status || 'recorded'))
        ? String(body.status || 'recorded')
        : 'recorded';

    return {
        expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
        description: String(body.description || '').trim(),
        expenseAccount: String(body.expenseAccount || '').trim(),
        expenseAccountCode: String(body.expenseAccountCode || '').trim(),
        paidThrough: String(body.paidThrough || '').trim(),
        paidThroughAccountCode: String(body.paidThroughAccountCode || '').trim(),
        vendor: body.vendor ? String(body.vendor) : undefined,
        vendorName: String(body.vendorName || '').trim(),
        projectName: String(body.projectName || '').trim(),
        entryNumber: toNumber(body.entryNumber, 0),
        currencyCode: String(body.currencyCode || 'AED').trim() || 'AED',
        exchangeRate: toNumber(body.exchangeRate, 1),
        isInclusiveTax: toBool(body.isInclusiveTax, false),
        mileageRate: toNumber(body.mileageRate, 0),
        mileageUnit: String(body.mileageUnit || '').trim(),
        distance: toNumber(body.distance, 0),
        startOdometerReading: toNumber(body.startOdometerReading, 0),
        endOdometerReading: toNumber(body.endOdometerReading, 0),
        mileageType: String(body.mileageType || '').trim(),
        vehicleName: String(body.vehicleName || '').trim(),
        claimantEmail: String(body.claimantEmail || '').trim(),
        taxName: String(body.taxName || '').trim(),
        taxPercentage: toNumber(body.taxPercentage, 0),
        taxType: String(body.taxType || '').trim(),
        taxAmount: toNumber(body.taxAmount, 0),
        expenseAmount: toNumber(body.expenseAmount, 0),
        total: toNumber(body.total, 0),
        referenceNo: String(body.referenceNo || '').trim(),
        isBillable: toBool(body.isBillable, false),
        customerName: String(body.customerName || '').trim(),
        expenseReferenceId: String(body.expenseReferenceId || '').trim(),
        recurrenceName: String(body.recurrenceName || '').trim(),
        expenseReportName: String(body.expenseReportName || '').trim(),
        isReimbursable: toBool(body.isReimbursable, false),
        categories: Array.isArray(body.categories) ? body.categories.filter(Boolean) : [],
        status,
        source: String(body.source || 'manual') === 'import_csv' ? 'import_csv' : 'manual',
    };
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.vendor || req.query.vendorName) {
        const conditions = [];
        if (req.query.vendor) conditions.push({ vendor: req.query.vendor });
        if (req.query.vendorName) {
            conditions.push({ vendorName: new RegExp(`^${escRegex(String(req.query.vendorName))}$`, 'i') });
        }
        filter.$or = conditions;
    }
    if (req.query.expenseAccount) filter.expenseAccount = String(req.query.expenseAccount);
    if (req.query.from || req.query.to) {
        filter.expenseDate = {};
        if (req.query.from) filter.expenseDate.$gte = new Date(String(req.query.from));
        if (req.query.to) filter.expenseDate.$lte = new Date(String(req.query.to));
    }
    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [
            { description: re },
            { expenseAccount: re },
            { paidThrough: re },
            { vendorName: re },
            { referenceNo: re },
            { expenseReferenceId: re },
        ];
    }

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
        Expense.find(filter).populate('vendor', 'contactName companyName email phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
        Expense.countDocuments(filter),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
});

router.get('/:id', async (req, res) => {
    const expense = await Expense.findById(req.params.id).populate('vendor', 'contactName companyName email phone');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
});

router.post('/', async (req, res) => {
    const body = normalizeBody(req.body || {});
    if (!body.expenseAccount) return res.status(400).json({ error: 'Expense account is required' });
    if (!body.total || body.total <= 0) return res.status(400).json({ error: 'Total must be greater than zero' });

    if (body.vendor) {
        const vendor = await Vendor.findById(body.vendor).select('_id contactName');
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        if (!body.vendorName) body.vendorName = vendor.contactName;
    }

    const expense = await Expense.create(body);
    res.status(201).json(await expense.populate('vendor', 'contactName companyName email phone'));
});

router.put('/:id', async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const body = normalizeBody(req.body || {});
    if (!body.expenseAccount) return res.status(400).json({ error: 'Expense account is required' });
    if (!body.total || body.total <= 0) return res.status(400).json({ error: 'Total must be greater than zero' });

    if (body.vendor) {
        const vendor = await Vendor.findById(body.vendor).select('_id contactName');
        if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
        if (!body.vendorName) body.vendorName = vendor.contactName;
    } else {
        body.vendor = undefined;
    }

    Object.assign(expense, body);
    await expense.save();
    res.json(await expense.populate('vendor', 'contactName companyName email phone'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!STATUS_VALUES.includes(status)) {
        return res.status(400).json({ error: 'Invalid expense status' });
    }

    const expense = await Expense.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate(
        'vendor',
        'contactName companyName email phone'
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
});

router.delete('/:id', async (req, res) => {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ ok: true });
});

router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
    const expense = await Expense.findById(req.params.id).populate('vendor', 'contactName companyName');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });
    if ((expense.attachments?.length || 0) + files.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 attachments per expense' });
    }

    const vendorName = expense.vendor?.companyName || expense.vendor?.contactName || expense.vendorName || 'Unknown Vendor';

    for (const file of files) {
        const stored = await uploadToVendorFolder({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
            vendorName,
        });
        expense.attachments.push({
            name: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            ...stored,
        });
    }

    await expense.save();
    res.json(await expense.populate('vendor', 'contactName companyName email phone'));
});

router.delete('/:id/attachments/:index', async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= expense.attachments.length) {
        return res.status(400).json({ error: 'Invalid attachment index' });
    }
    expense.attachments.splice(idx, 1);
    await expense.save();
    res.json(await expense.populate('vendor', 'contactName companyName email phone'));
});

router.post('/relink-vendors', async (req, res) => {
    const vendorIdByName = await buildVendorLookup();
    const unlinked = await Expense.find({ vendor: { $exists: false }, vendorName: { $ne: '' } })
        .select('_id vendorName');

    let linked = 0;
    for (const exp of unlinked) {
        const key = normalizeVendorName(exp.vendorName);
        const vendorId = vendorIdByName.get(key);
        if (vendorId) {
            await Expense.updateOne({ _id: exp._id }, { vendor: vendorId });
            linked += 1;
        }
    }

    res.json({ ok: true, linked, checked: unlinked.length });
});

router.post('/import/csv', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    const content = req.file.buffer.toString('utf8');
    const rows = parseCsv(content);
    const vendorIdByName = await buildVendorLookup();

    const mode = String(req.query.mode || 'skip'); // 'skip' | 'update'

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let vendorLinked = 0;

    for (const row of rows) {
        const mapped = mapExpense(row, vendorIdByName);
        mapped.source = 'import_csv';
        mapped.importedAt = new Date();
        mapped.raw = row;

        if (!mapped.expenseAccount || !mapped.total || mapped.total <= 0) {
            skipped += 1;
            continue;
        }

        if (mapped.vendor) vendorLinked += 1;

        try {
            if (mapped.expenseReferenceId) {
                const existing = await Expense.findOne({ expenseReferenceId: mapped.expenseReferenceId });
                if (!existing) {
                    await Expense.create(mapped);
                    created += 1;
                } else if (mode === 'update') {
                    Object.assign(existing, mapped);
                    await existing.save();
                    updated += 1;
                } else {
                    skipped += 1;
                }
            } else {
                await Expense.create(mapped);
                created += 1;
            }
        } catch {
            errors += 1;
        }
    }

    res.json({
        ok: true,
        summary: { created, updated, skipped, errors, vendorLinked, total: rows.length },
    });
});

export default router;
