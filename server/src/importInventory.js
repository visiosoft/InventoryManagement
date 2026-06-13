import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { Unit, UnitType, Contract, Payment, Document } from './models/index.js';

// Imports the real facility inventory from data/inventory.json (exported from
// the "Purplebox Inventory" spreadsheet). Replaces ALL existing units and the
// contracts/payments/documents that reference them, so run this only to reset
// inventory to the spreadsheet state.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../data/inventory.json');

async function run() {
  const units = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  await connectDb();
  console.log(`Connected. Importing ${units.length} units…`);

  const [c, p, d, u, t] = await Promise.all([
    Contract.deleteMany({}),
    Payment.deleteMany({}),
    Document.deleteMany({}),
    Unit.deleteMany({}),
    UnitType.deleteMany({}),
  ]);
  console.log(
    `Cleared: ${u.deletedCount} units, ${t.deletedCount} unit types, ` +
      `${c.deletedCount} contracts, ${p.deletedCount} payments, ${d.deletedCount} documents`
  );

  await Unit.insertMany(units);

  const byStatus = {};
  for (const unit of units) byStatus[unit.status] = (byStatus[unit.status] || 0) + 1;
  console.log(`Imported ${units.length} units:`, JSON.stringify(byStatus));
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
