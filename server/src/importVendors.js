import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { connectDb } from './db.js';
import { Vendor } from './models/index.js';
import { parseCsv } from './services/csv.js';

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

async function run() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: node src/importVendors.js <csv-file-path>');
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

    console.log(`Vendor import finished: created=${created}, updated=${updated}, skipped=${skipped}, errors=${errors}, total=${rows.length}`);
    process.exit(0);
}

run().catch((err) => {
    console.error('Vendor import failed:', err.message);
    process.exit(1);
});
