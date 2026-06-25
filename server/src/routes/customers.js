import { Router } from 'express';
import { Customer, Contract, Document } from '../models/index.js';

const router = Router();

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
    ];
  }

  const sortKey = String(req.query.sort || 'date_added_desc');
  let sort = { createdAt: -1, _id: -1 };
  if (sortKey === 'name_asc') sort = { fullName: 1, _id: -1 };
  else if (sortKey === 'name_desc') sort = { fullName: -1, _id: -1 };
  else if (sortKey === 'date_added_asc') sort = { createdAt: 1, _id: 1 };

  const customers = await Customer.find(filter).sort(sort);
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
