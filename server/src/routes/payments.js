import { Router } from 'express';
import { Payment, Contract, Customer, Unit, Invoice, nextInvoiceNo } from '../models/index.js';
import { renderReceiptPdf } from '../services/receiptPdf.js';
import { sendWhatsAppText, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';

const router = Router();

const populateAll = (q) =>
  q.populate({ path: 'contract', populate: [{ path: 'customer' }, { path: 'unit' }] });

async function refreshOverdue() {
  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: new Date() } },
    { $set: { status: 'overdue' } }
  );
}

// Summary totals for the dashboard cards
router.get('/summary', async (_req, res) => {
  await refreshOverdue();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [overdueList, pendingList, paidThisMonth, dueThisMonth] = await Promise.all([
    Payment.find({ status: 'overdue' }).select('amount'),
    Payment.find({ status: 'pending' }).select('amount'),
    Payment.find({ status: 'paid', paidDate: { $gte: monthStart, $lte: monthEnd } }).select('amount'),
    Payment.find({ status: { $in: ['pending', 'overdue'] }, dueDate: { $gte: monthStart, $lte: monthEnd } }).select('amount'),
  ]);

  const sum = (arr) => arr.reduce((s, p) => s + p.amount, 0);
  res.json({
    overdue: { count: overdueList.length, total: sum(overdueList) },
    pending: { count: pendingList.length, total: sum(pendingList) },
    paidThisMonth: { count: paidThisMonth.length, total: sum(paidThisMonth) },
    dueThisMonth: { count: dueThisMonth.length, total: sum(dueThisMonth) },
  });
});

router.get('/', async (req, res) => {
  await refreshOverdue();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.contract) filter.contract = req.query.contract;
  if (req.query.from || req.query.to) {
    filter.dueDate = {};
    if (req.query.from) filter.dueDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.dueDate.$lte = new Date(req.query.to + 'T23:59:59');
  }

  // Search by customer name, unit number, or contract number
  if (req.query.search) {
    const re = new RegExp(req.query.search.trim(), 'i');
    const [units, customers] = await Promise.all([
      Unit.find({ unitNumber: re }).select('_id'),
      Customer.find({ fullName: re }).select('_id'),
    ]);
    const contractFilter = { $or: [] };
    if (units.length) contractFilter.$or.push({ unit: { $in: units.map((u) => u._id) } });
    if (customers.length) contractFilter.$or.push({ customer: { $in: customers.map((c) => c._id) } });
    // Also search by contractNo directly
    contractFilter.$or.push({ contractNo: re });
    const contracts = await Contract.find(contractFilter).select('_id');
    if (contracts.length === 0) return res.json([]);
    filter.contract = { $in: contracts.map((c) => c._id) };
  }

  const payments = await populateAll(Payment.find(filter)).sort({ dueDate: 1 });
  res.json(payments);
});

// Partial payment against a single invoice:
// Replaces all unpaid records with: one paid record (partial) + one pending record (remainder).
router.post('/invoice-partial', async (req, res) => {
  const { invoiceId, contractId, amount, method, paidDate, notes } = req.body;
  if (!invoiceId || !contractId || !amount)
    return res.status(400).json({ error: 'invoiceId, contractId, amount are required' });

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const partialAmt = Math.round(Number(amount) * 100) / 100;
  const remaining  = Math.round((invoice.total - partialAmt) * 100) / 100;
  if (partialAmt <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });

  const existing = await Payment.find({ contract: contractId, invoice: invoiceId, status: { $ne: 'paid' } });
  const dueDate = existing[0]?.dueDate || invoice.dueDate;
  const unitNote = existing.find(p => p.notes)?.notes || '';
  const unitMatch = unitNote.match(/Unit (.+)$/);
  const unitNo = unitMatch ? unitMatch[1] : '-';

  await Payment.deleteMany({ contract: contractId, invoice: invoiceId, status: { $ne: 'paid' } });

  const actor = req.user?.name || req.user?.email || '';
  await Payment.create({
    contract: contractId, invoice: invoiceId,
    amount: partialAmt, dueDate,
    status: 'paid', method: method || 'cash',
    paidDate: paidDate ? new Date(paidDate) : new Date(),
    notes: notes || `Partial payment · Unit ${unitNo}`,
    recordedBy: actor,
  });

  if (remaining > 0.01) {
    await Payment.create({
      contract: contractId, invoice: invoiceId,
      amount: remaining, dueDate,
      status: new Date(dueDate) < new Date() ? 'overdue' : 'pending',
      notes: `Remaining balance · Unit ${unitNo}`,
    });
  }

  const newStatus = remaining > 0.01 ? 'partial' : 'paid';
  await Invoice.findByIdAndUpdate(invoiceId, { status: newStatus, paymentMade: partialAmt });

  res.json({ ok: true, paid: partialAmt, remaining });
});

// Record multiple payments at once (bulk pay)
router.post('/bulk-record', async (req, res) => {
  const { paymentIds, method, paidDate, notes } = req.body;
  if (!Array.isArray(paymentIds) || paymentIds.length === 0)
    return res.status(400).json({ error: 'paymentIds array is required' });
  const date = paidDate ? new Date(paidDate) : new Date();
  const actor = req.user?.name || req.user?.email || '';
  const result = await Payment.updateMany(
    { _id: { $in: paymentIds }, status: { $ne: 'paid' } },
    { $set: { status: 'paid', method: method || 'cash', paidDate: date, recordedBy: actor, ...(notes ? { notes } : {}) } }
  );
  res.json({ ok: true, updated: result.modifiedCount });
});

// Manually add a payment to a contract
router.post('/', async (req, res) => {
  const { contract, amount, dueDate, notes } = req.body;
  if (!contract || !amount || !dueDate)
    return res.status(400).json({ error: 'contract, amount and dueDate are required' });
  const contractDoc = await Contract.findById(contract);
  if (!contractDoc) return res.status(404).json({ error: 'Contract not found' });
  const payment = await Payment.create({
    contract,
    amount: Number(amount),
    dueDate: new Date(dueDate),
    status: new Date(dueDate) < new Date() ? 'overdue' : 'pending',
    notes: notes || '',
  });
  res.status(201).json(await populateAll(Payment.findById(payment._id)));
});

router.post('/:id/record', async (req, res) => {
  const { method, paidDate, notes } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'paid') return res.status(409).json({ error: 'Payment is already recorded as paid' });
  payment.status = 'paid';
  payment.method = method || 'cash';
  payment.paidDate = paidDate ? new Date(paidDate) : new Date();
  payment.recordedBy = req.user?.name || req.user?.email || '';
  if (notes) payment.notes = notes;
  await payment.save();
  res.json(await populateAll(Payment.findById(payment._id)));
});

router.post('/:id/unrecord', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  payment.status = new Date(payment.dueDate) < new Date() ? 'overdue' : 'pending';
  payment.paidDate = undefined;
  payment.method = '';
  await payment.save();
  res.json(await populateAll(Payment.findById(payment._id)));
});

router.post('/:id/whatsapp-reminder', async (req, res) => {
  await refreshOverdue();
  const payment = await populateAll(Payment.findById(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (!['pending', 'overdue'].includes(payment.status)) {
    return res.status(409).json({ error: 'Only pending or overdue payments can be reminded' });
  }
  if (!whatsappSendConfigured()) {
    return res.status(400).json({
      error: 'WhatsApp send is not configured in server environment',
      missing: whatsappSendMissing(),
    });
  }

  const customer = payment.contract?.customer;
  const unit = payment.contract?.unit;
  const customerPhone = customer?.phones?.find(Boolean) || customer?.phone || '';
  if (!customerPhone) {
    return res.status(400).json({ error: 'Customer has no phone number' });
  }

  const dueLabel = new Date(payment.dueDate).toLocaleDateString('en-GB');
  const amountLabel = Number(payment.amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const message = [
    `Hello ${customer?.fullName || 'Customer'},`,
    '',
    `This is a friendly reminder for your ${payment.status} storage payment.`,
    `Contract: ${payment.contract?.contractNo || '-'}`,
    `Unit: ${unit?.unitNumber || '-'}`,
    `Amount due: AED ${amountLabel}`,
    `Due date: ${dueLabel}`,
    '',
    'Please contact us once payment is completed. Thank you.',
  ].join('\n');

  try {
    const result = await sendWhatsAppText({ to: customerPhone, body: message });
    res.json({ ok: true, to: customerPhone, result });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to send WhatsApp reminder' });
  }
});

router.post('/:id/generate-invoice', async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate({ path: 'contract', populate: [{ path: 'customer' }, { path: 'unit' }] });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (payment.invoice) {
    const existing = await Invoice.findById(payment.invoice).populate('customer', 'fullName email phone address');
    if (existing) return res.json(existing);
  }

  const contract = payment.contract;
  if (!contract?.customer?._id) {
    return res.status(400).json({ error: 'Payment is missing contract/customer details' });
  }

  const dueDate = new Date(payment.dueDate);
  const invoiceDate = new Date();
  const amount = Number(payment.amount || 0);
  const itemDetails = `Storage rent - Contract ${contract.contractNo} (Unit ${contract.unit?.unitNumber || '-'})`;

  const invoice = await Invoice.create({
    invoiceNo: await nextInvoiceNo(),
    customer: contract.customer._id,
    invoiceDate,
    dueDate,
    orderNumber: contract.contractNo,
    terms: 'Due on receipt',
    subject: `Payment schedule invoice - ${contract.contractNo}`,
    items: [{ sortOrder: 0, itemDetails, quantity: 1, rate: amount, discountPct: 0, amount }],
    customerNotes: payment.notes || '',
    subTotal: amount,
    total: amount,
    paymentMade: 0,
    status: 'sent',
  });

  payment.invoice = invoice._id;
  await payment.save();

  res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
});

// Generate one invoice per calendar month — groups all weekly payments in the same
// month into a single invoice with one line item per week.
router.post('/:id/generate-monthly-invoice', async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate({ path: 'contract', populate: [{ path: 'customer' }, { path: 'unit' }] });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const contract = payment.contract;
  if (!contract?.customer?._id) {
    return res.status(400).json({ error: 'Payment is missing contract/customer details' });
  }

  // Month window for this payment's due date
  const d = new Date(payment.dueDate);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

  // All payments for this contract in this month, sorted by due date
  const monthPayments = await Payment.find({
    contract: contract._id,
    dueDate: { $gte: monthStart, $lte: monthEnd },
  }).sort({ dueDate: 1 });

  // If any already links to an invoice, reuse it and link remaining payments
  const existingInvoiceId = monthPayments.find((p) => p.invoice)?.invoice;
  if (existingInvoiceId) {
    for (const p of monthPayments) {
      if (!p.invoice) { p.invoice = existingInvoiceId; await p.save(); }
    }
    const existing = await Invoice.findById(existingInvoiceId).populate('customer', 'fullName email phone address');
    if (existing) return res.json(existing);
  }

  const fmtDay = (date) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const monthLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const unitNo = contract.unit?.unitNumber || '-';

  const items = monthPayments.map((p, i) => {
    const weekStart = new Date(p.dueDate);
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    const amount    = Number(p.amount || 0);
    return {
      sortOrder: i,
      itemDetails: `Week ${i + 1} (${fmtDay(weekStart)} – ${fmtDay(weekEnd)}) · Unit ${unitNo}`,
      quantity: 1,
      rate: amount,
      discountPct: 0,
      amount,
    };
  });

  const subTotal = items.reduce((s, it) => s + it.amount, 0);

  const invoice = await Invoice.create({
    invoiceNo: await nextInvoiceNo(),
    customer: contract.customer._id,
    invoiceDate: new Date(),
    dueDate: monthEnd,
    orderNumber: contract.contractNo,
    terms: 'Due on receipt',
    subject: `Storage Rent — ${monthLabel} · ${contract.contractNo}`,
    items,
    customerNotes: '',
    subTotal,
    total: subTotal,
    paymentMade: 0,
    status: 'sent',
  });

  for (const p of monthPayments) { p.invoice = invoice._id; await p.save(); }

  res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
});

router.put('/:id', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (req.body.amount !== undefined) {
    const n = Number(req.body.amount);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    payment.amount = n;
  }
  if (req.body.dueDate) payment.dueDate = new Date(req.body.dueDate);
  if (req.body.paidDate) payment.paidDate = new Date(req.body.paidDate);
  if (req.body.method !== undefined) payment.method = req.body.method || '';
  if (req.body.notes !== undefined) payment.notes = req.body.notes;
  await payment.save();
  res.json(await populateAll(Payment.findById(payment._id)));
});

router.delete('/:id', async (req, res) => {
  const payment = await Payment.findByIdAndDelete(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json({ ok: true });
});

// Generate and stream a payment receipt PDF
router.get('/:id/receipt', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status !== 'paid') return res.status(400).json({ error: 'Receipt is only available for paid payments' });

  const contract = await Contract.findById(payment.contract)
    .populate('customer')
    .populate('unit');
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Receipt number: RCP-<contractNo>-<zero-padded index among paid payments>
  const allPaid = await Payment.find({ contract: contract._id, status: 'paid' }).sort({ paidDate: 1 }).select('_id');
  const idx = allPaid.findIndex((p) => String(p._id) === String(payment._id));
  const receiptNo = `RCP-${contract.contractNo}-${String(idx + 1).padStart(3, '0')}`;

  const pdf = await renderReceiptPdf({
    payment,
    contract,
    customer: contract.customer,
    unit: contract.unit,
    receiptNo,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receiptNo}.pdf"`);
  res.send(pdf);
});

export default router;
