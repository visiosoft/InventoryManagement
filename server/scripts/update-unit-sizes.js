// Migration: sync units, customers (tenants), and contracts from purplebox backup JSON
// Usage: node scripts/update-unit-sizes.js [path-to-json]
import 'dotenv/config';
import { readFileSync } from 'fs';
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { Customer, Contract, Unit, nextContractNo } from '../src/models/index.js';

const JSON_PATH = process.argv[2] || 'C:/Users/LENOVO/Downloads/purplebox-backup-2026-06-16-203721.json';

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

// ── UNITS ─────────────────────────────────────────────────────────────────────
async function syncUnits(units) {
  console.log('\n── Units ──────────────────────────────────────');
  let updated = 0, inserted = 0, skipped = 0;

  for (const u of units) {
    const sizeSqf = parseFloat(u.size_category);
    if (!Number.isFinite(sizeSqf) || sizeSqf <= 0) { skipped++; continue; }

    const price  = parseFloat(u.price) || 0;
    const status = u.manual_status === 'rented' ? 'occupied' : 'available';

    const result = await Unit.updateOne(
      { unitNumber: u.unit_number },
      {
        $set: { sizeSqf },
        $setOnInsert: { unitNumber: u.unit_number, floor: u.floor ?? '', price, status, notes: u.notes ?? '' },
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      console.log(`  Inserted ${u.unit_number} — ${sizeSqf} sqft AED ${price} [${status}]`);
      inserted++;
    } else if (result.modifiedCount > 0) {
      console.log(`  Updated  ${u.unit_number} → ${sizeSqf} sqft`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`  Done — inserted: ${inserted}, updated: ${updated}, unchanged: ${skipped}`);
}

// ── TENANTS → CUSTOMERS ───────────────────────────────────────────────────────
async function syncTenants(tenants) {
  console.log('\n── Customers (tenants) ────────────────────────');
  const customerByTenantId = new Map();
  let created = 0, found = 0;

  for (const t of tenants) {
    const phones  = JSON.parse(t.phones  || '[]');
    const phone   = (phones[0] || '').trim();
    const phoneN  = normalizePhone(phone);
    const email   = (t.email || '').trim().toLowerCase();

    // Try to find by phone or email
    const query = [];
    if (phoneN) query.push({ phone: { $regex: phoneN.slice(-9) } });
    if (email)  query.push({ email });
    const existing = query.length
      ? await Customer.findOne({ $or: query }).select('_id')
      : null;

    const accessPersons = JSON.parse(t.access_persons || '[]').map(p => ({
      name:     p.name     || '',
      phone:    p.phone    || '',
      relation: p.relation || '',
      idType:   p.id_type  || '',
      idNumber: p.id_number|| '',
    }));

    const allPhones = JSON.parse(t.phones || '[]').map(p => p.trim()).filter(Boolean);

    const customerFields = {
      fullName:       t.full_name,
      clientId:       t.client_id       || '',
      tenantType:     t.tenant_type     === 'company' ? 'company' : 'individual',
      phone,
      phones:         allPhones,
      email,
      nationality:    t.nationality     || '',
      address:        t.address         || '',
      emiratesId:     t.emirates_id     || '',
      eidExpiry:      t.eid_expiry      ? new Date(t.eid_expiry)      : undefined,
      passportNumber: t.passport_number || '',
      passportExpiry: t.passport_expiry ? new Date(t.passport_expiry) : undefined,
      accessPersons,
    };

    if (existing) {
      await Customer.updateOne({ _id: existing._id }, { $set: customerFields });
      customerByTenantId.set(t.id, existing._id);
      found++;
    } else {
      const customer = await Customer.create(customerFields);
      customerByTenantId.set(t.id, customer._id);
      console.log(`  Created  ${t.full_name} (${phone})`);
      created++;
    }
  }

  console.log(`  Done — created: ${created}, matched existing: ${found}`);
  return customerByTenantId;
}

// ── CONTRACTS ─────────────────────────────────────────────────────────────────
async function syncContracts(contracts, backupUnits, customerByTenantId, backup) {
  console.log('\n── Contracts ──────────────────────────────────');

  // Build backup unit-id → MongoDB unit map
  const unitByBackupId = new Map();
  for (const u of backupUnits) {
    const dbUnit = await Unit.findOne({ unitNumber: u.unit_number }).select('_id');
    if (dbUnit) unitByBackupId.set(String(u.id), { dbId: dbUnit._id, price: parseFloat(u.price) || 0 });
  }

  // Build backup unit-id → price map (for rate)
  const backupUnitPriceMap = new Map(backupUnits.map(u => [String(u.id), parseFloat(u.price) || 0]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const c of contracts) {
    const externalId = `pb-contract-${c.id}`;

    const unitIds = JSON.parse(c.unit_ids || '[]');
    const primaryId = String(unitIds[0]);
    const backupUnit = unitByBackupId.get(primaryId);

    if (!backupUnit) {
      console.log(`  SKIP contract ${c.id} — unit backup id ${primaryId} not found in DB`);
      skipped++;
      continue;
    }

    const customerId = customerByTenantId.get(String(c.tenant_id));
    if (!customerId) {
      console.log(`  SKIP contract ${c.id} — tenant ${c.tenant_id} has no customer`);
      skipped++;
      continue;
    }

    const billingPeriod = c.duration_weeks ? 'weekly' : 'monthly';
    const rate          = backupUnit.price;

    // Map backup status to our enum
    const statusMap = { active: 'active', ended: 'ended', cancelled: 'cancelled' };
    const status = statusMap[c.status] || 'active';

    // Pull authorized persons from the tenant record
    const tenant = backup.tenants.find(t => String(t.id) === String(c.tenant_id));
    const authorizedPersons = JSON.parse(tenant?.access_persons || '[]').map(p => ({
      name:     p.name      || '',
      phone:    p.phone     || '',
      relation: p.relation  || '',
      idType:   p.id_type   || '',
      idNumber: p.id_number || '',
    }));

    const fields = {
      customer:           customerId,
      unit:               backupUnit.dbId,
      billingPeriod,
      rate,
      deposit:            0,
      startDate:          new Date(c.move_in_date),
      endDate:            new Date(c.move_out_date),
      autoRenew:          c.auto_renew === '1',
      status,
      paymentMethod:      c.payment_method || '',
      firstPaymentDate:   c.first_payment_date ? new Date(c.first_payment_date) : undefined,
      nextPaymentDate:    c.next_payment_date  ? new Date(c.next_payment_date)  : undefined,
      signedDocUrl:       c.signed_pdf_path    || '',
      notes:              c.notes || '',
      authorizedPersons,
      source:             'import_json',
      externalId,
      importedAt:         new Date(),
    };

    const existing = await Contract.findOne({ externalId }).select('_id status');

    if (existing) {
      await Contract.updateOne({ _id: existing._id }, { $set: {
        status,
        autoRenew:        c.auto_renew === '1',
        rate,
        endDate:          new Date(c.move_out_date),
        paymentMethod:    c.payment_method || '',
        firstPaymentDate: c.first_payment_date ? new Date(c.first_payment_date) : undefined,
        nextPaymentDate:  c.next_payment_date  ? new Date(c.next_payment_date)  : undefined,
        signedDocUrl:     c.signed_pdf_path    || '',
      } });
      console.log(`  Updated  contract ${c.id} (unit ${primaryId} → ${status})`);
      updated++;
    } else {
      const contractNo = await nextContractNo();
      await Contract.create({ contractNo, ...fields });
      console.log(`  Inserted ${contractNo} — contract ${c.id} (${c.move_in_date} → ${c.move_out_date}, ${billingPeriod}, AED ${rate})`);
      inserted++;
    }
  }

  console.log(`  Done — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function run() {
  await connectDb();
  console.log('Connected to MongoDB');

  const backup = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

  await syncUnits(backup.units ?? []);
  const customerByTenantId = await syncTenants(backup.tenants ?? []);
  await syncContracts(backup.contracts ?? [], backup.units ?? [], customerByTenantId, backup);

  console.log('\nAll done.');
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
