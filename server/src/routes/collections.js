import { Router } from 'express';
import { collectionsList, setStage, setDispute, addPromise, logContact } from '../services/collections.js';
import { MANUAL_STATES } from '../models/collections.js';
import { CollectionAccount, PromiseToPay } from '../models/collections.js';

/** Collections (WP-21): who owes, at what stage, and what was agreed. Admins and accounts. */
const router = Router();
const FINANCE = ['admin', 'accounts_admin'];
router.use((req, res, next) => (FINANCE.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Collections are for finance' })));
const by = (req) => req.user?.name || req.user?.email || '';
const CHANNELS = ['call', 'whatsapp', 'email', 'in_person'];

router.get('/', async (_req, res) => res.json(await collectionsList()));

router.get('/:contractId', async (req, res) => {
   const [account, promises] = await Promise.all([
      CollectionAccount.findOne({ contract: req.params.contractId }).lean(),
      PromiseToPay.find({ contract: req.params.contractId }).sort({ createdAt: -1 }).limit(20).lean(),
   ]);
   res.json({ account, promises });
});

router.post('/:contractId/promise', async (req, res) => {
   const amount = Number(req.body?.amount);
   const date = new Date(`${req.body?.promisedDate}T23:59:59+04:00`);
   if (!(amount > 0)) return res.status(400).json({ error: 'How much did they promise?' });
   if (Number.isNaN(date.getTime()) || date < new Date(Date.now() - 86_400_000)) return res.status(400).json({ error: 'Pick the promised date (today or later)' });
   const channel = CHANNELS.includes(req.body?.channel) ? req.body.channel : 'call';
   res.status(201).json({ promise: await addPromise(req.params.contractId, { amount, promisedDate: date, channel, note: String(req.body?.note || '').slice(0, 500), by: by(req) }) });
});

router.post('/:contractId/stage', async (req, res) => {
   const state = String(req.body?.state || '');
   if (state && !MANUAL_STATES.includes(state)) return res.status(400).json({ error: 'Unknown stage', stages: MANUAL_STATES });
   if (state === 'written_off' && String(req.body?.note || '').trim().length < 5) return res.status(400).json({ error: 'Say why it is written off' });
   await setStage(req.params.contractId, { state, note: String(req.body?.note || '').slice(0, 500), by: by(req) });
   res.json({ ok: true });
});

router.post('/:contractId/dispute', async (req, res) => {
   await setDispute(req.params.contractId, { disputed: Boolean(req.body?.disputed), note: String(req.body?.note || '').slice(0, 500), by: by(req) });
   res.json({ ok: true });
});

router.post('/:contractId/contact', async (req, res) => {
   const channel = CHANNELS.includes(req.body?.channel) ? req.body.channel : 'call';
   const note = String(req.body?.note || '').trim().slice(0, 500);
   if (!note) return res.status(400).json({ error: 'What was said?' });
   await logContact(req.params.contractId, { channel, note, by: by(req) });
   res.json({ ok: true });
});

export default router;
