import { Router } from 'express';
import { Contract, Customer, Unit, Payment, Document, nextContractNo } from '../models/index.js';
import { generateSchedule } from '../services/schedule.js';
import { sendForSignature, downloadSignedPdf, zohoConfigured } from '../services/zoho.js';
import { uploadFile } from '../services/drive.js';
import { renderContractPdf } from '../services/contractPdf.js';

const router = Router();

const populateAll = (q) =>
  q.populate('customer').populate({ path: 'unit', populate: 'unitType' });

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.customer) filter.customer = req.query.customer;
  const contracts = await populateAll(Contract.find(filter)).sort({ createdAt: -1 });
  res.json(contracts);
});

router.get('/:id', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const payments = await Payment.find({ contract: contract._id }).sort({ dueDate: 1 });
  const documents = await Document.find({ contract: contract._id }).sort({ createdAt: -1 });
  res.json({ contract, payments, documents });
});

// Create a contract (draft). Generates the payment schedule and reserves the unit.
router.post('/', async (req, res) => {
  const { customer, unit, billingPeriod, rate, deposit, startDate, endDate, autoRenew, notes } = req.body;

  const unitDoc = await Unit.findById(unit);
  if (!unitDoc) return res.status(404).json({ error: 'Unit not found' });
  const open = await Contract.exists({ unit, status: { $in: ['draft', 'pending_signature', 'active'] } });
  if (open) return res.status(409).json({ error: `Unit ${unitDoc.unitNumber} already has an open contract` });
  if (new Date(endDate) <= new Date(startDate)) {
    return res.status(400).json({ error: 'End date must be after start date' });
  }

  const contract = await Contract.create({
    contractNo: await nextContractNo(),
    customer, unit, billingPeriod, rate, deposit, startDate, endDate, autoRenew, notes,
    status: 'draft',
  });

  const schedule = generateSchedule({ startDate, endDate, billingPeriod, rate });
  await Payment.insertMany(schedule.map((p) => ({ ...p, contract: contract._id })));

  unitDoc.status = 'reserved';
  await unitDoc.save();

  res.status(201).json(await populateAll(Contract.findById(contract._id)));
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

  const pdfBuffer = await renderContractPdf({
    contract,
    customer: contract.customer,
    unit: contract.unit,
    unitType: contract.unit.unitType,
  });

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

  // Archive the signed PDF (real Zoho download, or regenerate locally in mock mode).
  let pdfBuffer = null;
  if (zohoConfigured() && contract.zohoRequestId && !contract.zohoRequestId.startsWith('MOCK-')) {
    pdfBuffer = await downloadSignedPdf(contract.zohoRequestId);
  }
  if (!pdfBuffer) {
    pdfBuffer = await renderContractPdf({
      contract,
      customer: contract.customer,
      unit: contract.unit,
      unitType: contract.unit.unitType,
    });
  }
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
  await Unit.findByIdAndUpdate(contract.unit._id, { status: 'occupied' });
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
    if (contract) await markSigned(contract._id).catch(() => {});
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
  contract.status = 'active';
  await contract.save();
  await Unit.findByIdAndUpdate(contract.unit, { status: 'occupied' });
  res.json(await populateAll(Contract.findById(contract._id)));
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
  await Unit.findByIdAndUpdate(contract.unit, { status: 'available' });
  await Payment.deleteMany({ contract: contract._id, status: 'pending', dueDate: { $gt: new Date() } });
  res.json(await populateAll(Contract.findById(contract._id)));
}

router.post('/:id/end', (req, res) => closeContract(req, res, 'ended'));
router.post('/:id/cancel', (req, res) => closeContract(req, res, 'cancelled'));

// Download the (unsigned) contract PDF.
router.get('/:id/pdf', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const pdf = await renderContractPdf({
    contract,
    customer: contract.customer,
    unit: contract.unit,
    unitType: contract.unit.unitType,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
});

export default router;
