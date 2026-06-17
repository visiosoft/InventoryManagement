import { Router } from 'express';
import { Contract, Unit, Document } from '../models/index.js';
import { uploadFile } from '../services/drive.js';
import { fillAgreementPdf, agreementTemplateExists } from '../services/agreementPdf.js';
import { renderContractPdf } from '../services/contractPdf.js';
import { stampSignature } from '../services/stampSignature.js';

const router = Router();

function buildContractPdf(contract, signedDate) {
  const parts = { contract, customer: contract.customer, unit: contract.unit };
  return agreementTemplateExists()
    ? fillAgreementPdf({ ...parts, signedDate })
    : renderContractPdf(parts);
}

async function findByToken(token) {
  const contract = await Contract.findOne({ signingToken: token })
    .populate('customer')
    .populate('unit')
    .populate('units');
  if (!contract) return { error: 'Invalid or expired signing link', status: 404 };
  if (contract.signingTokenExpiry && new Date() > new Date(contract.signingTokenExpiry)) {
    return { error: 'This signing link has expired', status: 410 };
  }
  return { contract };
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
    .select('_id');
  if (upcoming) {
    await Unit.findByIdAndUpdate(unitId, { status: 'reserved' });
    return;
  }
  await Unit.findByIdAndUpdate(unitId, { status: 'available' });
}

// GET /api/sign/:token — contract info for the signing page
router.get('/:token', async (req, res) => {
  const { contract, error, status } = await findByToken(req.params.token);
  if (error) return res.status(status).json({ error });

  // A token on an active contract means admin has explicitly allowed re-signing
  const alreadySigned = !['draft', 'pending_signature', 'active'].includes(contract.status);
  res.json({
    contractNo: contract.contractNo,
    customerName: contract.customer?.fullName,
    startDate: contract.startDate,
    endDate: contract.endDate,
    rate: contract.rate,
    billingPeriod: contract.billingPeriod,
    deposit: contract.deposit,
    alreadySigned,
    expiresAt: contract.signingTokenExpiry,
  });
});

// GET /api/sign/:token/pdf — serve the unsigned contract PDF (no auth needed)
router.get('/:token/pdf', async (req, res) => {
  const { contract, error, status } = await findByToken(req.params.token);
  if (error) return res.status(status).json({ error });

  const pdf = await buildContractPdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
});

// POST /api/sign/:token — submit signature, activate contract
router.post('/:token', async (req, res) => {
  try {
    const { contract, error, status } = await findByToken(req.params.token);
    if (error) return res.status(status).json({ error });

    if (!['draft', 'pending_signature', 'active'].includes(contract.status)) {
      return res.status(409).json({ error: 'This contract cannot be signed in its current state' });
    }

    const { signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode } = req.body;
    if (!signerName?.trim()) return res.status(400).json({ error: 'Signer name is required' });

    const now = new Date();
    let pdfBuffer = await buildContractPdf(contract, now);
    pdfBuffer = await stampSignature(pdfBuffer, {
      signerName, signatureDataUrl, signMode,
      initialsText, initialsDataUrl, initialsMode,
      signedAt: now,
    });

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

    // Invalidate the signing token and activate the contract
    contract.status = 'active';
    contract.signedDocUrl = stored.url;
    contract.signingToken = null;
    contract.signingTokenExpiry = null;
    await contract.save();

    const unitIds = contract.units?.length
      ? contract.units.map((u) => u._id ?? u)
      : [contract.unit._id];
    await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));

    console.log(`✅ Contract ${contract.contractNo} signed remotely by ${signerName}`);

    res.json({ ok: true, contractNo: contract.contractNo, signedDocUrl: stored.url });
  } catch (err) {
    console.error('Remote sign error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
