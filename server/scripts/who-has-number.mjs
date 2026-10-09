// Read-only: lists every customer record carrying a phone number, and their contracts.
// Run from InventoryManagementSystem/server:  node scripts/who-has-number.mjs 0501402556 [PB-2026-0424]
import 'dotenv/config';
import mongoose from 'mongoose';

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9);
const want = digits(process.argv[2]);
if (want.length < 9) { console.error('Usage: node who-has-number.mjs 0501402556'); process.exit(1); }

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const db = mongoose.connection.db;
console.log(`DB: ${process.env.DB_NAME}\n`);

const re = new RegExp(`${want.split('').join('\\D*')}\\D*$`);
const customers = await db.collection('customers').find({ $or: [{ phone: re }, { phones: re }] }).toArray();
for (const c of customers) {
  const contracts = await db.collection('contracts').find({ customer: c._id }).project({ contractNo: 1, status: 1 }).toArray();
  console.log({
    id: String(c._id), fullName: c.fullName, phone: c.phone, phones: c.phones, email: c.email,
    stage: c.stage, deletedAt: c.deletedAt ?? null, createdAt: c.createdAt,
    contracts: contracts.map((k) => `${k.contractNo} (${k.status})`),
  });
}
if (!customers.length) console.log('No customer has this number in this database.');

// Optional: a contract number, to see how it points at its customer.
if (process.argv[3]) {
  const k = await db.collection('contracts').findOne({ contractNo: process.argv[3] });
  console.log(`\nContract ${process.argv[3]}:`, k ? {
    status: k.status, deletedAt: k.deletedAt ?? null,
    customer: k.customer, customerType: k.customer?.constructor?.name,
    pointsAtAbove: customers.some((c) => String(c._id) === String(k.customer)),
  } : 'not found in this database');
}
await mongoose.disconnect();
