import { Router } from 'express';
import { PushSubscription } from '../models/index.js';
import { publicKey, pushConfigured, pushToUser } from '../services/push.js';

const router = Router();

/** What the browser needs to subscribe, and whether it is worth asking. */
router.get('/key', (_req, res) => {
  res.json({ configured: pushConfigured(), publicKey: publicKey() });
});

/**
 * Register this browser.
 *
 * Keyed on the endpoint, which is unique per browser, so re-subscribing after
 * a permission prompt or a service-worker update updates the same row instead
 * of collecting duplicates that all push the same person at once.
 */
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'A complete subscription is required' });
    }

    const sub = await PushSubscription.findOneAndUpdate(
      { endpoint: String(endpoint) },
      {
        $set: {
          user: req.user.id,
          keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
          userAgent: String(req.get('user-agent') || '').slice(0, 300),
        },
      },
      { new: true, upsert: true },
    );

    res.status(201).json({ ok: true, id: sub._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Stop pushing to this browser. */
router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Which subscription?' });
    await PushSubscription.deleteOne({ endpoint, user: req.user.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Send one to yourself.
 *
 * The only honest way to know push works on a given browser: permission,
 * service worker, keys and network all have to line up, and any of them can be
 * fine in principle and broken in practice.
 */
router.post('/test', async (req, res) => {
  try {
    if (!pushConfigured()) return res.status(400).json({ error: 'Push is not configured on the server' });
    const out = await pushToUser(req.user.id, {
      title: 'PurpleBox',
      body: 'Push notifications are working.',
      url: '/my-leads',
    });
    if (out.sent === 0) {
      return res.status(400).json({ error: 'No browser is registered for you yet — turn notifications on first', ...out });
    }
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
