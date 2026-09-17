import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AuditLog } from '../models/index.js';

/**
 * Every create/update/delete across the app, written by
 * middleware/auditLog.js (plus a few hand-written richer entries for signing
 * — see services/documentSigning.js). Admin-only: who did what, from where,
 * is sensitive by nature.
 */
const router = Router();

router.use(requireAdmin);

const escRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res) => {
  const filter = {};

  if (req.query.entity) filter.entity = String(req.query.entity);
  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.user) filter.user = String(req.query.user);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.q) {
    const re = new RegExp(escRegex(req.query.q), 'i');
    filter.$or = [{ detail: re }, { entityId: re }, { path: re }, { userName: re }, { userEmail: re }];
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);

  const [rows, total, entities, actions] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
    // The entities/actions actually present, so the filter offers real
    // options rather than a hardcoded list that drifts from the data.
    AuditLog.distinct('entity'),
    AuditLog.distinct('action'),
  ]);

  res.json({
    data: rows,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    entities: entities.sort(),
    actions: actions.sort(),
  });
});

export default router;
