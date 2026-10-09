import { Router } from 'express';
import { Merchant, ShopifyWebhookEvent } from '../models/shopify.js';
import { verifyShopifySignature, webhookSecretFor } from '../services/shopify.js';
import { ingestOrderWebhook } from '../services/shopifyFulfillment.js';

/* Shopify order webhooks. No JWT — every request is authenticated by its
 * HMAC instead, checked against the raw bytes, which is why index.js mounts
 * this with express.raw() ahead of the global JSON parser.
 *
 * Shopify wants a 2xx within five seconds and retries anything else for 48
 * hours, so: a bad signature or unknown store is a 401 (never retried into
 * success), a processing failure is a 500 (retried), and a delivery we have
 * already handled is acknowledged without being processed twice. */
const router = Router();
const TOPICS = new Set(['orders/create', 'orders/updated', 'orders/cancelled']);

router.post('/', async (req, res) => {
  const shopDomain = String(req.get('X-Shopify-Shop-Domain') || '').toLowerCase();
  const topic = String(req.get('X-Shopify-Topic') || '');
  const webhookId = String(req.get('X-Shopify-Webhook-Id') || '');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;

  const merchant = shopDomain ? await Merchant.findOne({ shopDomain }).catch(() => null) : null;
  if (!merchant || !rawBody) return res.status(401).end();
  const secret = await webhookSecretFor(merchant).catch(() => '');
  if (!verifyShopifySignature(req.get('X-Shopify-Hmac-Sha256'), rawBody, secret)) return res.status(401).end();

  // Inactive stores and topics we don't handle are acknowledged, not
  // rejected — a 4xx would only make Shopify keep retrying.
  if (!merchant.isActive || !TOPICS.has(topic)) return res.status(200).end();
  if (webhookId && await ShopifyWebhookEvent.exists({ _id: webhookId })) return res.status(200).json({ duplicate: true });

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return res.status(400).end(); }

  try {
    const result = await ingestOrderWebhook(merchant, topic, payload);
    if (webhookId) {
      await ShopifyWebhookEvent.create({ _id: webhookId, merchant: merchant._id, topic }).catch(e => {
        if (e.code !== 11000) throw e;
      });
    }
    res.status(200).json(result);
  } catch (e) {
    console.error(`[Shopify webhook] ${shopDomain} ${topic}:`, e.message);
    res.status(500).end();
  }
});

export default router;
