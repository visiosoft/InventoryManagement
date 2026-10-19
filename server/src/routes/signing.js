import { Router } from 'express';
import { Contract, Payment } from '../models/index.js';
import { buildContractPdf } from '../services/contractDocument.js';
import { signContract } from '../services/contractSigning.js';

const router = Router();

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


// GET /api/sign/:token — contract info for the signing page
router.get('/:token', async (req, res) => {
  const { contract, error, status } = await findByToken(req.params.token);
  if (error) return res.status(status).json({ error });

  // Sum all payments due on the earliest due date — that is the true first invoice total
  const firstPayment = await Payment.findOne({ contract: contract._id }).sort({ dueDate: 1 }).lean();
  let firstInvoiceTotal = null;
  if (firstPayment) {
    const sameDayPayments = await Payment.find({
      contract: contract._id,
      dueDate: firstPayment.dueDate,
    }).lean();
    firstInvoiceTotal = sameDayPayments.reduce((s, p) => s + (p.amount || 0), 0);
  }

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
    firstInvoiceTotal,
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

    const result = await signContract({ contract, body: req.body, req });
    console.log(`✅ Contract ${contract.contractNo} signed remotely by ${req.body.signerName}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (!err.status) console.error('Remote sign error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
