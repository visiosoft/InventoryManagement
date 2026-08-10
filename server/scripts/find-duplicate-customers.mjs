// Reports likely duplicate tenants: grouped by name, by phone digits and by
// email, with what hangs off each record so a merge target is obvious.
// Read-only. Usage: node scripts/find-duplicate-customers.mjs
import { connectDb } from '../src/db.js';
import { Customer, Contract, Document, Invoice, Payment } from '../src/models/index.js';

await connectDb();

const customers = await Customer.find({}).lean();
const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^00971/, '').replace(/^971/, '').replace(/^0/, '');

// Attachment counts per customer
const [byContract, byDoc, byInvoice, byPayment] = await Promise.all([
  Contract.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }]),
  Document.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }]),
  Invoice.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }]),
  Payment.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }]),
]);
const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
const contracts = toMap(byContract); const docs = toMap(byDoc);
const invoices = toMap(byInvoice); const payments = toMap(byPayment);

const describe = (c) => {
  const id = String(c._id);
  const bits = [
    `contracts:${contracts.get(id) || 0}`,
    `docs:${docs.get(id) || 0}`,
    `invoices:${invoices.get(id) || 0}`,
    `payments:${payments.get(id) || 0}`,
  ].join(' ');
  const phone = (c.phones && c.phones[0]) || c.phone || '—';
  return `    ${id}  ${c.fullName} · ${phone} · ${c.email || 'no email'} · [${bits}]`;
};

function report(title, keyFn) {
  const groups = new Map();
  for (const c of customers) {
    const key = keyFn(c);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const dupes = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`\n══ ${title}: ${dupes.length} group(s) ══`);
  for (const [key, arr] of dupes.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${key}" × ${arr.length}`);
    for (const c of arr) console.log(describe(c));
  }
  return new Set(dupes.flatMap(([, arr]) => arr.map((c) => String(c._id))));
}

const n1 = report('Same name', (c) => (c.fullName || '').trim().toLowerCase().replace(/\s+/g, ' ') || null);
const n2 = report('Same phone', (c) => { const d = digits((c.phones && c.phones[0]) || c.phone); return d.length >= 7 ? d : null; });
const n3 = report('Same email', (c) => (c.email || '').trim().toLowerCase() || null);

const all = new Set([...n1, ...n2, ...n3]);
console.log(`\nTotal customers: ${customers.length} · records involved in some duplicate group: ${all.size}`);
console.log('Merge with: POST /customers/<duplicateId>/merge-into/<keepId> (moves invoices, then deletes the duplicate)');
process.exit(0);
