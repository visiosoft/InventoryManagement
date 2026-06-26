import { Router } from 'express';
import { Customer, Contract, Document, Payment, Invoice } from '../models/index.js';

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

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
  const skip  = (page - 1) * limit;

  const [customers, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip(skip).limit(limit),
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

router.delete('/:id', async (req, res) => {
  const hasContracts = await Contract.exists({ customer: req.params.id });
  if (hasContracts) return res.status(409).json({ error: 'Customer has contracts on file' });
  await Customer.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
