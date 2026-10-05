/**
 * Run the API against a local, throwaway MongoDB seeded with one demo tenant —
 * for trying the customer mobile app without touching Atlas.
 *
 *   node scripts/demo-server.mjs
 *
 * Data lives in server/.demo-db and survives restarts; delete that folder to reset.
 * Not production: NODE_ENV stays 'development', so login codes come back in the
 * request-otp response and the app fills them in itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.demo-db');
fs.mkdirSync(dbPath, { recursive: true });

const mongod = await MongoMemoryServer.create({
  binary: { version: '7.0.14' },
  instance: { dbPath, storageEngine: 'wiredTiger', port: 27099 },
});
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_NAME = 'PurpleBoxLocalDemo';
process.env.NODE_ENV = 'development';
// The server loads .env, which holds live credentials. Defining a variable here
// stops dotenv overriding it, so signed agreements from a demo go to a local
// folder rather than the company Google Drive.
for (const k of ['GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_FILE']) process.env[k] = '';
process.env.LOCAL_UPLOADS_ONLY = '1';

const DEMO_PHONE = '+971500000001';
const DAY = 86_400_000;

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { Contract, Customer, Invoice, Payment, Unit } = await import('../src/models/index.js');

if (!(await Customer.exists({ phone: DEMO_PHONE }))) {
  const customer = await Customer.create({
    fullName: 'Layla Haddad', phone: DEMO_PHONE, phones: [DEMO_PHONE], email: 'layla@example.com', stage: 'customer',
  });
  const unit = await Unit.create({ unitNumber: 'L-114', sizeSqf: 100, floor: 'Warehouse 12', price: 1305, status: 'occupied' });
  const start = new Date(Date.now() - 75 * DAY);
  const contract = await Contract.create({
    contractNo: 'DEMO-1001', customer: customer._id, unit: unit._id, units: [unit._id],
    billingPeriod: 'monthly', rate: 1305, deposit: 500, startDate: start, endDate: new Date(Date.now() + 290 * DAY),
    status: 'active', signedDocUrl: 'demo',
  });
  const mk = (n, dueIn, total, paid, status) => Invoice.create({
    invoiceNo: `INV-DEMO-${n}`, customer: customer._id, invoiceDate: new Date(Date.now() - 20 * DAY),
    dueDate: new Date(Date.now() + dueIn * DAY), subject: `Storage rent · DEMO-1001`, total, subTotal: total, paymentMade: paid, status,
    items: [{ sortOrder: 0, itemDetails: 'Storage rent — Unit L-114', quantity: 1, rate: total, discountPct: 0, amount: total }],
  });
  await mk(1, 5, 1305, 0, 'sent');
  await mk(2, -10, 1305, 500, 'partial');
  const paidInv = await mk(3, -40, 1305, 1305, 'paid');
  for (const ago of [70, 42]) {
    await Payment.create({ contract: contract._id, invoice: paidInv._id, amount: 1305, dueDate: new Date(Date.now() - ago * DAY), paidDate: new Date(Date.now() - ago * DAY), status: 'paid', method: 'card' });
  }
  console.log(`Seeded demo tenant ${DEMO_PHONE} (agreement DEMO-1001)`);
}
// Units a new customer can book in the app (sizes and prices as in routes/unitTypes.js).
if (!(await Unit.exists({ status: 'available' }))) {
  const stock = [[25, 625, 3], [50, 950, 3], [100, 1600, 2]];
  await Unit.insertMany(stock.flatMap(([sizeSqf, price, n]) =>
    Array.from({ length: n }, (_, i) => ({ unitNumber: `D-${sizeSqf}-${i + 1}`, sizeSqf, price, discountPct: 20, floor: 'Warehouse 12', status: 'available' }))));
  console.log('Seeded bookable demo units');
}
await mongoose.disconnect();

await import('../src/index.js');
