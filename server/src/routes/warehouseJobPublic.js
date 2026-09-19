import { Router } from 'express';
import { WarehouseJob } from '../models/warehouse.js';
import { command, confirmJobPublicly } from '../services/warehouse.js';

// No auth: a delivery/pickup partner has no PurpleBox account. Reachable only
// with the unguessable confirmToken a staff member explicitly generated and
// shared (see /warehouse/jobs/:id/link) — see routes/warehouse.js for the
// authenticated side of that link's lifecycle.
const router = Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/:token', asyncRoute(async (req, res) => {
  const job = await WarehouseJob.findOne({ confirmToken: req.params.token }).populate('customer', 'fullName').lean();
  if (!job) return res.status(404).json({ error: 'Invalid or expired link.' });
  if (['COMPLETED', 'CANCELLED'].includes(job.status)) return res.json({ type: job.type, status: job.status, address: job.address, itemCount: job.containers.length });
  res.json({
    type: job.type, status: job.status, address: job.address, itemCount: job.containers.length,
    customerName: job.customer?.fullName || '',
  });
}));

router.post('/:token/confirm', asyncRoute(async (req, res) => {
  const job = await WarehouseJob.findOne({ confirmToken: req.params.token });
  if (!job) return res.status(404).json({ error: 'Invalid or expired link.' });
  const result = await command({ _id: job.createdBy }, req.body, 'PUBLIC_JOB_CONFIRM', ctx => confirmJobPublicly(ctx, job._id, req.body));
  res.json(result);
}));

router.use((error, _req, res, _next) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[warehouse-job-public]', error);
  res.status(status).json({ error: status === 500 ? 'Could not confirm — try again.' : error.message });
});

export default router;
