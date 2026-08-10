// Removes duplicate-tenant records approved on 10 Aug 2026:
//   1. Empty shells: records that share a name/phone/email with a surviving
//      record and have ZERO contracts, documents, invoices, payments and
//      quotes. Verified at run time, not from the earlier report.
//   2. Explicit dev/test records (asdf, za, PurpleBox Storage, ...), cascaded
//      like DELETE /customers/:id (their test docs/invoices/quotes go too).
// Usage: node scripts/cleanup-duplicate-customers.mjs --dry
import { connectDb } from '../src/db.js';
import { Customer, Contract, Document, Invoice, Payment, Quote } from '../src/models/index.js';

const DRY = process.argv.includes('--dry');
await connectDb();

// ── Bucket 2: explicit test records ──────────────────────────────────────────
const TEST_IDS = [
  '6a5363fb635f933be6800b94', // asdf
  '6a536527635f933be6800baa', // asdf
  '6a3355011dbccd59d65446b5', // za
  '6a3af116b02819170d9c06f8', // za
  '6a542ac5f7a9ef44aceace48', // ali khan (dev.xulfi)
  '6a3884fb75a10bfa5d7c74f0', // PurpleBox Storage
  '6a3888d675a10bfa5d83710f', // PurpleBox Storage
  '6a335416f9cb6478e1e51783', // asdfff (contact@purplebox.ae)
  '6a5e28601ebdb10df811d0c1', // Ahmad ali khan (xulfi.dev)
  '6a74ea2ad81204105b6b5940', // Muhammad (xulfi.dev)
];

const counts = async (id) => {
  const [contracts, docs, invoices, payments, quotes] = await Promise.all([
    Contract.countDocuments({ customer: id }),
    Document.countDocuments({ customer: id }),
    Invoice.countDocuments({ customer: id }),
    Payment.countDocuments({ customer: id }),
    Quote.countDocuments({ customer: id }),
  ]);
  return { contracts, docs, invoices, payments, quotes, total: contracts + docs + invoices + payments + quotes };
};

async function cascadeDelete(customer) {
  // Mirrors deleteCustomerCascade in routes/customers.js
  const contracts = await Contract.find({ customer: customer._id });
  for (const contract of contracts) {
    await Payment.deleteMany({ contract: contract._id });
    await Document.deleteMany({ contract: contract._id });
    await Invoice.deleteMany({ orderNumber: contract.contractNo });
    await contract.deleteOne();
  }
  await Invoice.deleteMany({ customer: customer._id });
  await Document.deleteMany({ customer: customer._id });
  await Quote.deleteMany({ customer: customer._id });
  await Customer.findByIdAndDelete(customer._id);
}

console.log('── Test records ──');
for (const id of TEST_IDS) {
  const c = await Customer.findById(id).lean();
  if (!c) { console.log(`  ${id}  already gone`); continue; }
  const n = await counts(id);
  console.log(`  DELETE ${id}  ${c.fullName} · ${c.email || 'no email'} · attachments: ${JSON.stringify(n)}`);
  if (!DRY) await cascadeDelete(c);
}

// ── Bucket 1: empty shells inside duplicate groups ───────────────────────────
const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^00971/, '').replace(/^971/, '').replace(/^0/, '');
const customers = await Customer.find({}).lean();
const alive = customers.filter((c) => !TEST_IDS.includes(String(c._id)));

const keysOf = (c) => {
  const keys = [];
  const name = (c.fullName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name && name.length > 2) keys.push(`n:${name}`);
  const d = digits((c.phones && c.phones[0]) || c.phone);
  if (d.length >= 7) keys.push(`p:${d}`);
  const e = (c.email || '').trim().toLowerCase();
  if (e && e.includes('@')) keys.push(`e:${e}`);
  return keys;
};

const byKey = new Map();
for (const c of alive) for (const k of keysOf(c)) {
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(c);
}

console.log('\n── Empty shells in duplicate groups ──');
const deleted = new Set();
let shells = 0;
for (const [key, group] of byKey) {
  if (group.length < 2) continue;
  const withCounts = [];
  for (const c of group) {
    if (deleted.has(String(c._id))) continue;
    withCounts.push({ c, n: await counts(c._id) });
  }
  if (withCounts.length < 2) continue;
  // Keep the record with the most attachments (ties: keep the one with an
  // email, then the oldest). Delete only zero-attachment shells beyond it.
  withCounts.sort((a, b) => b.n.total - a.n.total
    || (b.c.email ? 1 : 0) - (a.c.email ? 1 : 0)
    || new Date(a.c.createdAt) - new Date(b.c.createdAt));
  const keeper = withCounts[0];
  for (const { c, n } of withCounts.slice(1)) {
    if (n.total > 0) continue; // has data — needs a real merge, skip
    shells++;
    deleted.add(String(c._id));
    console.log(`  [${key}]`);
    console.log(`    keep   ${keeper.c._id}  ${keeper.c.fullName} (${keeper.n.total} attachments)`);
    console.log(`    DELETE ${c._id}  ${c.fullName} · ${c.email || 'no email'} (0 attachments)`);
    if (!DRY) await Customer.findByIdAndDelete(c._id);
  }
}

console.log(`\n${DRY ? '[DRY] would delete' : 'Deleted'} ${TEST_IDS.length} test records and ${shells} empty shells`);
process.exit(0);
