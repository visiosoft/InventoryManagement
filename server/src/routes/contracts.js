import { Router } from 'express';
import crypto from 'crypto';
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
  const contracts = await populateAll(Contract.find(filter)).sort({ createdAt: -1 });
  res.json(contracts);
});

router.get('/:id', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const payments = await Payment.find({ contract: contract._id })
    .populate('invoice', 'invoiceNo status dueDate total')
    .sort({ dueDate: 1 });
  const documents = await Document.find({ contract: contract._id }).sort({ createdAt: -1 });
  res.json({ contract, payments, documents });
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
  contract.status = status;
  await contract.save();
  await Payment.deleteMany({ contract: contract._id, status: 'pending', dueDate: { $gt: new Date() } });

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

// Delete a contract and all its payments / documents.
// Active contracts cannot be deleted — end or cancel them first.
router.delete('/:id', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'active') {
    return res.status(409).json({ error: 'Cannot delete an active contract. End or cancel it first.' });
  }
  const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Payment.deleteMany({ contract: contract._id });
  await Document.deleteMany({ contract: contract._id });
  await contract.deleteOne();
  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
  res.json({ ok: true });
});

// ── Auto-invoice generator ────────────────────────────────────────────────────
// Walks 4-week periods from contract start, skips periods that already have an
// invoiced payment, creates Invoice + Payment records for the rest.
async function generateMissingPeriodInvoices(contract, cutoffDate) {
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const contractStart = new Date(contract.startDate);
  const contractEnd   = new Date(contract.endDate);
  const cutoff        = cutoffDate || new Date(Date.now() + 90 * 86400000); // default 3 months ahead
  const until         = contractEnd < cutoff ? contractEnd : cutoff;

  const monthlyRate  = Number(contract.rate || 0);
  const weeklyRate   = Math.round((monthlyRate / 4) * 100) / 100;
  const unitNo       = contract.unit?.unitNumber || '-';
  const customerId   = contract.customer?._id || contract.customer;

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

  let generated = 0;
  const periodStart = new Date(contractStart);

  while (periodStart < until) {
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 28);

    // Skip if any invoiced payment already exists in this window
    const exists = await Payment.findOne({
      contract: contract._id,
      invoice: { $ne: null },
      dueDate: { $gte: periodStart, $lt: periodEnd },
    });

    if (!exists) {
      const effectiveEnd  = periodEnd < contractEnd ? periodEnd : contractEnd;
      const totalDays     = Math.round((effectiveEnd - periodStart) / 86400000);
      const totalWeeks    = Math.max(1, Math.ceil(totalDays / 7));
      const daysSinceStart   = Math.round((periodStart - contractStart) / 86400000);
      const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7));

      const items = [];
      for (let i = 0; i < totalWeeks; i++) {
        const ws = new Date(periodStart);
        ws.setDate(ws.getDate() + i * 7);
        const discounted = discountPct > 0 && (globalWeekOffset + i) < 4;
        const amount = discounted
          ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
          : weeklyRate;
        items.push({
          sortOrder: i,
          itemDetails: `Week ${globalWeekOffset + i + 1}: ${fmt(ws)} · Unit ${unitNo}`,
          quantity: 1, rate: weeklyRate,
          discountPct: discounted ? discountPct : 0,
          amount,
        });
      }

      const subTotal = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
      const displayEnd = new Date(effectiveEnd); displayEnd.setDate(displayEnd.getDate() - 1);

      // Double-check right before writing — closes the race window between concurrent requests
      const raceCheck = await Payment.findOne({
        contract: contract._id,
        invoice: { $ne: null },
        dueDate: { $gte: periodStart, $lt: periodEnd },
      });
      if (raceCheck) { periodStart.setDate(periodStart.getDate() + 28); continue; }

      const invoice = await Invoice.create({
        invoiceNo: await nextInvoiceNo(),
        customer: customerId,
        invoiceDate: new Date(),
        dueDate: periodStart,
        orderNumber: contract.contractNo,
        terms: 'Due on receipt',
        subject: `Storage Rent ${fmt(periodStart)} – ${fmt(displayEnd)} · ${contract.contractNo}`,
        items,
        customerNotes: '',
        subTotal, total: subTotal, paymentMade: 0, status: 'sent',
      });

      await Payment.insertMany(items.map((_item, i) => {
        const ws = new Date(periodStart); ws.setDate(ws.getDate() + i * 7);
        return {
          contract: contract._id,
          invoice: invoice._id,
          amount: items[i].amount,
          dueDate: ws,
          status: periodStart <= new Date() ? 'pending' : 'pending',
          notes: items[i].itemDetails,
        };
      }));

      generated++;
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
  for (const contract of contracts) {
    const n = await generateMissingPeriodInvoices(contract, cutoff);
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

  const start       = new Date(startDate);
  const end         = new Date(endDate);
  const totalDays   = Math.round((end - start) / 86400000);
  if (totalDays <= 0) return res.status(400).json({ error: 'End date must be after start date' });

  // rate is monthly price; weekly payment = rate / 4. Ceiling: any leftover day = full week.
  const monthlyRate  = Number(contract.rate || 0);
  const weeklyRate   = Math.round((monthlyRate / 4) * 100) / 100;
  const totalWeeks   = Math.ceil(totalDays / 7);
  const discountPct  = Math.max(0, Math.min(100, Number(rawDiscount || 0)));

  // Global week offset from contract start → discount only applies to first 4 weeks of entire contract.
  const contractStart   = new Date(contract.startDate);
  const daysSinceStart  = Math.round((start - contractStart) / 86400000);
  const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7));

  const items = [];
  for (let i = 0; i < totalWeeks; i++) {
    const ws = new Date(start); ws.setDate(ws.getDate() + i * 7);
    const discounted = discountPct > 0 && (globalWeekOffset + i) < 4;
    const amount = discounted
      ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
      : weeklyRate;
    items.push({
      sortOrder: i,
      itemDetails: `Week ${i + 1}: ${fmt(ws)} · Unit ${unitNo}`,
      quantity: 1,
      rate: weeklyRate,
      discountPct: discounted ? discountPct : 0,
      amount,
    });
  }

  // Append any extra charges / credits (locks, cleaning fees, credits, etc.)
  const extras = Array.isArray(rawExtras) ? rawExtras : [];
  extras.forEach((x, xi) => {
    if (!x.description || !Number(x.amount)) return;
    const amt = Math.round(Number(x.amount) * 100) / 100;
    const signed = x.type === 'credit' ? -amt : amt;
    items.push({
      sortOrder: totalWeeks + xi,
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
    subject: `Storage Rent ${fmt(start)} – ${fmt(new Date(end - 86400000))} · ${contract.contractNo}`,
    items,
    customerNotes: notes || '',
    subTotal, total: subTotal, paymentMade: 0, status: 'sent',
  });

  // Create one Payment entry per week, each linked to this invoice
  await Payment.insertMany(items.map((item, i) => {
    const ws = new Date(start); ws.setDate(ws.getDate() + i * 7);
    return {
      contract: contract._id,
      invoice: invoice._id,
      amount: item.amount,
      dueDate: ws,
      status: 'pending',
      notes: item.itemDetails,
    };
  }));

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
