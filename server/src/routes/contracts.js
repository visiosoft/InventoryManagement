import { Router } from 'express';
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { stampSignature } from '../services/stampSignature.js';
import { Contract, Customer, Unit, Payment, Document, Invoice, nextContractNo, nextInvoiceNo } from '../models/index.js';
import { generateSchedule } from '../services/schedule.js';
import { sendForSignature, downloadSignedPdf, zohoConfigured } from '../services/zoho.js';
import { uploadFile } from '../services/drive.js';
import { renderContractPdf } from '../services/contractPdf.js';
import { fillAgreementPdf, agreementTemplateExists } from '../services/agreementPdf.js';

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

const populateAll = (q) => q.populate('customer').populate('unit').populate('units');

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

  // Block deletion if any paid payments exist — financial history must be preserved.
  const paidCount = await Payment.countDocuments({ contract: contract._id, status: 'paid' });
  if (paidCount > 0) {
    throw new Error(
      `Cannot delete contract ${contract.contractNo}: it has ${paidCount} recorded payment(s). ` +
      `Financial records must be retained. Archive or keep this contract instead.`
    );
  }

  const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Payment.deleteMany({ contract: contract._id });
  await Document.deleteMany({ contract: contract._id });
  // Also remove invoices linked to this contract (only reachable here since no paid payments exist)
  await Invoice.deleteMany({ orderNumber: contract.contractNo });
  await contract.deleteOne();
  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
}

router.get('/', async (req, res) => {
  const filter = {};
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
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
  const skip  = (page - 1) * limit;

  const [contracts, total] = await Promise.all([
    populateAll(Contract.find(filter)).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Contract.countDocuments(filter),
  ]);
  res.json({ data: contracts, total, page, pages: Math.ceil(total / limit), limit });
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

router.get('/:id', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Auto-generate invoices ONLY for brand-new contracts that have no invoices yet.
  // Once any invoice exists, do NOT auto-generate on GET — the user controls generation
  // via the explicit "Auto-generate" button. This prevents deleted invoices from being
  // recreated on every page load.
  if (!['ended', 'cancelled'].includes(contract.status)) {
    const existingInvoiceCount = await Invoice.countDocuments({ orderNumber: contract.contractNo });
    if (existingInvoiceCount === 0) {
      try { await generateMissingPeriodInvoices(contract, new Date(contract.endDate)); } catch (_) { }
    }
  }

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
    .populate('invoice', 'invoiceNo status dueDate total')
    .sort({ dueDate: 1 });
  const documents = await Document.find({ contract: contract._id }).sort({ createdAt: -1 });
  // Include all invoices so the payment schedule can show deposit-covered (net-0) ones
  // that have no payment records attached.
  const invoices = await Invoice.find({ orderNumber: contract.contractNo })
    .select('invoiceNo status dueDate invoiceDate total paymentMade items subject createdAt')
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
  const { customer, unit, units: extraUnits, billingPeriod, rate, deposit, startDate, endDate, autoRenew, notes, firstMonthDiscountPct } = req.body;

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

  // Check overlap for every unit
  for (const uid of allUnitIds) {
    const overlap = await findOverlappingUnitContract({ unit: uid, startDate: start, endDate: end });
    if (overlap) {
      const u = await Unit.findById(uid).select('unitNumber');
      return res.status(409).json({
        error: `Unit ${u?.unitNumber ?? uid} is already booked for this period (${overlap.contractNo})`,
      });
    }
  }

  const contract = await Contract.create({
    contractNo: await nextContractNo(),
    customer,
    unit: allUnitIds[0],
    units: allUnitIds.length > 1 ? allUnitIds : [],
    billingPeriod, rate, deposit, startDate, endDate, autoRenew, notes,
    firstMonthDiscountPct: Number(req.body.firstMonthDiscountPct || 0),
    status: 'draft',
  });

  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));

  // Generate invoices synchronously so they're ready when the client lands on the detail page.
  // Errors here must not fail the contract creation itself.
  const populated = await populateAll(Contract.findById(contract._id));
  try {
    await generateMissingPeriodInvoices(populated, new Date(Date.now() + 90 * 86400000));
  } catch (e) {
    console.error('Invoice pre-generation failed for', contract.contractNo, e.message);
  }

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

// Fire-and-forget: generate all missing 4-week invoices for a contract.
// Works for draft, pending_signature, and active contracts.
async function autoInvoiceAfterActivation(contractId) {
  try {
    const c = await Contract.findById(contractId)
      .populate('customer', '_id fullName email')
      .populate('unit', 'unitNumber');
    if (c && !['ended', 'cancelled'].includes(c.status)) {
      await generateMissingPeriodInvoices(c, new Date(Date.now() + 90 * 86400000));
    }
  } catch (e) {
    console.error('Auto-invoice generation error:', e.message);
  }
}

// Marks the contract signed → active. Called by the Zoho webhook, or manually
// ("simulate signed" in mock mode / paper signature).
async function markSigned(contractId) {
  const contract = await populateAll(Contract.findById(contractId));
  if (!contract) throw new Error('Contract not found');
  if (!['pending_signature', 'draft'].includes(contract.status)) {
    throw new Error(`Contract is ${contract.status}`);
  }

  const overlap = await findOverlappingUnitContract({
    unit: contract.unit._id,
    startDate: contract.startDate,
    endDate: contract.endDate,
    excludeId: contract._id,
  });
  if (overlap) {
    throw new Error(`Unit ${contract.unit.unitNumber} is already booked for this period (${overlap.contractNo})`);
  }

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
  autoInvoiceAfterActivation(contract._id); // non-blocking
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

// Activate without signature (e.g. signed on paper, skip e-sign).
router.post('/:id/activate', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!['draft', 'pending_signature'].includes(contract.status)) {
    return res.status(409).json({ error: `Cannot activate a ${contract.status} contract` });
  }

  const overlap = await findOverlappingUnitContract({
    unit: contract.unit,
    startDate: contract.startDate,
    endDate: contract.endDate,
    excludeId: contract._id,
  });
  if (overlap) {
    return res.status(409).json({ error: `Unit is already booked for this period (${overlap.contractNo})` });
  }

  contract.status = 'active';
  await contract.save();

  const activateUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(activateUnitIds.map((uid) => syncUnitStatus(uid)));
  autoInvoiceAfterActivation(contract._id); // non-blocking
  res.json(await populateAll(Contract.findById(contract._id)));
});

// Regenerate all invoices for a contract — deletes unpaid invoices + their payment records,
// then re-runs the invoice generator so deposit coverage is recalculated correctly.
router.post('/:id/regenerate-invoices', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Find unpaid invoices linked to this contract via orderNumber
  const unpaidInvoices = await Invoice.find({
    orderNumber: contract.contractNo,
    status: { $in: ['draft', 'sent'] },
  }).select('_id');

  if (unpaidInvoices.length > 0) {
    const unpaidIds = unpaidInvoices.map(i => i._id);
    await Payment.deleteMany({ invoice: { $in: unpaidIds } });
    await Invoice.deleteMany({ _id: { $in: unpaidIds } });
  }

  await generateMissingPeriodInvoices(contract, new Date(contract.endDate));
  res.json({ ok: true });
});

// Generate (or regenerate) the payment schedule for a contract.
// Existing PAID payments are kept; only pending ones are replaced.
router.post('/:id/generate-schedule', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Remove only unpaid entries so paid history is preserved
  await Payment.deleteMany({ contract: contract._id, status: { $in: ['pending', 'overdue'] } });

  const schedule = generateSchedule({
    startDate: contract.startDate,
    endDate: contract.endDate,
    billingPeriod: contract.billingPeriod,
    rate: contract.rate,
  });
  await Payment.insertMany(schedule.map((p) => ({ ...p, contract: contract._id })));

  res.json({ ok: true, count: schedule.length });
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

    const overlap = await findOverlappingUnitContract({
      unit: contract.unit._id,
      startDate: contract.startDate,
      endDate: contract.endDate,
      excludeId: contract._id,
    });
    if (overlap) {
      return res.status(409).json({
        error: `Unit ${contract.unit.unitNumber} is already booked for this period (${overlap.contractNo})`,
      });
    }

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
    autoInvoiceAfterActivation(contract._id); // non-blocking

    res.json(await populateAll(Contract.findById(contract._id)));
  } catch (err) {
    console.error('sign-inperson error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update editable fields on a contract (rate, deposit, dates, notes, payment method, auto-renew).
// Does NOT allow changing customer or unit — those require a new contract.
router.put('/:id', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const allowed = ['rate', 'deposit', 'startDate', 'endDate', 'billingPeriod', 'autoRenew', 'paymentMethod', 'firstPaymentDate', 'notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        contract[key] = key.endsWith('Date') && req.body[key] ? new Date(req.body[key]) : req.body[key];
      }
    }

    await contract.save();
    const populated = await populateAll(Contract.findById(contract._id));
    res.json(populated);
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

// ── Auto-invoice generator ────────────────────────────────────────────────────
// Walks 4-week periods from contract start, skips periods that already have an
// invoiced payment, creates Invoice + Payment records for the rest.
async function generateMissingPeriodInvoices(contract, cutoffDate, createdBy = '') {
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const contractStart = new Date(contract.startDate);
  const contractEnd = new Date(contract.endDate);
  const cutoff = cutoffDate || new Date(Date.now() + 90 * 86400000); // default 3 months ahead
  // Always generate through contractEnd so the deposit-covered last period is never omitted.
  // For regular upcoming periods, still respect the 90-day cutoff.
  const until = contractEnd;

  const monthlyRate = Number(contract.rate || 0);
  const weeklyRate = Math.round((monthlyRate / 4) * 100) / 100;
  const unitNo = contract.unit?.unitNumber || '-';
  const customerId = contract.customer?._id || contract.customer;

  // Determine discount: stored field first, then infer from first existing payment
  let discountPct = Number(contract.firstMonthDiscountPct || 0);
  if (!discountPct && weeklyRate > 0) {
    const firstPayment = await Payment.findOne({ contract: contract._id, invoice: { $ne: null } }).sort({ dueDate: 1 });
    if (firstPayment) {
      const actual = Number(firstPayment.amount);
      if (actual > 0 && actual < weeklyRate) {
        discountPct = Math.round((1 - actual / weeklyRate) * 100);
      }
    }
  }

  // Check if this contract already has any invoices (to decide whether to add security deposit)
  const priorInvoiceIds = await Payment.distinct('invoice', { contract: contract._id, invoice: { $ne: null } });
  const hasExistingInvoices = priorInvoiceIds.filter(Boolean).length > 0;

  // Deposit covers the last COMPLETE 4-week period (floor, not ceil, so partial trailing
  // periods don't create a spurious 4th invoice — the deposit absorbs them).
  const totalContractDays = Math.round((contractEnd - contractStart) / 86400000);
  const totalContractWeeks = Math.ceil(totalContractDays / 7);
  const totalFullPeriods = Math.floor(totalContractWeeks / 4); // complete 4-week periods only
  // For contracts ≤ 1 full period the deposit is just held; set beyond the contract so no weeks
  // are flagged as covered.
  const depositStartWeek = totalFullPeriods > 1 ? (totalFullPeriods - 1) * 4 : totalContractWeeks;

  let generated = 0;
  const periodStart = new Date(contractStart);

  while (periodStart < until) {
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 28);

    // Skip if any payment record OR invoice already covers this period.
    // Also verify the referenced invoice still exists — orphaned payment records
    // (invoice was deleted) must not block re-generation.
    const existingPaymentRaw = await Payment.findOne({
      contract: contract._id,
      invoice: { $ne: null },
      dueDate: { $gte: periodStart, $lt: periodEnd },
    });
    const existingPayment = existingPaymentRaw
      ? (await Invoice.exists({ _id: existingPaymentRaw.invoice }) ? existingPaymentRaw : null)
      : null;
    const existingInvoice = !existingPayment
      ? await Invoice.findOne({ orderNumber: contract.contractNo, dueDate: { $gte: periodStart, $lt: periodEnd } })
      : null;

    // Invoice exists but has no linked payment records → recreate the missing payment entries
    // so the client can display and interact with the invoice.
    if (!existingPayment && existingInvoice) {
      const linkedPayment = await Payment.findOne({ contract: contract._id, invoice: existingInvoice._id });
      if (!linkedPayment && existingInvoice.total > 0) {
        const rentItem = (existingInvoice.items || []).find(it => /^Storage Rent/i.test(it.itemDetails || ''));
        const depItem  = (existingInvoice.items || []).find(it => /^(Security deposit|Advance Rent)/i.test(it.itemDetails || ''));
        const rentAmt  = rentItem ? Math.round(Number(rentItem.amount) * 100) / 100 : existingInvoice.total;
        const unitNoLocal = contract.unit?.unitNumber || '-';
        const fmt2 = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const displayEnd2 = new Date(Math.min(periodEnd, contractEnd)); displayEnd2.setDate(displayEnd2.getDate() - 1);
        if (rentAmt > 0) {
          await Payment.create({
            contract: contract._id, invoice: existingInvoice._id,
            amount: rentAmt, dueDate: periodStart, status: existingInvoice.status === 'paid' ? 'paid' : 'pending',
            notes: `Storage Rent ${fmt2(periodStart)} – ${fmt2(displayEnd2)} · Unit ${unitNoLocal}`,
          });
          generated++;
        }
        if (depItem && Number(depItem.amount) > 0) {
          await Payment.create({
            contract: contract._id, invoice: existingInvoice._id,
            amount: Math.round(Number(depItem.amount) * 100) / 100, dueDate: periodStart,
            status: existingInvoice.status === 'paid' ? 'paid' : 'pending',
            notes: `Security deposit · Unit ${unitNoLocal}`,
          });
        }
      }
      periodStart.setDate(periodStart.getDate() + 28);
      continue;
    }

    if (!existingPayment && !existingInvoice) {
      const effectiveEnd = periodEnd < contractEnd ? periodEnd : contractEnd;
      const totalDays = Math.round((effectiveEnd - periodStart) / 86400000);
      const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
      const daysSinceStart = Math.round((periodStart - contractStart) / 86400000);
      const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7));

      // Classify each week: chargeable vs. covered by the security deposit
      const weekDetails = [];
      for (let i = 0; i < totalWeeks; i++) {
        const globalIdx = globalWeekOffset + i;
        const discounted = discountPct > 0 && globalIdx < 4;
        const rate = discounted
          ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
          : weeklyRate;
        // Deposit coverage applies only when there is already at least one invoice (or one
        // has been generated this run), so a 1-month-only contract still charges rent normally.
        const coveredByDeposit = (generated > 0 || hasExistingInvoices) && globalIdx >= depositStartWeek;
        weekDetails.push({ i, globalIdx, rate, coveredByDeposit });
      }

      const chargeableWeeks = weekDetails.filter(w => !w.coveredByDeposit);
      const depositWeeks = weekDetails.filter(w => w.coveredByDeposit);
      const chargeableSubTotal = Math.round(chargeableWeeks.reduce((s, w) => s + w.rate, 0) * 100) / 100;
      const depositSubTotal = Math.round(depositWeeks.reduce((s, w) => s + w.rate, 0) * 100) / 100;
      const fullyByDeposit = chargeableWeeks.length === 0 && depositWeeks.length > 0;
      const hasDiscount = chargeableWeeks.some(w => w.globalIdx < 4) && discountPct > 0;

      const displayEnd = new Date(effectiveEnd); displayEnd.setDate(displayEnd.getDate() - 1);

      // Build invoice line items
      const items = [];

      if (fullyByDeposit) {
        // Entire period pre-paid by deposit — show rent + adjustment so balance = 0
        items.push({ sortOrder: 0, itemDetails: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · Unit ${unitNo}`, quantity: 1, rate: depositSubTotal, discountPct: 0, amount: depositSubTotal });
        items.push({ sortOrder: 1, itemDetails: `Security Deposit Adjustment · Unit ${unitNo}`, quantity: 1, rate: -depositSubTotal, discountPct: 0, amount: -depositSubTotal });
      } else {
        // Show only the chargeable date range (may be shorter than the full period)
        let chargeableEnd = effectiveEnd;
        if (depositWeeks.length > 0 && chargeableWeeks.length > 0) {
          const lastChargeableWeekIdx = chargeableWeeks[chargeableWeeks.length - 1].i;
          chargeableEnd = new Date(periodStart.getTime() + (lastChargeableWeekIdx + 1) * 7 * 86400000);
          if (chargeableEnd > contractEnd) chargeableEnd = contractEnd;
        }
        const chargeableDisplayEnd = new Date(chargeableEnd); chargeableDisplayEnd.setDate(chargeableDisplayEnd.getDate() - 1);
        // Use monthly rate (qty=1) so the invoice shows 625/mo not 4×156.25/wk
        const chargeableMonthlyRate = Math.round(chargeableWeeks.length * weeklyRate * 100) / 100;
        items.push({ sortOrder: 0, itemDetails: `Storage Rent ${fmt(periodStart)} – ${fmt(chargeableDisplayEnd)} · Unit ${unitNo}`, quantity: 1, rate: chargeableMonthlyRate, discountPct: hasDiscount ? discountPct : 0, amount: chargeableSubTotal });
      }

      // First invoice ever for this contract → add advance rent line for the deposit period
      if (!hasExistingInvoices && generated === 0) {
        // Show the PERIOD the deposit covers (last full 4-week period) rather than "Security Deposit"
        const depPeriodStart = new Date(contractStart.getTime() + depositStartWeek * 7 * 86400000);
        const depPeriodEnd   = new Date(depPeriodStart.getTime() + 28 * 86400000);
        const depPeriodDisplayEnd = new Date(depPeriodEnd.getTime() - 86400000);
        items.push({ sortOrder: items.length, itemDetails: `Advance Rent ${fmt(depPeriodStart)} – ${fmt(depPeriodDisplayEnd)} · Unit ${unitNo}`, quantity: 1, rate: monthlyRate, discountPct: 0, amount: monthlyRate });
      }

      // Double-check right before writing — closes the race window between concurrent requests
      const raceCheck = await Payment.findOne({
        contract: contract._id,
        invoice: { $ne: null },
        dueDate: { $gte: periodStart, $lt: periodEnd },
      });
      if (raceCheck) { periodStart.setDate(periodStart.getDate() + 28); continue; }

      const invoiceTotal = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
      const depositNotes = depositWeeks.length > 0 && (generated > 0 || hasExistingInvoices)
        ? (fullyByDeposit
          ? 'This invoice is fully covered by the security deposit paid in advance.'
          : `Security deposit covers the last ${depositWeeks.length} week${depositWeeks.length !== 1 ? 's' : ''} of this billing period.`)
        : '';

      const invoice = await Invoice.create({
        invoiceNo: await nextInvoiceNo(),
        customer: customerId,
        invoiceDate: new Date(),
        dueDate: periodStart,
        orderNumber: contract.contractNo,
        terms: 'Due on receipt',
        subject: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · ${contract.contractNo}`,
        items,
        customerNotes: depositNotes,
        subTotal: invoiceTotal,
        total: invoiceTotal,
        paymentMade: 0,
        status: fullyByDeposit ? 'paid' : 'sent',
        createdBy,
      });

      // One monthly payment record per invoice (not per week).
      // Fully-deposit-covered invoices (net 0) get no payment records.
      if (!fullyByDeposit && chargeableSubTotal > 0) {
        await Payment.create({
          contract: contract._id,
          invoice: invoice._id,
          amount: chargeableSubTotal,
          dueDate: periodStart,
          status: 'pending',
          notes: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · Unit ${unitNo}`,
          recordedBy: createdBy,
        });
      }

      // First invoice: also add one deposit payment record
      if (!hasExistingInvoices && generated === 0) {
        await Payment.create({
          contract: contract._id,
          invoice: invoice._id,
          amount: monthlyRate,
          dueDate: periodStart,
          status: 'pending',
          notes: `Security deposit · Unit ${unitNo}`,
          recordedBy: createdBy,
        });
      }

      generated++;
      // Stop after the deposit-covered period — any trailing partial weeks are absorbed by
      // the deposit (which equals a full month's rent and covers them).
      if (fullyByDeposit) break;
    }

    periodStart.setDate(periodStart.getDate() + 28);
  }

  return generated;
}

// Auto-generate missing period invoices for ALL active contracts
router.post('/auto-invoices', async (req, res) => {
  const monthsAhead = Math.min(Number(req.query.months) || 3, 12);
  const cutoff = new Date(Date.now() + monthsAhead * 30 * 86400000);

  const contracts = await Contract.find({ status: { $in: ['draft', 'pending_signature', 'active'] } })
    .populate('customer', 'fullName email')
    .populate('unit', 'unitNumber');

  let totalGenerated = 0;
  const results = [];
  const actor = req.user?.name || req.user?.email || '';
  for (const contract of contracts) {
    const n = await generateMissingPeriodInvoices(contract, cutoff, actor);
    if (n > 0) { results.push({ contractNo: contract.contractNo, generated: n }); totalGenerated += n; }
  }
  res.json({ generated: totalGenerated, results });
});

// Auto-generate missing period invoices for ONE contract (any non-cancelled status)
router.post('/:id/auto-invoices', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (['ended', 'cancelled'].includes(contract.status)) {
    return res.status(409).json({ error: 'Cannot generate invoices for an ended or cancelled contract' });
  }

  const monthsAhead = Math.min(Number(req.query.months) || 3, 12);
  const cutoff = new Date(Date.now() + monthsAhead * 30 * 86400000);

  const generated = await generateMissingPeriodInvoices(contract, cutoff);
  res.json({ generated });
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

export default router;
