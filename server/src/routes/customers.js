import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Customer, Contract, Document, Payment, Invoice, Unit, Quote } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { phoneClauses } from '../utils/phoneSearch.js';
import { mailConfigured, mailFromAddress, sendMail } from '../services/mail.js';

const router = Router();

async function syncUnitStatus(unitId) {
  if (!unitId) return;
  const unit = await Unit.findById(unitId);
  if (!unit) return;
  const active = await Contract.findOne({ $or: [{ unit: unitId }, { units: unitId }], status: 'active' });
  unit.status = active ? 'rented' : 'available';
  await unit.save();
}

async function deleteCustomerCascade(customerId) {
  const contracts = await Contract.find({ customer: customerId });
  for (const contract of contracts) {
    const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
    await Payment.deleteMany({ contract: contract._id });
    await Document.deleteMany({ contract: contract._id });
    await Invoice.deleteMany({ orderNumber: contract.contractNo });
    await contract.deleteOne();
    await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
  }
  await Invoice.deleteMany({ customer: customerId });
  await Document.deleteMany({ customer: customerId });
  await Quote.deleteMany({ customer: customerId });
  await Customer.findByIdAndDelete(customerId);
}

function escRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.search) {
    const re = new RegExp(escRegex(req.query.search), 'i');
    filter.$or = [
      { fullName: re },
      { clientId: re },
      { email: re },
      { phone: re },
      { phones: re },
      { emergencyNumber: re },
      { nationality: re },
      { address: re },
      { company: re },
      { emiratesId: re },
      { passportNumber: re },
      { notes: re },
      { tenantType: re },
      // Digits-only match so a local number finds an international one
      ...phoneClauses(req.query.search),
    ];
  }

  const sortKey = String(req.query.sort || 'date_added_desc');
  let sort = { createdAt: -1, _id: -1 };
  if (sortKey === 'name_asc') sort = { fullName: 1, _id: -1 };
  else if (sortKey === 'name_desc') sort = { fullName: -1, _id: -1 };
  else if (sortKey === 'date_added_asc') sort = { createdAt: 1, _id: 1 };

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 9999);
  const skip  = (page - 1) * limit;

  // .lean() skips Mongoose document hydration, which dominates this endpoint:
  // 274 customers took ~2.5s hydrated vs ~950ms lean. The response is read-only.
  const [customers, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);
  res.json({ data: customers, total, page, pages: Math.ceil(total / limit), limit });
});

router.get('/:id', async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const contracts = await Contract.find({ customer: customer._id })
    .populate('unit')
    .sort({ createdAt: -1 });
  const documents = await Document.find({ customer: customer._id }).sort({ createdAt: -1 });

  // All invoices across every contract this customer has ever had
  const contractNos = contracts.map(c => c.contractNo);
  const invoices = await Invoice.find({ orderNumber: { $in: contractNos } })
    .select('invoiceNo orderNumber status dueDate invoiceDate total paymentMade')
    .sort({ dueDate: -1 });

  // Payment summary per contract
  const contractIds = contracts.map(c => c._id);
  const allPayments = await Payment.find({ contract: { $in: contractIds } })
    .select('contract amount status paidDate method notes dueDate')
    .sort({ dueDate: -1 });

  const paymentSummary = contracts.map(c => {
    const cPayments = allPayments.filter(p => String(p.contract) === String(c._id));
    const totalPaid   = Math.round(cPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const totalUnpaid = Math.round(cPayments.filter(p => p.status !== 'paid').reduce((s, p) => s + p.amount, 0) * 100) / 100;
    return { contractId: c._id, contractNo: c.contractNo, totalPaid, totalUnpaid };
  });

  res.json({ customer, contracts, documents, invoices, paymentSummary });
});

router.post('/', async (req, res) => {
  const customer = await Customer.create(req.body);
  res.status(201).json(customer);
});

router.put('/:id', async (req, res) => {
  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  await deleteCustomerCascade(req.params.id);
  res.json({ ok: true });
});

// Merge sourceId into targetId: move all invoices, then delete source
router.post('/:id/merge-into/:targetId', async (req, res) => {
  const { id, targetId } = req.params;
  if (id === targetId) return res.status(400).json({ error: 'Cannot merge a customer into itself' });
  const [source, target] = await Promise.all([
    Customer.findById(id),
    Customer.findById(targetId),
  ]);
  if (!source) return res.status(404).json({ error: 'Source customer not found' });
  if (!target) return res.status(404).json({ error: 'Target customer not found' });

  const result = await Invoice.updateMany({ customer: id }, { $set: { customer: targetId } });
  await Customer.findByIdAndDelete(id);
  res.json({ ok: true, invoicesMoved: result.modifiedCount, deletedCustomer: source.fullName, intoCustomer: target.fullName });
});

// Gmail rejects messages with too many recipients on one send; keep each
// batch comfortably under the ~100 cap.
const BCC_BATCH_SIZE = 90;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// One email to many customers, everyone in BCC so recipients can't see each
// other. Batched, and honest about partial failure — a later batch can fail
// after earlier ones already went out.
router.post('/send-email', requireAdmin, async (req, res) => {
  if (!mailConfigured()) return res.status(501).json({ error: 'Email is not configured — connect Gmail in Settings' });

  const ids = Array.isArray(req.body?.customerIds) ? req.body.customerIds.filter((id) => isValidObjectId(id)) : [];
  const subject = String(req.body?.subject || '').trim();
  const html = String(req.body?.html || '').trim();
  if (!ids.length) return res.status(400).json({ error: 'No recipients selected' });
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!html || !html.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'Email body is required' });

  // The server decides who is actually mailable, not the client.
  const recipients = await Customer.find({ _id: { $in: ids }, email: { $nin: ['', null] } })
    .select('email fullName')
    .lean();
  if (!recipients.length) return res.status(400).json({ error: 'None of the selected customers have an email address' });

  const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').trim();
  const from = mailFromAddress();
  const sentBy = req.user?.name || req.user?.email || 'user';

  const okIds = [];
  let failed = 0;
  let firstError = '';

  for (const batch of chunk(recipients, BCC_BATCH_SIZE)) {
    try {
      // `To` is the sender: a message with an empty To and only BCC is widely
      // treated as spam.
      await sendMail({ to: from, bcc: batch.map((c) => c.email).join(', '), subject, text, html });
      okIds.push(...batch.map((c) => c._id));
    } catch (err) {
      failed += batch.length;
      if (!firstError) firstError = err.message || 'Send failed';
    }
  }

  if (okIds.length) {
    const at = new Date();
    await Customer.updateMany(
      { _id: { $in: okIds } },
      { $push: { emailLog: { subject, at, sentBy } } },
    );
    // Also log on the tenant's live contracts so it shows up in the contract's
    // Activity feed, which reads straight off contract.timeline. Active only —
    // an ended contract shouldn't collect new correspondence.
    await Contract.updateMany(
      { customer: { $in: okIds }, status: 'active' },
      { $push: { timeline: { at, text: `Email "${subject}" sent`, author: sentBy } } },
    );
  }

  if (!okIds.length) return res.status(500).json({ error: firstError || 'Failed to send email' });
  res.json({ sent: okIds.length, failed, total: recipients.length, ...(firstError ? { error: firstError } : {}) });
});

router.post('/bulk-delete', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
  for (const id of ids) {
    await deleteCustomerCascade(id);
  }
  res.json({ ok: true, deleted: ids.length, skipped: 0 });
});

export default router;
