import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { connectDb } from './db.js';
import { Expense, Vendor } from './models/index.js';
import { parseCsv } from './services/csv.js';

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

    const mapped = {
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
        status: 'recorded',
        source: 'import_csv',
        importedAt: new Date(),
        raw: record,
    };

    if (normalizedVendorName && vendorIdByName.has(normalizedVendorName)) {
        mapped.vendor = vendorIdByName.get(normalizedVendorName);
    }

    return mapped;
}

async function run() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: node src/importExpenses.js <csv-file-path>');
        process.exit(1);
    }

    const csvPath = path.resolve(input);
    if (!fs.existsSync(csvPath)) {
        console.error(`CSV file not found: ${csvPath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(content);

    await connectDb();

    const vendorIdByName = await buildVendorLookup();

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let vendorLinked = 0;

    for (const row of rows) {
        const mapped = mapExpense(row, vendorIdByName);

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
                } else {
                    Object.assign(existing, mapped);
                    await existing.save();
                    updated += 1;
                }
            } else {
                await Expense.create(mapped);
                created += 1;
            }
        } catch {
            errors += 1;
        }
    }

    console.log(
        `Expense import finished: created=${created}, updated=${updated}, skipped=${skipped}, errors=${errors}, vendorLinked=${vendorLinked}, total=${rows.length}`
    );
    process.exit(0);
}

run().catch((err) => {
    console.error('Expense import failed:', err.message);
    process.exit(1);
});
