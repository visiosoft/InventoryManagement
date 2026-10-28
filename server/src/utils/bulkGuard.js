import { BulkBatch } from '../models/index.js';

/**
 * A change touching more than 20 records needs a reason and leaves a batch
 * row behind (WP-13), so a mass edit can be found and explained later.
 * Returns the batch id, or sends a 400 asking for the reason and returns null.
 */
export const BULK_LIMIT = 20;

export async function bulkGuard(req, res, { action, count }) {
   if (count <= BULK_LIMIT) return 'small';
   const reason = String(req.body?.batchReason || '').trim();
   if (reason.length < 3) {
      res.status(400).json({ error: `This changes ${count} records. Give a reason for the batch.`, code: 'batch_reason_required', count });
      return null;
   }
   const b = await BulkBatch.create({ action, count, reason: reason.slice(0, 300), user: req.user?.id || null, userName: req.user?.name || req.user?.email || '' });
   return String(b._id);
}
