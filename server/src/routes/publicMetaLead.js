import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ingestMetaLead, normaliseIncoming } from '../services/metaLead.js';

/**
 * POST /api/public/meta-lead — saves a Meta (Facebook / Instagram) lead.
 *
 * No login, by request. What keeps it from being abused: a per-IP rate limit,
 * a phone number is required, one lead per number, and — if META_LEAD_KEY is
 * set in the environment — a matching `key` (query string or `x-api-key`
 * header) is required too. Leave META_LEAD_KEY unset to run it fully open.
 */
const router = Router();
const limiter = rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/', limiter, async (req, res) => {
  try {
    const need = process.env.META_LEAD_KEY;
    if (need && String(req.query.key || req.headers['x-api-key'] || '') !== need) return res.status(401).json({ error: 'Invalid key' });
    const fields = normaliseIncoming({ ...(req.body || {}) });
    if (!fields.phone) return res.status(400).json({ error: 'phone_number is required' });
    const out = await ingestMetaLead(fields, { channel: 'form' });
    if (out.error) return res.status(400).json({ error: out.error });
    res.status(out.created ? 201 : 200).json({ ok: true, id: out.lead._id, merged: !out.created });
  } catch (e) {
    console.error('[MetaLead]', e.message);
    res.status(500).json({ error: 'Could not save the lead' });
  }
});

// Meta's webhook verification handshake, in case it is pointed straight here.
router.get('/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && process.env.META_LEAD_VERIFY_TOKEN
    && req.query['hub.verify_token'] === process.env.META_LEAD_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.json({ ok: true, endpoint: 'POST JSON here: full_name, phone_number, email, plus any other answers' });
});

export default router;
