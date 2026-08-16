import { Router } from 'express';
import { MovingJob, MovingDocument } from '../models/index.js';
import { uploadFile } from '../services/drive.js';
import { buildMovingJobPdf, buildSignedMovingJobPdf } from '../services/movingJobDocument.js';

const router = Router();

async function findByToken(token) {
  const job = await MovingJob.findOne({ signingToken: token }).populate('customer');
  if (!job) return { error: 'Invalid or expired signing link', status: 404 };
  if (job.signingTokenExpiry && new Date() > new Date(job.signingTokenExpiry)) {
    return { error: 'This signing link has expired', status: 410 };
  }
  return { job };
}

// GET /api/sign-moving/:token — job info for the signing page
router.get('/:token', async (req, res) => {
  const { job, error, status } = await findByToken(req.params.token);
  if (error) return res.status(status).json({ error });

  res.json({
    jobNo: job.jobNo,
    customerName: job.customer?.fullName,
    scheduledDate: job.scheduledDate,
    pickupAddress: job.pickupAddress,
    deliveryAddress: job.deliveryAddress,
    quotedPrice: job.clientPackage?.agreedPrice || job.costs?.total || 0,
    alreadySigned: !!job.signedDocUrl,
    expiresAt: job.signingTokenExpiry,
  });
});

// GET /api/sign-moving/:token/pdf — serve the unsigned agreement PDF
router.get('/:token/pdf', async (req, res) => {
  const { job, error, status } = await findByToken(req.params.token);
  if (error) return res.status(status).json({ error });

  const pdf = await buildMovingJobPdf(job);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${job.jobNo}.pdf"`);
  res.send(pdf);
});

// POST /api/sign-moving/:token — submit signature, archive the signed copy
router.post('/:token', async (req, res) => {
  try {
    const { job, error, status } = await findByToken(req.params.token);
    if (error) return res.status(status).json({ error });

    const { signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode } = req.body;
    if (!signerName?.trim()) return res.status(400).json({ error: 'Signer name is required' });

    const now = new Date();
    const pdfBuffer = await buildSignedMovingJobPdf(job, now, {
      signerName, signatureDataUrl, signMode,
      initialsText, initialsDataUrl, initialsMode,
    });

    const stored = await uploadFile({
      buffer: pdfBuffer,
      filename: `${job.jobNo}-signed.pdf`,
      mimeType: 'application/pdf',
      customerName: job.customer?.fullName,
    });

    await MovingDocument.create({
      job: job._id,
      customer: job.customer?._id,
      name: `${job.jobNo} — signed moving agreement`,
      type: 'contract',
      ...stored,
    });

    job.signedDocUrl = stored.url;
    job.signingToken = null;
    job.signingTokenExpiry = null;
    job.timeline.push({ at: now, text: `Moving agreement signed remotely by ${signerName}`, author: 'Customer' });
    await job.save();

    res.json({ ok: true, jobNo: job.jobNo, signedDocUrl: stored.url });
  } catch (err) {
    console.error('Remote moving sign error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
