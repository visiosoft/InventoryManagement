import crypto from 'node:crypto';
import axios from 'axios';
import { Merchant } from '../models/shopify.js';
import { encrypt, decrypt } from '../utils/crypto.js';

/* Everything here talks to Shopify's GraphQL Admin API. The REST endpoints
 * Phase A sketched (orders/{id}/fulfillments.json, inventory_levels/adjust)
 * are legacy: fulfillment now goes through fulfillment orders, and stock is
 * written with inventorySetQuantities.
 *
 * Shopify supports each API version for about a year. A merchant saved with
 * an older version is moved up to DEFAULT_API_VERSION rather than left to
 * fall off the end — the inventory mutation below changed shape in 2026-04,
 * and only the newer shape is handled. */
export const DEFAULT_API_VERSION = '2026-07';
const effectiveVersion = v => (v && v > DEFAULT_API_VERSION ? v : DEFAULT_API_VERSION);

/* What the merchant's app must be granted. Shown on the connect form so the
 * person setting the app up in Shopify ticks the right boxes. */
export const REQUIRED_SCOPES = [
  'read_products', 'read_orders', 'read_locations', 'read_inventory', 'write_inventory',
  'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders',
  'read_assigned_fulfillment_orders', 'write_assigned_fulfillment_orders',
];

const SECRET_FIELDS = '+adminApiAccessTokenEnc +adminApiAccessTokenIv +adminApiAccessTokenTag '
  + '+clientSecretEnc +clientSecretIv +clientSecretTag +webhookSecretEnc +webhookSecretIv +webhookSecretTag';

export const gid = (type, id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);
export const numericId = id => String(id).split('/').pop();

/** Encrypts a plaintext secret into the three fields each is stored as. */
export function encryptMerchantSecret(plaintext) {
  const { ciphertext, iv, tag } = encrypt(plaintext);
  return { enc: ciphertext, iv, tag };
}

const readSecret = (m, prefix) => (m[`${prefix}Enc`] ? decrypt(m[`${prefix}Enc`], m[`${prefix}Iv`], m[`${prefix}Tag`]) : '');

/** Strips every encrypted field before a merchant goes back to the browser. */
export function safeMerchant(merchant) {
  const out = typeof merchant.toObject === 'function' ? merchant.toObject() : { ...merchant };
  for (const prefix of ['adminApiAccessToken', 'clientSecret', 'webhookSecret']) {
    delete out[`${prefix}Enc`]; delete out[`${prefix}Iv`]; delete out[`${prefix}Tag`];
  }
  return out;
}

/* Client-credentials tokens last 24 hours. Cached per merchant and refreshed
 * five minutes early; keyed on the stored secret so rotating it takes effect
 * on the next call. */
const tokenCache = new Map(); // merchantId -> { token, expiresAt, fingerprint }

async function exchangeClientCredentials(shopDomain, clientId, clientSecret) {
  try {
    const { data } = await axios.post(
      `https://${shopDomain}/admin/oauth/access_token`,
      new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
    if (!data?.access_token) throw new Error('Shopify returned no access token.');
    return { token: data.access_token, expiresIn: Number(data.expires_in) || 86_399 };
  } catch (e) {
    const status = e.response?.status;
    if (status === 400 || status === 401 || status === 403) {
      throw new Error('Shopify rejected that client ID/secret. Check both were copied from the Dev Dashboard, and that the app is installed on this store and belongs to the same organization.');
    }
    if (status === 404) throw new Error('That shop domain was not found — check it ends in .myshopify.com.');
    throw new Error(`Could not reach Shopify: ${e.message}`);
  }
}

async function accessTokenFor(merchant) {
  if (merchant.authMode !== 'client_credentials') return readSecret(merchant, 'adminApiAccessToken');
  const key = String(merchant._id);
  const fingerprint = merchant.clientSecretEnc;
  const cached = tokenCache.get(key);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const { token, expiresIn } = await exchangeClientCredentials(merchant.shopDomain, merchant.clientId, readSecret(merchant, 'clientSecret'));
  tokenCache.set(key, { token, expiresAt: Date.now() + expiresIn * 1000, fingerprint });
  return token;
}

/** Drops a merchant's cached token — call after rotating its credentials. */
export function forgetMerchantClient(merchantId) {
  tokenCache.delete(String(merchantId));
}

async function loadMerchant(merchantOrId) {
  const id = typeof merchantOrId === 'object' ? merchantOrId._id : merchantOrId;
  const merchant = await Merchant.findById(id).select(SECRET_FIELDS);
  if (!merchant) throw new Error('Merchant not found');
  return merchant;
}

/** Shopify's error responses come in several shapes; this flattens them into
 *  one readable sentence for the UI and the job's push-error field. */
function describeGraphqlErrors(errors) {
  return (errors || []).map(e => e.message).filter(Boolean).join('; ') || 'Unknown Shopify error';
}

async function postGraphql(shopDomain, apiVersion, token, query, variables) {
  return axios.post(
    `https://${shopDomain}/admin/api/${effectiveVersion(apiVersion)}/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, timeout: 20_000 },
  );
}

/**
 * Runs one GraphQL Admin call as a merchant. Throttling is retried a few
 * times (Shopify's cost-based limit refills within seconds); anything else
 * throws with Shopify's own message.
 */
export async function shopifyGraphql(merchantOrId, query, variables = {}) {
  const merchant = await loadMerchant(merchantOrId);
  if (!merchant.isActive) throw new Error('Merchant is not active');
  for (let attempt = 0; ; attempt += 1) {
    const token = await accessTokenFor(merchant);
    let res;
    try {
      res = await postGraphql(merchant.shopDomain, merchant.apiVersion, token, query, variables);
    } catch (e) {
      const status = e.response?.status;
      // A client-credentials token can be revoked early (app reinstalled,
      // secret rotated in Shopify). Fetch a fresh one once before giving up.
      if (status === 401 && merchant.authMode === 'client_credentials' && attempt === 0) {
        forgetMerchantClient(merchant._id);
        continue;
      }
      if (status === 429 && attempt < 3) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      if (status === 401 || status === 403) throw new Error('Shopify rejected this store\'s credentials — reconnect it from the Merchants page.');
      throw new Error(`Shopify request failed: ${e.response?.data?.errors ? describeGraphqlErrors([].concat(e.response.data.errors)) : e.message}`);
    }
    const { data, errors } = res.data || {};
    if (errors?.length) {
      if (errors.some(e => e.extensions?.code === 'THROTTLED') && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Shopify: ${describeGraphqlErrors(errors)}`);
    }
    return data;
  }
}

/** Throws with a readable message if a mutation came back with userErrors. */
function assertNoUserErrors(payload, what) {
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(`${what}: ${errs.map(e => e.message).join('; ')}`);
}

/**
 * Checks credentials before they are saved: gets a token (client-credentials
 * stores) and reads the shop's name. Returns the token so the caller can use
 * it straight away without exchanging the secret twice.
 */
export async function verifyShopifyCredentials({ shopDomain, authMode, accessToken, clientId, clientSecret, apiVersion }) {
  let token = accessToken;
  if (authMode === 'client_credentials') {
    ({ token } = await exchangeClientCredentials(shopDomain, clientId, clientSecret));
  }
  try {
    const { data } = await postGraphql(shopDomain, apiVersion, token, '{ shop { name } }', {});
    if (data?.errors?.length) throw new Error(describeGraphqlErrors(data.errors));
    return { shopName: data?.data?.shop?.name || shopDomain };
  } catch (e) {
    const status = e.response?.status;
    if (status === 401 || status === 403) throw new Error('That access token was rejected by Shopify — check it was copied correctly.');
    if (status === 404) throw new Error('That shop domain was not found — check it ends in .myshopify.com.');
    throw new Error(`Could not reach Shopify: ${e.message}`);
  }
}

/** Which secret signs this merchant's webhooks: the one entered for it, or —
 *  for a Dev Dashboard app — the app's client secret, which Shopify uses. */
export async function webhookSecretFor(merchantOrId) {
  const merchant = await loadMerchant(merchantOrId);
  return readSecret(merchant, 'webhookSecret') || readSecret(merchant, 'clientSecret');
}

/** Shopify signs webhooks with HMAC-SHA256 over the raw body, base64-encoded
 *  in the X-Shopify-Hmac-Sha256 header. */
export function verifyShopifySignature(hmacHeaderBase64, rawBodyBuffer, webhookSecret) {
  if (!webhookSecret || !hmacHeaderBase64 || !rawBodyBuffer) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBodyBuffer).digest();
  const given = Buffer.from(String(hmacHeaderBase64), 'base64');
  return given.length === expected.length && crypto.timingSafeEqual(expected, given);
}

/** Every product variant with its inventory item, paginated. Used for the
 *  catalog sync. */
export async function fetchProductsAndVariants(merchantId) {
  const variants = [];
  let after = null;
  do {
    const data = await shopifyGraphql(merchantId, `
      query Variants($after: String) {
        productVariants(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id sku title barcode inventoryItem { id } product { id title } }
        }
      }`, { after });
    const page = data.productVariants;
    for (const v of page.nodes) {
      variants.push({
        shopifyProductId: numericId(v.product?.id || ''),
        shopifyVariantId: numericId(v.id),
        sku: v.sku || '',
        productTitle: v.product?.title || '',
        variantTitle: v.title || '',
        barcode: v.barcode || '',
        shopifyInventoryItemId: v.inventoryItem?.id || '',
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return variants;
}

/** The merchant's Shopify locations, so an admin can say which one is us. */
export async function fetchLocations(merchantId) {
  const data = await shopifyGraphql(merchantId, `
    { locations(first: 100, includeInactive: false) { nodes { id name fulfillsOnlineOrders address { city country } } } }`);
  return data.locations.nodes.map(l => ({
    id: l.id, name: l.name, fulfillsOnlineOrders: l.fulfillsOnlineOrders,
    place: [l.address?.city, l.address?.country].filter(Boolean).join(', '),
  }));
}

export const WEBHOOK_TOPICS = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED'];

/**
 * Subscribes the store to the order webhooks, pointed at our endpoint.
 * Existing subscriptions to the same address are left alone, so this is
 * safe to press twice.
 */
export async function registerOrderWebhooks(merchantId, uri) {
  const existing = await shopifyGraphql(merchantId, `
    { webhookSubscriptions(first: 100) { nodes { id topic uri } } }`);
  const have = new Set(existing.webhookSubscriptions.nodes.filter(w => w.uri === uri).map(w => w.topic));
  const created = [];
  for (const topic of WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const data = await shopifyGraphql(merchantId, `
      mutation Sub($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
          webhookSubscription { id topic }
          userErrors { field message }
        }
      }`, { topic, input: { uri, format: 'JSON' } });
    assertNoUserErrors(data.webhookSubscriptionCreate, `Subscribing to ${topic}`);
    created.push(topic);
  }
  return { created, alreadyRegistered: [...have] };
}

/**
 * Marks shipped quantities as fulfilled in Shopify, with tracking.
 *
 * `quantities` maps a numeric variant ID to how many units went out. Those
 * are spread across the order's open fulfillment orders at our location;
 * Shopify requires one fulfillment to come from a single location, so if
 * the merchant hasn't told us which location we are, the first one holding
 * any of these items is used.
 */
export async function createFulfillment(merchant, shopifyOrderId, { quantities, carrier, trackingNumber, notifyCustomer = true }) {
  const data = await shopifyGraphql(merchant, `
    query FOs($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 25) {
          nodes {
            id status
            assignedLocation { location { id } }
            lineItems(first: 250) { nodes { id remainingQuantity variant { id } } }
          }
        }
      }
    }`, { id: gid('Order', shopifyOrderId) });
  if (!data.order) throw new Error('Order not found in Shopify.');

  const open = data.order.fulfillmentOrders.nodes.filter(fo => ['OPEN', 'IN_PROGRESS'].includes(fo.status));
  const locationOf = fo => fo.assignedLocation?.location?.id || '';
  const wanted = new Map(Object.entries(quantities).filter(([, q]) => q > 0));
  const holdsWanted = fo => fo.lineItems.nodes.some(li => li.variant && wanted.has(numericId(li.variant.id)) && li.remainingQuantity > 0);
  const location = merchant.shopifyLocationId || locationOf(open.find(holdsWanted) || {});
  const candidates = open.filter(fo => locationOf(fo) === location);
  if (!candidates.length) {
    throw new Error(merchant.shopifyLocationId
      ? 'This order has nothing open at the warehouse\'s Shopify location — it may have been fulfilled or reassigned in Shopify.'
      : 'This order has no open fulfillment orders in Shopify — it may already be fulfilled.');
  }

  const byFulfillmentOrder = [];
  for (const fo of candidates) {
    const items = [];
    for (const li of fo.lineItems.nodes) {
      const variant = li.variant && numericId(li.variant.id);
      const need = variant ? wanted.get(variant) || 0 : 0;
      const take = Math.min(need, li.remainingQuantity);
      if (take > 0) {
        items.push({ id: li.id, quantity: take });
        wanted.set(variant, need - take);
      }
    }
    if (items.length) byFulfillmentOrder.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: items });
  }
  if (!byFulfillmentOrder.length) throw new Error('None of the shipped items are still open on this order in Shopify.');

  const result = await shopifyGraphql(merchant, `
    mutation Fulfill($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`, {
    fulfillment: {
      lineItemsByFulfillmentOrder: byFulfillmentOrder,
      trackingInfo: { company: carrier, number: trackingNumber },
      notifyCustomer,
    },
  });
  assertNoUserErrors(result.fulfillmentCreate, 'Creating the fulfillment');
  return result.fulfillmentCreate.fulfillment;
}

/**
 * Sets the "available" quantity of each inventory item at one location —
 * absolute values, not deltas, so a missed push is corrected by the next one
 * instead of compounding. At most 250 items per call, which is Shopify's
 * limit. Compare-and-set is switched off: this warehouse is the source of
 * truth, and the value Shopify had before doesn't change what it should be.
 */
export async function setAvailableQuantities(merchant, locationId, items) {
  for (let i = 0; i < items.length; i += 250) {
    const batch = items.slice(i, i + 250);
    const data = await shopifyGraphql(merchant, `
      mutation SetQty($input: InventorySetQuantitiesInput!, $key: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $key) {
          userErrors { field message }
        }
      }`, {
      key: crypto.randomUUID(),
      input: {
        name: 'available',
        reason: 'correction',
        referenceDocumentUri: `purplebox://warehouse/${encodeURIComponent(merchant.warehouse || '')}/sync/${new Date().toISOString()}`,
        quantities: batch.map(({ inventoryItemId, quantity }) => ({
          inventoryItemId, locationId, quantity: Math.max(0, Math.floor(quantity)), changeFromQuantity: null,
        })),
      },
    });
    assertNoUserErrors(data.inventorySetQuantities, 'Updating Shopify stock');
  }
}
