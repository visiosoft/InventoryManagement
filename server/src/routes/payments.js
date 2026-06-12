import { Router } from 'express';
import { Payment } from '../models/index.js';

const router = Router();

const populateAll = (q) =>
  q.populate({ path: 'contract', populate: [{ path: 'customer' }, { path: 'unit', populate: 'unitType' }] });

// Lazily flag overdue payments whenever they're listed.
async function refreshOverdue() {
  await Payment.updateMany(
    { status: 'pending', dueDate: { $lt: new Date() } },
    { $set: { status: 'overdue' } }
  );
}

router.get('/', async (req, res) => {
  await refreshOverdue();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.contract) filter.contract = req.query.contract;
  const payments = await populateAll(Payment.find(filter)).sort({ dueDate: 1 });
  res.json(payments);
});

router.post('/:id/record', async (req, res) => {
  const { method, paidDate, notes } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'paid') return res.status(409).json({ error: 'Payment is already recorded as paid' });
  payment.status = 'paid';
  payment.method = method || 'cash';
  payment.paidDate = paidDate ? new Date(paidDate) : new Date();
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

export default router;
