import { Router } from 'express';
import { Payment, Contract, Customer, Unit } from '../models/index.js';
import { renderReceiptPdf } from '../services/receiptPdf.js';

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
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [overdueList, pendingList, paidThisMonth, dueThisMonth] = await Promise.all([
    Payment.find({ status: 'overdue' }).select('amount'),
    Payment.find({ status: 'pending' }).select('amount'),
    Payment.find({ status: 'paid', paidDate: { $gte: monthStart, $lte: monthEnd } }).select('amount'),
    Payment.find({ status: { $in: ['pending', 'overdue'] }, dueDate: { $gte: monthStart, $lte: monthEnd } }).select('amount'),
  ]);

  const sum = (arr) => arr.reduce((s, p) => s + p.amount, 0);
  res.json({
    overdue:       { count: overdueList.length,   total: sum(overdueList) },
    pending:       { count: pendingList.length,    total: sum(pendingList) },
    paidThisMonth: { count: paidThisMonth.length,  total: sum(paidThisMonth) },
    dueThisMonth:  { count: dueThisMonth.length,   total: sum(dueThisMonth) },
  });
});

router.get('/', async (req, res) => {
  await refreshOverdue();
  const filter = {};
  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.contract) filter.contract = req.query.contract;
  if (req.query.from || req.query.to) {
    filter.dueDate = {};
    if (req.query.from) filter.dueDate.$gte = new Date(req.query.from);
    if (req.query.to)   filter.dueDate.$lte = new Date(req.query.to + 'T23:59:59');
  }

  // Search by customer name, unit number, or contract number
  if (req.query.search) {
    const re = new RegExp(req.query.search.trim(), 'i');
    const [units, customers] = await Promise.all([
      Unit.find({ unitNumber: re }).select('_id'),
      Customer.find({ fullName: re }).select('_id'),
    ]);
    const contractFilter = { $or: [] };
    if (units.length)     contractFilter.$or.push({ unit:     { $in: units.map((u) => u._id) } });
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

// Record multiple payments at once (bulk pay)
router.post('/bulk-record', async (req, res) => {
  const { paymentIds, method, paidDate, notes } = req.body;
  if (!Array.isArray(paymentIds) || paymentIds.length === 0)
    return res.status(400).json({ error: 'paymentIds array is required' });
  const date = paidDate ? new Date(paidDate) : new Date();
  const result = await Payment.updateMany(
    { _id: { $in: paymentIds }, status: { $ne: 'paid' } },
    { $set: { status: 'paid', method: method || 'cash', paidDate: date, ...(notes ? { notes } : {}) } }
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
  payment.status   = 'paid';
  payment.method   = method || 'cash';
  payment.paidDate = paidDate ? new Date(paidDate) : new Date();
  if (notes) payment.notes = notes;
  await payment.save();
  res.json(await populateAll(Payment.findById(payment._id)));
});

router.post('/:id/unrecord', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  payment.status   = new Date(payment.dueDate) < new Date() ? 'overdue' : 'pending';
  payment.paidDate = undefined;
  payment.method   = '';
  await payment.save();
  res.json(await populateAll(Payment.findById(payment._id)));
});

router.put('/:id', async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (req.body.amount  !== undefined) {
    const n = Number(req.body.amount);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    payment.amount = n;
  }
  if (req.body.dueDate)              payment.dueDate  = new Date(req.body.dueDate);
  if (req.body.paidDate)             payment.paidDate = new Date(req.body.paidDate);
  if (req.body.method  !== undefined) payment.method  = req.body.method || '';
  if (req.body.notes   !== undefined) payment.notes   = req.body.notes;
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
  const idx     = allPaid.findIndex((p) => String(p._id) === String(payment._id));
  const receiptNo = `RCP-${contract.contractNo}-${String(idx + 1).padStart(3, '0')}`;

  const pdf = await renderReceiptPdf({
    payment,
    contract,
    customer: contract.customer,
    unit:     contract.unit,
    receiptNo,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receiptNo}.pdf"`);
  res.send(pdf);
});

export default router;
