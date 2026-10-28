import { Router } from 'express';
import { Customer, Contract, PiiReveal } from '../models/index.js';

/**
 * Showing one full identity number (WP-07). Admins only, with a reason from
 * a fixed list; every reveal writes an audit row.
 */
const router = Router();
const REASONS = ['verification', 'legal_request', 'customer_request'];

router.post('/reveal', async (req, res) => {
   if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can show full ID numbers' });
   const { kind, id, field, index, reason } = req.body || {};
   if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Say why', reasons: REASONS });
   let value = '';
   if (kind === 'customer') {
      const c = await Customer.findById(id).select('emiratesId passportNumber accessPersons').lean();
      if (!c) return res.status(404).json({ error: 'Not found' });
      value = field === 'person' ? c.accessPersons?.[Number(index)]?.idNumber : ['emiratesId', 'passportNumber'].includes(field) ? c[field] : '';
   } else if (kind === 'contract') {
      const c = await Contract.findById(id).select('authorizedPersons').lean();
      if (!c) return res.status(404).json({ error: 'Not found' });
      value = field === 'person' ? c.authorizedPersons?.[Number(index)]?.idNumber : '';
   } else return res.status(400).json({ error: 'Unknown record' });
   if (!value) return res.status(404).json({ error: 'No number stored' });
   await PiiReveal.create({ user: req.user.id, userName: req.user.name || req.user.email || '', kind, record: id, field, index: index ?? null, reason });
   res.json({ value });
});

export default router;
