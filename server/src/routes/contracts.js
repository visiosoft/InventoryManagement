import { Router } from 'express';
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { stampSignature } from '../services/stampSignature.js';
import { Contract, Customer, Unit, Payment, Document, Invoice, nextContractNo, nextInvoiceNo } from '../models/index.js';
import { sendForSignature, downloadSignedPdf, zohoConfigured } from '../services/zoho.js';
import { uploadFile } from '../services/drive.js';
import { renderContractPdf } from '../services/contractPdf.js';
import { fillAgreementPdf, agreementTemplateExists } from '../services/agreementPdf.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { siteScope } from '../utils/siteScope.js';

// Renders the contract document: the official Customer Agreement template
// filled with contract data when available, otherwise the generated fallback.
function buildContractPdf(contract, signedDate) {
  const parts = {
    contract,
    customer: contract.customer,
    unit: contract.unit,
  };
  return agreementTemplateExists()
    ? fillAgreementPdf({ ...parts, signedDate })
    : renderContractPdf(parts);
}

const router = Router();

router.param('id', (req, res, next, id) => {
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid contract id' });
  }
  next();
});

const populateAll = (q) => q.populate('customer').populate('unit').populate('units').populate('quote', 'quoteNo status');

const OPEN_STATUSES = ['draft', 'pending_signature', 'active'];

function hasDateOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function findOverlappingUnitContract({ unit, startDate, endDate, excludeId }) {
  const openContracts = await Contract.find({
    unit,
    status: { $in: OPEN_STATUSES },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('contractNo startDate endDate status');

  return openContracts.find((c) =>
    hasDateOverlap(new Date(startDate), new Date(endDate), new Date(c.startDate), new Date(c.endDate))
  );
}

async function syncUnitStatus(unitId) {
  const active = await Contract.findOne({ unit: unitId, status: 'active' }).select('_id');
  if (active) {
    await Unit.findByIdAndUpdate(unitId, { status: 'occupied' });
    return;
  }
  const upcoming = await Contract.findOne({
    unit: unitId,
    status: { $in: ['draft', 'pending_signature'] },
  })
    .sort({ startDate: 1 })
    .select('_id startDate');
  if (upcoming) {
    await Unit.findByIdAndUpdate(unitId, { status: 'reserved' });
    return;
  }
  await Unit.findByIdAndUpdate(unitId, { status: 'available' });
}

async function deleteContractRecord(contract) {
  if (contract.status === 'active') {
    throw new Error('Cannot delete an active contract. End or cancel it first.');
  }

  const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Payment.deleteMany({ contract: contract._id });
  await Document.deleteMany({ contract: contract._id });
  await Invoice.deleteMany({ orderNumber: contract.contractNo });
  await contract.deleteOne();
  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.archived === 'true') filter.archived = true;
  else if (req.query.archived !== 'all') filter.archived = { $ne: true };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.customer) filter.customer = req.query.customer;
  if (req.query.billing) filter.billingPeriod = req.query.billing;
  if (req.query.from || req.query.to) {
    filter.startDate = {};
    if (req.query.from) filter.startDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.startDate.$lte = new Date(req.query.to + 'T23:59:59');
  }
  if (req.query.search) {
    const re = new RegExp(req.query.search.trim(), 'i');
    const [matchedUnits, matchedCustomers] = await Promise.all([
      Unit.find({ unitNumber: re }).select('_id'),
      Customer.find({ fullName: re }).select('_id'),
    ]);
    const or = [{ contractNo: re }];
    if (matchedUnits.length) or.push({ unit: { $in: matchedUnits.map((u) => u._id) } });
    if (matchedCustomers.length) or.push({ customer: { $in: matchedCustomers.map((c) => c._id) } });
    filter.$or = or;
  }
  const scope = await siteScope(req.query.site);
  if (scope) {
    filter.$and = [...(filter.$and || []), { $or: [{ unit: { $in: scope.unitIds } }, { units: { $in: scope.unitIds } }] }];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
  const skip = (page - 1) * limit;

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    start_asc: { startDate: 1 },
    start_desc: { startDate: -1 },
    end_asc: { endDate: 1 },
    end_desc: { endDate: -1 },
    rate_desc: { rate: -1 },
    rate_asc: { rate: 1 },
  };
  const sort = sortMap[req.query.sort] || sortMap.newest;

  const [contracts, total] = await Promise.all([
    populateAll(Contract.find(filter)).sort(sort).skip(skip).limit(limit),
    Contract.countDocuments(filter),
  ]);

  // Attach document counts and payment status so the list can flag gaps
  const ids = contracts.map((c) => c._id);
  const [docCounts, payAgg] = ids.length
    ? await Promise.all([
      Document.aggregate([
        { $match: { contract: { $in: ids } } },
        { $group: { _id: '$contract', count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { contract: { $in: ids } } },
        {
          $group: {
            _id: '$contract',
            total: { $sum: '$amount' },
            paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
            overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
          }
        },
      ]),
    ])
    : [[], []];
  const docMap = new Map(docCounts.map((d) => [String(d._id), d.count]));
  const payMap = new Map(payAgg.map((p) => [String(p._id), p]));
  const rows = contracts.map((c) => {
    const pay = payMap.get(String(c._id));
    const paymentStatus = !pay ? 'no_invoice'
      : pay.paid >= pay.total ? 'paid'
        : pay.paid > 0 ? 'partial'
          : 'unpaid';
    // Full contract value: scheduled payments total, or estimated from rate × term
    let contractAmount = pay ? Math.round(pay.total * 100) / 100 : 0;
    if (!contractAmount && c.startDate && c.endDate) {
      const days = Math.max(0, (new Date(c.endDate) - new Date(c.startDate)) / 86400000);
      const periods = c.billingPeriod === 'weekly' ? Math.ceil(days / 7) : Math.ceil(days / 28);
      contractAmount = Math.round(periods * (c.rate || 0) * 100) / 100;
    }
    return {
      ...c.toObject(),
      documentCount: docMap.get(String(c._id)) ?? 0,
      paymentStatus,
      paidAmount: pay ? Math.round(pay.paid * 100) / 100 : 0,
      totalAmount: pay ? Math.round(pay.total * 100) / 100 : 0,
      contractAmount,
      overdueCount: pay?.overdue ?? 0,
    };
  });

  res.json({ data: rows, total, page, pages: Math.ceil(total / limit), limit });
});

// Latest notes across all contracts (for dashboard)
router.get('/latest-notes', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const notes = await Contract.aggregate([
    { $match: { 'timeline.0': { $exists: true } } },
    { $unwind: '$timeline' },
    { $sort: { 'timeline.at': -1 } },
    { $limit: limit },
    { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: '_cust' } },
    {
      $project: {
        contractNo: 1,
        note: '$timeline',
        customer: { $arrayElemAt: ['$_cust', 0] },
      },
    },
  ]);
  res.json(notes.map((n) => ({
    contractId: n._id,
    contractNo: n.contractNo,
    customerName: n.customer?.fullName || '',
    at: n.note.at,
    text: n.note.text,
    author: n.note.author,
  })));
});

// List contracts pending admin approval.
router.get('/pending-approvals', async (req, res) => {
  const contracts = await Contract.find({ approvalStatus: 'pending' })
    .populate('customer', 'fullName phone email')
    .populate('unit', 'unitNumber')
    .sort({ updatedAt: -1 })
    .lean();
  res.json(contracts);
});

router.get('/:id', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Sync payment record statuses from their linked invoices — fixes cases where payment
  // was recorded via the Invoice page (which updates the Invoice doc) but the Payment
  // records for that invoice were not all updated (e.g. deposit record still 'overdue').
  const paidInvoiceIds = await Invoice.find({
    orderNumber: contract.contractNo,
    status: 'paid',
  }).distinct('_id');
  if (paidInvoiceIds.length > 0) {
    await Payment.updateMany(
      { contract: contract._id, invoice: { $in: paidInvoiceIds }, status: { $in: ['pending', 'overdue'] } },
      { $set: { status: 'paid' } }
    );
  }

  let payments = await Payment.find({ contract: contract._id })
    .populate('invoice', 'invoiceNo status dueDate total paymentHistory')
    .sort({ dueDate: 1 });
  const documents = await Document.find({ contract: contract._id }).sort({ createdAt: -1 });
  // Include all invoices linked to this contract by orderNumber or customer
  const invoices = await Invoice.find({
    $or: [
      { orderNumber: contract.contractNo },
      ...(contract.customer?._id ? [{ customer: contract.customer._id }] : []),
    ],
  })
    .select('invoiceNo status dueDate invoiceDate total paymentMade items subject createdAt paymentHistory')
    .sort({ dueDate: 1 });

  // Reconcile: if an invoice's total exceeds the sum of its linked payment records
  // (e.g. a Lock or extra item was added manually), create/update an adjustment record.
  const unitNo = contract.unit?.unitNumber || '-';
  const paymentsArr = [...payments];
  for (const inv of invoices) {
    const invId = String(inv._id);
    const linked = paymentsArr.filter(p => {
      const pid = p.invoice?._id ? String(p.invoice._id) : String(p.invoice);
      return pid === invId;
    });
    const linkedSum = Math.round(linked.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const diff = Math.round((inv.total - linkedSum) * 100) / 100;
    const adjRecord = linked.find(p => /^Invoice adjustment/i.test(p.notes || ''));

    if (diff > 0.01) {
      if (adjRecord) {
        if (Math.abs(adjRecord.amount - diff) > 0.01) {
          await Payment.findByIdAndUpdate(adjRecord._id, { amount: diff, status: inv.status === 'paid' ? 'paid' : 'pending' });
          adjRecord.amount = diff;
        }
      } else {
        const newAdj = await Payment.create({
          contract: contract._id,
          invoice: inv._id,
          amount: diff,
          dueDate: linked[0]?.dueDate || inv.dueDate,
          status: inv.status === 'paid' ? 'paid' : 'pending',
          notes: `Invoice adjustment · Unit ${unitNo}`,
        });
        const populated = await Payment.findById(newAdj._id).populate('invoice', 'invoiceNo status dueDate total');
        paymentsArr.push(populated);
      }
    } else if (diff < -0.01 && adjRecord) {
      // Invoice total dropped — remove the stale adjustment
      await Payment.findByIdAndDelete(adjRecord._id);
      const idx = paymentsArr.findIndex(p => String(p._id) === String(adjRecord._id));
      if (idx !== -1) paymentsArr.splice(idx, 1);
    }
  }

  res.json({ contract, payments: paymentsArr, documents, invoices });
});

// Create a contract (draft). Generates the payment schedule and reserves the unit(s).
router.post('/', async (req, res) => {
  const { customer, unit, units: extraUnits, billingPeriod, rate, deposit, startDate, endDate, notes, firstMonthDiscountPct } = req.body;

  // Determine all unit IDs covered by this contract.
  // `extraUnits` (array) is supplied when creating a single contract for multiple units.
  const allUnitIds = (Array.isArray(extraUnits) && extraUnits.length > 1)
    ? extraUnits
    : [unit];

  const primaryUnitDoc = await Unit.findById(allUnitIds[0]);
  if (!primaryUnitDoc) return res.status(404).json({ error: 'Unit not found' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid contract dates' });
  }
  if (end <= start) {
    return res.status(400).json({ error: 'End date must be after start date' });
  }

  // Units can be booked for multiple customers simultaneously — no overlap check needed.

  const contract = await Contract.create({
    contractNo: await nextContractNo(),
    customer,
    unit: allUnitIds[0],
    units: allUnitIds.length > 1 ? allUnitIds : [],
    billingPeriod, rate, deposit, startDate, endDate, notes,
    firstMonthDiscountPct: Number(req.body.firstMonthDiscountPct || 0),
    status: 'draft',
  });

  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));

  const populated = await populateAll(Contract.findById(contract._id));
  res.status(201).json(populated);
});

// Generate a unique signing link for the customer.
// Draft / pending_signature → any authenticated user.
// Active (re-sign) → admin only.
router.post('/:id/create-signing-link', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const allowedStatuses = ['draft', 'pending_signature', 'active'];
  if (!allowedStatuses.includes(contract.status)) {
    return res.status(409).json({ error: `Cannot generate a signing link for a ${contract.status} contract` });
  }

  // Re-signing an already-active contract requires admin
  if (contract.status === 'active' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can generate a signing link for an already-signed contract' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  contract.signingToken = token;
  contract.signingTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  // Move unsigned contracts to pending_signature; keep active contracts active
  if (contract.status === 'draft') contract.status = 'pending_signature';
  await contract.save();

  const baseUrl = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  res.json({
    signingUrl: `${baseUrl}/sign/${token}`,
    expiresAt: contract.signingTokenExpiry,
    reSign: contract.status === 'active',
  });
});

// Send the contract for e-signature via Zoho Sign (or mock).
router.post('/:id/send-signature', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!['draft'].includes(contract.status)) {
    return res.status(409).json({ error: `Cannot send a ${contract.status} contract for signature` });
  }
  if (!contract.customer.email) {
    return res.status(400).json({ error: 'Customer has no email address for the signature request' });
  }

  const pdfBuffer = await buildContractPdf(contract);

  try {
    const result = await sendForSignature({
      contract,
      pdfBuffer,
      signer: { name: contract.customer.fullName, email: contract.customer.email },
    });
    contract.zohoRequestId = result.requestId;
    contract.status = 'pending_signature';
    await contract.save();
    res.json({ contract, mock: result.mock });
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    res.status(502).json({ error: `Zoho Sign request failed: ${detail}` });
  }
});

// Marks the contract signed → active. Called by the Zoho webhook, or manually
// ("simulate signed" in mock mode / paper signature).
async function markSigned(contractId) {
  const contract = await populateAll(Contract.findById(contractId));
  if (!contract) throw new Error('Contract not found');
  if (!['pending_signature', 'draft'].includes(contract.status)) {
    throw new Error(`Contract is ${contract.status}`);
  }
  const approvalError = approvalBlocksBooking(contract);
  if (approvalError) throw new Error(approvalError);

  // Archive the signed PDF (real Zoho download, or regenerate locally in mock mode).
  let pdfBuffer = null;
  if (zohoConfigured() && contract.zohoRequestId && !contract.zohoRequestId.startsWith('MOCK-')) {
    pdfBuffer = await downloadSignedPdf(contract.zohoRequestId);
  }
  if (!pdfBuffer) {
    pdfBuffer = await buildContractPdf(contract, new Date());
  }
  const stored = await uploadFile({
    buffer: pdfBuffer,
    filename: `${contract.contractNo}-signed.pdf`,
    mimeType: 'application/pdf',
    customerName: contract.customer?.fullName,
  });
  await Document.create({
    contract: contract._id,
    customer: contract.customer._id,
    name: `${contract.contractNo} — signed contract`,
    type: 'contract',
    ...stored,
  });

  contract.status = 'active';
  contract.signedDocUrl = stored.url;
  await contract.save();
  const signedUnitIds = contract.units?.length ? contract.units.map((u) => u._id ?? u) : [contract.unit._id];
  await Promise.all(signedUnitIds.map((uid) => syncUnitStatus(uid)));
  return contract;
}

router.post('/:id/mark-signed', async (req, res) => {
  try {
    res.json(await markSigned(req.params.id));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Zoho Sign webhook — configure this URL in Zoho. Matches by request id.
router.post('/zoho-webhook', async (req, res) => {
  const requestId = req.body?.requests?.request_id;
  const status = req.body?.requests?.request_status;
  if (requestId && status === 'completed') {
    const contract = await Contract.findOne({ zohoRequestId: requestId });
    if (contract) await markSigned(contract._id).catch(() => { });
  }
  res.json({ ok: true });
});

// Admin approval gate — blocks booking (activation) until an admin approves.
function approvalBlocksBooking(contract) {
  if (contract.approvalStatus === 'pending') {
    return 'This contract requires admin approval before it can be booked';
  }
  if (contract.approvalStatus === 'rejected') {
    return `This contract was rejected by admin${contract.approvalNote ? `: ${contract.approvalNote}` : ''}`;
  }
  return null;
}

// Send a contract for admin approval.
router.post('/:id/send-for-approval', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.approvalStatus === 'approved') {
    return res.status(409).json({ error: 'Contract is already approved' });
  }
  const actor = req.user.name || req.user.email || 'user';
  contract.approvalStatus = 'pending';
  contract.approvalNote = '';
  contract.approvedBy = '';
  contract.approvedAt = undefined;
  contract.timeline.push({ at: new Date(), text: `Sent for admin approval by ${actor}`, author: actor });
  await contract.save();
  res.json(await populateAll(Contract.findById(contract._id)));
});

// Approve or reject a contract for booking (admin only).
router.post('/:id/approve', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can approve a contract' });
  }
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const actor = req.user.name || req.user.email || 'admin';
  contract.approvalStatus = 'approved';
  contract.approvalNote = String(req.body?.note || '');
  contract.approvedBy = actor;
  contract.approvedAt = new Date();
  contract.status = 'active';
  contract.timeline.push({ at: new Date(), text: `Contract approved and activated by ${actor}${req.body?.note ? `: ${req.body.note}` : ''}`, author: actor });
  await contract.save();

  const activateUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(activateUnitIds.map((uid) => syncUnitStatus(uid)));

  res.json(await populateAll(Contract.findById(contract._id)));
});

router.post('/:id/reject', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can reject a contract' });
  }
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'active') {
    return res.status(409).json({ error: 'Cannot reject an already active contract' });
  }

  const actor = req.user.name || req.user.email || 'admin';
  contract.approvalStatus = 'rejected';
  contract.approvalNote = String(req.body?.note || '');
  contract.approvedBy = actor;
  contract.approvedAt = new Date();
  contract.timeline.push({ at: new Date(), text: `Contract rejected${req.body?.note ? `: ${req.body.note}` : ''}`, author: actor });
  await contract.save();
  res.json(await populateAll(Contract.findById(contract._id)));
});

// Activate without signature (e.g. signed on paper, skip e-sign).
router.post('/:id/activate', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!['draft', 'pending_signature'].includes(contract.status)) {
    return res.status(409).json({ error: `Cannot activate a ${contract.status} contract` });
  }
  const approvalError = approvalBlocksBooking(contract);
  if (approvalError) return res.status(403).json({ error: approvalError });

  contract.status = 'active';
  await contract.save();

  const activateUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(activateUnitIds.map((uid) => syncUnitStatus(uid)));
  res.json(await populateAll(Contract.findById(contract._id)));
});

// End or cancel a contract — frees the unit and removes unpaid future payments.
async function closeContract(req, res, status) {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (['ended', 'cancelled'].includes(contract.status)) {
    return res.status(409).json({ error: `Contract is already ${contract.status}` });
  }

  const { endDate, reason } = req.body ?? {};
  const effectiveEnd = endDate ? new Date(endDate) : new Date();

  contract.status = status;
  // If an early end date was provided, update the stored end date
  if (endDate && new Date(endDate) < new Date(contract.endDate)) {
    contract.endDate = effectiveEnd;
  }
  // Record reason as a timeline note
  if (reason) {
    if (!contract.timeline) contract.timeline = [];
    const actor = req.user?.name || req.user?.email || '';
    contract.timeline.push({ at: new Date(), text: `Contract ${status}: ${reason}`, author: actor });
  }
  await contract.save();

  // Invoices and payments are intentionally left untouched — they remain as
  // unpaid/overdue records until staff explicitly cancel or write them off.

  const nextContract = await Contract.findOne({
    unit: contract.unit,
    status: { $in: ['draft', 'pending_signature'] },
  })
    .sort({ startDate: 1, createdAt: 1 })
    .select('_id startDate status');

  if (nextContract && new Date(nextContract.startDate) <= new Date()) {
    nextContract.status = 'active';
    await nextContract.save();
  }

  const closeUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(closeUnitIds.map((uid) => syncUnitStatus(uid)));
  res.json(await populateAll(Contract.findById(contract._id)));
}

router.post('/:id/end', (req, res) => closeContract(req, res, 'ended'));
router.post('/:id/cancel', (req, res) => closeContract(req, res, 'cancelled'));

// Reactivate an ended or cancelled contract — sets status back to active and updates unit.
router.post('/:id/reactivate', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!['ended', 'cancelled'].includes(contract.status)) {
      return res.status(409).json({ error: `Only ended or cancelled contracts can be reactivated` });
    }

    contract.status = 'active';
    // If the end date is in the past, optionally extend it (caller can edit after)
    if (!contract.timeline) contract.timeline = [];
    const actor = req.user?.name || req.user?.email || '';
    contract.timeline.push({ at: new Date(), text: `Contract reactivated`, author: actor });
    await contract.save();

    const unitIds = contract.units?.length ? contract.units : [contract.unit];
    await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));

    res.json(await populateAll(Contract.findById(contract._id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sign a contract in person — capture a drawn or typed signature, stamp it on the PDF,
// archive the signed copy, and activate the contract.
router.post('/:id/sign-inperson', async (req, res) => {
  try {
    const { signerName, signatureDataUrl, signMode } = req.body;
    if (!signerName?.trim()) return res.status(400).json({ error: 'Signer name is required' });

    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!['draft', 'pending_signature'].includes(contract.status)) {
      return res.status(409).json({ error: `Cannot sign a ${contract.status} contract` });
    }
    const approvalError = approvalBlocksBooking(contract);
    if (approvalError) return res.status(403).json({ error: approvalError });

    const now = new Date();
    let pdfBuffer = await buildContractPdf(contract, now);
    pdfBuffer = await stampSignature(pdfBuffer, { signerName, signatureDataUrl, signMode, signedAt: now });

    const stored = await uploadFile({
      buffer: pdfBuffer,
      filename: `${contract.contractNo}-signed.pdf`,
      mimeType: 'application/pdf',
    });

    await Document.create({
      contract: contract._id,
      customer: contract.customer._id,
      name: `${contract.contractNo} — signed contract`,
      type: 'contract',
      ...stored,
    });

    contract.status = 'active';
    contract.signedDocUrl = stored.url;
    await contract.save();

    const signedUnitIds = contract.units?.length
      ? contract.units.map((u) => u._id ?? u)
      : [contract.unit._id];
    await Promise.all(signedUnitIds.map((uid) => syncUnitStatus(uid)));

    res.json(await populateAll(Contract.findById(contract._id)));
  } catch (err) {
    console.error('sign-inperson error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update editable fields on a contract (rate, deposit, dates, notes, payment method).
// Primary unit cannot be changed, but the additional units[] array can be updated here.
router.put('/:id', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Once booked (active), only an admin may edit the contract terms.
    if (contract.status === 'active' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can edit a booked contract' });
    }

    const allowed = ['rate', 'deposit', 'startDate', 'endDate', 'billingPeriod', 'paymentMethod', 'firstPaymentDate', 'notes', 'totalQuotation'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        contract[key] = key.endsWith('Date') && req.body[key] ? new Date(req.body[key]) : req.body[key];
      }
    }

    // Allow updating the full units array (primary unit stays in contract.unit, array holds all)
    if (Array.isArray(req.body.units)) {
      contract.units = req.body.units.filter(Boolean);
    }

    // Authorized persons (name required per entry)
    if (Array.isArray(req.body.authorizedPersons)) {
      contract.authorizedPersons = req.body.authorizedPersons
        .map((p) => ({
          name: String(p.name || '').trim(),
          phone: String(p.phone || '').trim(),
          relation: String(p.relation || '').trim(),
          idType: String(p.idType || '').trim(),
          idNumber: String(p.idNumber || '').trim(),
        }))
        .filter((p) => p.name);
    }

    await contract.save();
    const populated = await populateAll(Contract.findById(contract._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extend an active contract to a new end date and generate invoices for the new period.
// Optionally creates a fresh signing token so the customer can re-sign the extended agreement.
router.post('/:id/extend', async (req, res) => {
  try {
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (['ended', 'cancelled'].includes(contract.status)) {
      return res.status(409).json({ error: 'Cannot extend an ended or cancelled contract' });
    }

    const { newEndDate, allowReSign = false } = req.body;
    if (!newEndDate) return res.status(400).json({ error: 'newEndDate is required' });

    const newEnd = new Date(newEndDate);
    if (contract.endDate && newEnd <= new Date(contract.endDate)) {
      return res.status(400).json({ error: 'New end date must be after the current end date' });
    }

    contract.endDate = newEnd;

    let signingUrl = null;
    let signingTokenExpiry = null;
    if (allowReSign) {
      const token = crypto.randomBytes(32).toString('hex');
      contract.signingToken = token;
      contract.signingTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      signingTokenExpiry = contract.signingTokenExpiry;
      const baseUrl = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
      signingUrl = `${baseUrl}/sign/${token}`;
    }

    await contract.save();

    res.json({ extended: true, generated: 0, signingUrl, signingTokenExpiry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-delete', async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  const uniqueIds = Array.from(new Set(ids));
  const contracts = await Contract.find({ _id: { $in: uniqueIds } });

  if (!contracts.length) {
    return res.status(404).json({ error: 'No contracts found' });
  }

  const activeContract = contracts.find((contract) => contract.status === 'active');
  if (activeContract) {
    return res.status(409).json({ error: `Cannot delete active contract ${activeContract.contractNo}. End or cancel it first.` });
  }

  for (const contract of contracts) {
    await deleteContractRecord(contract);
  }

  res.json({ ok: true, deleted: contracts.length, requested: uniqueIds.length });
});

// Delete a contract and all its payments / documents.
// Active contracts cannot be deleted — end or cancel them first.
router.delete('/:id', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  try {
    await deleteContractRecord(contract);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }

  res.json({ ok: true });
});

// Archive/unarchive a contract. Hides it from the default contracts list without
// deleting its payment/document history — used when deletion is blocked because
// paid payments must be retained.
router.patch('/:id/archive', async (req, res) => {
  const archived = req.body?.archived !== false;
  const contract = await Contract.findByIdAndUpdate(
    req.params.id,
    { archived },
    { new: true }
  );
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json({ ok: true, contract });
});

// Flexible invoice generator — called from the UI modal.
// Body: { startDate, endDate, dueDate, notes, discountPct } for a period invoice
//       { isDeposit: true, dueDate, notes }                 for a security deposit invoice
// After creating the invoice, Payment entries are inserted for each week (linked via invoice field).
router.post('/:id/generate-custom-invoice', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!contract.customer?._id) return res.status(400).json({ error: 'Contract has no customer' });

  const { startDate, endDate, dueDate, notes, isDeposit, discountPct: rawDiscount, extraItems: rawExtras } = req.body;
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const unitNo = contract.unit?.unitNumber || '-';

  // ── Security deposit invoice ──────────────────────────────────────────────
  if (isDeposit) {
    const amount = Number(contract.deposit || 0);
    if (!amount) return res.status(400).json({ error: 'No deposit amount set on this contract' });
    const invoice = await Invoice.create({
      invoiceNo: await nextInvoiceNo(),
      customer: contract.customer._id,
      invoiceDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      orderNumber: contract.contractNo,
      terms: 'Due on receipt',
      subject: `Security Deposit — ${contract.contractNo} · Unit ${unitNo}`,
      items: [{ sortOrder: 0, itemDetails: `Security deposit · Unit ${unitNo}`, quantity: 1, rate: amount, discountPct: 0, amount }],
      customerNotes: notes || '',
      subTotal: amount, total: amount, paymentMade: 0, status: 'sent',
    });
    // Create a single pending payment entry linked to this invoice
    await Payment.create({
      contract: contract._id,
      invoice: invoice._id,
      amount,
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      status: 'pending',
      notes: notes || 'Security deposit',
    });
    return res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
  }

  // ── Period invoice (weekly breakdown) ────────────────────────────────────
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.round((end - start) / 86400000);
  if (totalDays <= 0) return res.status(400).json({ error: 'End date must be after start date' });

  // rate is monthly price; weekly payment = rate / 4. Ceiling: any leftover day = full week.
  const monthlyRate = Number(contract.rate || 0);
  const weeklyRate = Math.round((monthlyRate / 4) * 100) / 100;
  const totalWeeks = Math.ceil(totalDays / 7);
  const discountPct = Math.max(0, Math.min(100, Number(rawDiscount || 0)));

  // Global week offset from contract start → discount only applies to first 4 weeks of entire contract.
  const contractStart = new Date(contract.startDate);
  const daysSinceStart = Math.round((start - contractStart) / 86400000);
  const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7));

  // Build per-week payment amounts (discount only on first 4 weeks of contract)
  const weekAmounts = [];
  for (let i = 0; i < totalWeeks; i++) {
    const discounted = discountPct > 0 && (globalWeekOffset + i) < 4;
    weekAmounts.push(discounted
      ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
      : weeklyRate);
  }
  const periodSubTotal = Math.round(weekAmounts.reduce((s, a) => s + a, 0) * 100) / 100;
  const hasDiscount = discountPct > 0 && globalWeekOffset < 4;
  const displayEnd = fmt(new Date(end - 86400000));

  // One invoice line item for the whole month period — quantity = weeks, rate = weekly rate
  const items = [{
    sortOrder: 0,
    itemDetails: `Storage Rent ${fmt(start)} – ${displayEnd} · Unit ${unitNo}`,
    quantity: totalWeeks,
    rate: weeklyRate,
    discountPct: hasDiscount ? discountPct : 0,
    amount: periodSubTotal,
  }];

  // First invoice for this contract: prepend security deposit (= 1 month rent, no discount)
  const priorInvoiceIds = await Payment.distinct('invoice', { contract: contract._id, invoice: { $ne: null } });
  if (priorInvoiceIds.filter(Boolean).length === 0) {
    items.push({
      sortOrder: 1,
      itemDetails: `Security Deposit · Unit ${unitNo}`,
      quantity: 1,
      rate: monthlyRate,
      discountPct: 0,
      amount: monthlyRate,
    });
  }

  // Append any extra charges / credits (locks, cleaning fees, credits, etc.)
  const extras = Array.isArray(rawExtras) ? rawExtras : [];
  extras.forEach((x, xi) => {
    if (!x.description || !Number(x.amount)) return;
    const amt = Math.round(Number(x.amount) * 100) / 100;
    const signed = x.type === 'credit' ? -amt : amt;
    items.push({
      sortOrder: 2 + xi,
      itemDetails: x.description,
      quantity: 1,
      rate: signed,
      discountPct: 0,
      amount: signed,
    });
  });

  const subTotal = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  const invoice = await Invoice.create({
    invoiceNo: await nextInvoiceNo(),
    customer: contract.customer._id,
    invoiceDate: new Date(),
    dueDate: dueDate ? new Date(dueDate) : end,
    orderNumber: contract.contractNo,
    terms: 'Due on receipt',
    subject: `Storage Rent ${fmt(start)} – ${displayEnd} · ${contract.contractNo}`,
    items,
    customerNotes: notes || '',
    subTotal, total: subTotal, paymentMade: 0, status: 'sent',
  });

  // One monthly payment record for the rent portion
  await Payment.create({
    contract: contract._id,
    invoice: invoice._id,
    amount: periodSubTotal,
    dueDate: dueDate ? new Date(dueDate) : start,
    status: 'pending',
    notes: `Storage Rent ${fmt(start)} – ${displayEnd} · Unit ${unitNo}`,
  });

  // If first invoice, also add the deposit payment record
  const isFirstInvoice = priorInvoiceIds.filter(Boolean).length === 0;
  if (isFirstInvoice) {
    await Payment.create({
      contract: contract._id,
      invoice: invoice._id,
      amount: monthlyRate,
      dueDate: dueDate ? new Date(dueDate) : start,
      status: 'pending',
      notes: `Security deposit · Unit ${unitNo}`,
    });
  }

  res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
});

// Add a timeline note to a contract
router.post('/:id/notes', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Note text is required' });
  contract.timeline.push({ text, author: String(req.body?.author || '') });
  await contract.save();
  res.json(contract.timeline);
});

// Edit a timeline note by index
router.put('/:id/notes/:idx', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Note text is required' });
  contract.timeline[idx].text = text;
  await contract.save();
  res.json(contract.timeline);
});

// Delete a timeline note by index
router.delete('/:id/notes/:idx', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  contract.timeline.splice(idx, 1);
  await contract.save();
  res.json(contract.timeline);
});

// Download the (unsigned) contract PDF.
router.get('/:id/pdf', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const pdf = await buildContractPdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
});

// Send contract PDF via email
router.post('/:id/send-email', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!mailConfigured()) return res.status(400).json({ error: 'SMTP not configured' });
  const email = contract.customer?.email;
  if (!email) return res.status(400).json({ error: 'Customer has no email address' });
  const pdf = await buildContractPdf(contract);
  await sendMail({
    to: email,
    subject: `Your Storage Contract ${contract.contractNo} — PurpleBox`,
    text: `Dear ${contract.customer.fullName},\n\nPlease find your storage contract ${contract.contractNo} attached.\n\nThank you,\nPurpleBox`,
    html: `<p>Dear ${contract.customer.fullName},</p><p>Please find your storage contract <strong>${contract.contractNo}</strong> attached.</p><p>Thank you,<br/>PurpleBox</p>`,
    attachments: [{ filename: `${contract.contractNo}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
  res.json({ ok: true });
});

export default router;
