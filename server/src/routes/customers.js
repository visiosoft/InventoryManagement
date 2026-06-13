import { Router } from 'express';
import { Customer, Contract, Document } from '../models/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.search) {
    const re = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: re }, { email: re }, { phone: re }, { company: re }];
  }
  const customers = await Customer.find(filter).sort({ fullName: 1 });
  res.json(customers);
});

router.get('/:id', async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const contracts = await Contract.find({ customer: customer._id })
    .populate('unit')
    .sort({ createdAt: -1 });
  const documents = await Document.find({ customer: customer._id }).sort({ createdAt: -1 });
  res.json({ customer, contracts, documents });
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

router.delete('/:id', async (req, res) => {
  const hasContracts = await Contract.exists({ customer: req.params.id });
  if (hasContracts) return res.status(409).json({ error: 'Customer has contracts on file' });
  await Customer.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
