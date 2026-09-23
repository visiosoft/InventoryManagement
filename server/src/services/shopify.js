import crypto from 'node:crypto';
import axios from 'axios';
import { Merchant } from '../models/shopify.js';
import { encrypt, decrypt } from '../utils/crypto.js';

/* Shopify's Admin API surface has been shifting from REST to GraphQL for
 * parts of what this file does (inventory adjustment, fulfillment creation
 * in particular). The REST endpoints below are what's documented as of this
 * writing, but confirm against Shopify's current API docs before relying on
 * them in production — if REST has been removed for a given operation by
 * the time this runs, that call needs to become a GraphQL mutation instead
 * (fulfillmentCreateV2 / inventorySetQuantities are the likely replacements).
 * Same caution applies to the hardcoded default apiVersion below — Shopify
 * retires API versions on a rolling schedule. */
const DEFAULT_API_VERSION = '2025-01';

export function merchantConfigured(merchant) {
  return Boolean(merchant?.isActive && merchant?.shopDomain);
}

// One axios instance per merchant, rebuilt if the stored (encrypted) token
// changes — same "cached, recreated on change" shape as services/stripe.js's
// getClient(), just keyed per merchant instead of being a single global.
const clientCache = new Map(); // merchantId -> { client, tokenFingerprint }

/** Loads a merchant (with its encrypted secrets) and returns a ready-to-use
 *  axios client authenticated as that store. Throws if the merchant is
 *  missing or inactive — callers should not silently no-op on either. */
export async function getClientForMerchant(merchantId) {
  const merchant = await Merchant.findById(merchantId).select(
    '+adminApiAccessTokenEnc +adminApiAccessTokenIv +adminApiAccessTokenTag shopDomain apiVersion isActive'
  );
  if (!merchant) throw new Error('Merchant not found');
  if (!merchant.isActive) throw new Error('Merchant is not active');

  const fingerprint = merchant.adminApiAccessTokenEnc;
  const cached = clientCache.get(merchantId);
  if (cached && cached.tokenFingerprint === fingerprint) return cached.client;

  const token = decrypt(merchant.adminApiAccessTokenEnc, merchant.adminApiAccessTokenIv, merchant.adminApiAccessTokenTag);
  const client = axios.create({
    baseURL: `https://${merchant.shopDomain}/admin/api/${merchant.apiVersion || DEFAULT_API_VERSION}`,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    timeout: 15_000,
  });
  clientCache.set(merchantId, { client, tokenFingerprint: fingerprint });
  return client;
}

/** Drops a merchant's cached client — call after rotating its token so the
 *  next request picks up the new one instead of an axios instance built
 *  with the old one still in its headers. */
export function forgetMerchantClient(merchantId) {
  clientCache.delete(merchantId);
}

/** Encrypts a plaintext access token/webhook secret pair into the three
 *  fields each is stored as, ready to assign directly onto a Merchant doc. */
export function encryptMerchantSecret(plaintext) {
  const { ciphertext, iv, tag } = encrypt(plaintext);
  return { enc: ciphertext, iv, tag };
}

/** Cheap validation call before saving a new/updated token — mirrors
 *  services/stripe.js's verifyStripeKey(). Throws with a readable message on
 *  failure rather than returning a bare boolean, so the route can surface it. */
export async function verifyShopifyToken(shopDomain, accessToken, apiVersion = DEFAULT_API_VERSION) {
  try {
    const { data } = await axios.get(`https://${shopDomain}/admin/api/${apiVersion}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
      timeout: 10_000,
    });
    return { ok: true, shopName: data?.shop?.name || shopDomain };
  } catch (e) {
    const status = e.response?.status;
    if (status === 401 || status === 403) throw new Error('That access token was rejected by Shopify — check it was copied correctly.');
    if (status === 404) throw new Error('That shop domain was not found — check it ends in .myshopify.com.');
    throw new Error(`Could not reach Shopify: ${e.message}`);
  }
}

/** Shopify signs webhooks with HMAC-SHA256 over the raw body, base64-encoded
 *  in the X-Shopify-Hmac-Sha256 header — same shape as
 *  services/whatsapp.js's verifyWhatsAppSignature, but base64 not hex. */
export function verifyShopifySignature(hmacHeaderBase64, rawBodyBuffer, webhookSecret) {
  if (!webhookSecret || !hmacHeaderBase64 || !rawBodyBuffer) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBodyBuffer).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'base64'), Buffer.from(hmacHeaderBase64, 'base64'));
  } catch {
    return false;
  }
}

/** Paginated pull of every product + variant, with each variant's
 *  inventory_item_id (needed later for inventory level calls). Used for the
 *  initial SKU sync and to pick up new/renamed/discontinued products on
 *  reconciliation. REST `products.json` — see the file-level REST/GraphQL
 *  caution above. */
export async function fetchProductsAndVariants(merchantId) {
  const client = await getClientForMerchant(merchantId);
  const variants = [];
  let pageInfo = null;
  do {
    const { data, headers } = await client.get('/products.json', {
      params: { limit: 250, ...(pageInfo ? { page_info: pageInfo } : {}) },
    });
    for (const product of data.products || []) {
      for (const variant of product.variants || []) {
        variants.push({
          shopifyProductId: String(product.id),
          shopifyVariantId: String(variant.id),
          sku: variant.sku || '',
          productTitle: product.title || '',
          variantTitle: variant.title || '',
          barcode: variant.barcode || '',
          shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : '',
        });
      }
    }
    // Shopify's REST pagination is cursor-based via the Link header, not a
    // page number — parse the `next` rel if present.
    const link = headers?.link || headers?.Link || '';
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    pageInfo = match ? new URL(match[1]).searchParams.get('page_info') : null;
  } while (pageInfo);
  return variants;
}

/** Current on-hand quantities for a merchant's Shopify location(s). Called
 *  by the Phase-C reconciliation poll, not a webhook — see the plan's
 *  design-decision note on why inventory sync is pull-based here. */
export async function fetchInventoryLevels(merchantId, shopifyLocationId, inventoryItemIds) {
  const client = await getClientForMerchant(merchantId);
  const { data } = await client.get('/inventory_levels.json', {
    params: {
      location_ids: String(shopifyLocationId),
      inventory_item_ids: inventoryItemIds.join(','),
      limit: 250,
    },
  });
  return data.inventory_levels || [];
}

/** Pushes a Fulfillment (with tracking) onto an order once a FulfillmentJob
 *  ships — Phase B. Not called anywhere yet in Phase A. */
export async function createFulfillment(merchantId, shopifyOrderId, { trackingNumber, trackingCompany, lineItems, notifyCustomer = true }) {
  const client = await getClientForMerchant(merchantId);
  const { data } = await client.post(`/orders/${shopifyOrderId}/fulfillments.json`, {
    fulfillment: {
      tracking_number: trackingNumber,
      tracking_company: trackingCompany,
      line_items: lineItems,
      notify_customer: notifyCustomer,
    },
  });
  return data.fulfillment;
}

/** Adjusts Shopify's own stock after a pick/pack/ship consumes PurpleBox
 *  stock — Phase C. Not called anywhere yet in Phase A. */
export async function adjustInventoryLevel(merchantId, inventoryItemId, shopifyLocationId, delta) {
  const client = await getClientForMerchant(merchantId);
  const { data } = await client.post('/inventory_levels/adjust.json', {
    location_id: shopifyLocationId,
    inventory_item_id: inventoryItemId,
    available_adjustment: delta,
  });
  return data.inventory_level;
}
