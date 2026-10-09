import { Router } from 'express';
import { User } from '../models/index.js';
import { WarehouseLocation } from '../models/warehouse.js';
import { Merchant, Sku, InventoryLevel, FulfillmentJob, ShopifyOrder } from '../models/shopify.js';
import { operationalPermission, command } from '../services/warehouse.js';
import { fail } from '../services/warehouseRules.js';
import {
  syncMerchantCatalog, createManualFulfillmentJob, assignWorker,
  pickFulfillmentLine, markPacked, markShipped, resolveBackorder,
  adjustStock, pushFulfillment, pushInventory,
} from '../services/shopifyFulfillment.js';
import {
  verifyShopifyCredentials, encryptMerchantSecret, forgetMerchantClient, safeMerchant,
  fetchLocations, registerOrderWebhooks, REQUIRED_SCOPES, DEFAULT_API_VERSION,
} from '../services/shopify.js';

const router = Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Same re-fetch-on-every-request shape as routes/warehouse.js's own
// middleware — a revoked permission takes effect without waiting for the
// login token to expire.
router.use(asyncRoute(async (req, res, next) => {
  if (!req.user?.id || !/^[a-f0-9]{24}$/i.test(req.user.id)) return res.status(401).json({ error: 'Employee authentication required.' });
  const user = await User.findById(req.user.id).select('role permissions isActive name');
  if (!user?.isActive || !operationalPermission(user)) return res.status(403).json({ error: 'Warehouse permission required.' });
  req.warehouseUser = user;
  next();
}));

const isAdmin = req => req.warehouseUser.role === 'admin';
function requireAdminHere(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only.' });
  next();
}

// ── Merchants (admin-only: these hold live write access to someone else's
//    Shopify store, so onboarding/deactivating one is not a warehouse-floor
//    action) ──────────────────────────────────────────────────────────────
router.get('/merchants', requireAdminHere, asyncRoute(async (_req, res) => {
  // Never selects the encrypted secret fields — they default to
  // select: false on the schema, so a plain find() already excludes them.
  res.json(await Merchant.find().sort({ createdAt: -1 }).lean());
}));

const webhookUrl = () => `${(process.env.API_PUBLIC_URL || 'https://api.purplebox.ae').replace(/\/+$/, '')}/api/shopify/webhooks`;

// What the connect form needs to tell whoever is setting the app up in Shopify.
router.get('/connect-info', requireAdminHere, (_req, res) => {
  res.json({ scopes: REQUIRED_SCOPES, webhookUrl: webhookUrl(), apiVersion: DEFAULT_API_VERSION });
});

/** Reads and checks credentials from a create/update body, returning the
 *  encrypted fields to save. Verifies against Shopify before anything is
 *  stored, so a typo is reported on the form instead of on the first order. */
async function credentialFields(body, shopDomain, apiVersion) {
  const authMode = body.authMode === 'client_credentials' ? 'client_credentials' : 'static_token';
  const out = { authMode };
  if (authMode === 'client_credentials') {
    const clientId = String(body.clientId || '').trim();
    const clientSecret = String(body.clientSecret || '').trim();
    if (!clientId || !clientSecret) fail('Client ID and client secret are required.');
    await verifyShopifyCredentials({ shopDomain, authMode, clientId, clientSecret, apiVersion }).catch(e => fail(e.message));
    const secret = encryptMerchantSecret(clientSecret);
    Object.assign(out, { clientId, clientSecretEnc: secret.enc, clientSecretIv: secret.iv, clientSecretTag: secret.tag });
  } else {
    const accessToken = String(body.accessToken || '').trim();
    if (!accessToken) fail('An Admin API access token is required.');
    await verifyShopifyCredentials({ shopDomain, authMode, accessToken, apiVersion }).catch(e => fail(e.message));
    const token = encryptMerchantSecret(accessToken);
    Object.assign(out, { adminApiAccessTokenEnc: token.enc, adminApiAccessTokenIv: token.iv, adminApiAccessTokenTag: token.tag });
  }
  return out;
}

router.post('/merchants', requireAdminHere, asyncRoute(async (req, res) => {
  const { name, shopDomain, webhookSecret, site, warehouse } = req.body || {};
  if (!name || !shopDomain || !site || !warehouse) {
    return res.status(400).json({ error: 'name, shopDomain, site and warehouse are required.' });
  }
  const domain = String(shopDomain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
    return res.status(400).json({ error: 'shopDomain should look like "yourstore.myshopify.com".' });
  }
  if (await Merchant.exists({ shopDomain: domain })) return res.status(409).json({ error: 'That store is already connected.' });
  const creds = await credentialFields(req.body, domain, DEFAULT_API_VERSION);
  const webhook = webhookSecret ? encryptMerchantSecret(String(webhookSecret).trim()) : null;
  const merchant = await Merchant.create({
    name: String(name).trim(),
    shopDomain: domain,
    ...creds,
    ...(webhook ? { webhookSecretEnc: webhook.enc, webhookSecretIv: webhook.iv, webhookSecretTag: webhook.tag } : {}),
    apiVersion: DEFAULT_API_VERSION,
    site, warehouse: String(warehouse).trim().toUpperCase(),
    createdBy: req.warehouseUser._id,
  });
  res.status(201).json(safeMerchant(merchant));
}));

router.patch('/merchants/:id', requireAdminHere, asyncRoute(async (req, res) => {
  const merchant = await Merchant.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found.' });
  const body = req.body || {};
  if (body.isActive !== undefined) merchant.isActive = Boolean(body.isActive);
  if (body.name !== undefined) merchant.name = String(body.name).trim();
  if (body.warehouse !== undefined) merchant.warehouse = String(body.warehouse).trim().toUpperCase();
  if (body.site !== undefined) merchant.site = body.site;
  if (body.shopifyLocationId !== undefined) {
    if (body.shopifyLocationId) {
      const location = (await fetchLocations(merchant._id)).find(l => l.id === body.shopifyLocationId);
      if (!location) return res.status(400).json({ error: 'That location was not found in this store.' });
      merchant.shopifyLocationId = location.id;
      merchant.shopifyLocationName = location.name;
    } else {
      merchant.shopifyLocationId = '';
      merchant.shopifyLocationName = '';
      merchant.inventorySyncEnabled = false;
    }
  }
  if (body.inventorySyncEnabled !== undefined) {
    if (body.inventorySyncEnabled && !merchant.shopifyLocationId) {
      return res.status(400).json({ error: 'Choose the Shopify location for this warehouse before turning on stock sync.' });
    }
    merchant.inventorySyncEnabled = Boolean(body.inventorySyncEnabled);
  }
  // Rotating credentials: verified before saving, same as creation.
  if (body.accessToken || body.clientSecret) {
    Object.assign(merchant, await credentialFields(body, merchant.shopDomain, merchant.apiVersion));
    merchant.apiVersion = DEFAULT_API_VERSION;
    forgetMerchantClient(merchant._id);
  }
  if (body.webhookSecret) {
    const webhook = encryptMerchantSecret(String(body.webhookSecret).trim());
    merchant.webhookSecretEnc = webhook.enc; merchant.webhookSecretIv = webhook.iv; merchant.webhookSecretTag = webhook.tag;
  }
  await merchant.save();
  res.json(safeMerchant(merchant));
}));

router.get('/merchants/:id/locations', requireAdminHere, asyncRoute(async (req, res) => {
  try { res.json(await fetchLocations(req.params.id)); }
  catch (e) { res.status(502).json({ error: e.message }); }
}));

router.post('/merchants/:id/webhooks', requireAdminHere, asyncRoute(async (req, res) => {
  let result;
  try { result = await registerOrderWebhooks(req.params.id, webhookUrl()); }
  catch (e) { return res.status(502).json({ error: e.message }); }
  await Merchant.updateOne({ _id: req.params.id }, { $set: { webhooksRegisteredAt: new Date() } });
  res.json({ ...result, webhookUrl: webhookUrl() });
}));

router.post('/merchants/:id/push-inventory', requireAdminHere, asyncRoute(async (req, res) => {
  try { res.json(await pushInventory(req.params.id, { full: true })); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
}));

router.post('/merchants/:id/sync', asyncRoute(async (req, res) => {
  try { res.json(await syncMerchantCatalog(req.params.id)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
}));

// ── SKUs / inventory (any warehouse-permission holder) ─────────────────────
router.get('/skus', asyncRoute(async (req, res) => {
  if (!req.query.merchant) return fail('Select a merchant.');
  const search = String(req.query.search || '').trim();
  const filter = { merchant: req.query.merchant };
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ sku: re }, { productTitle: re }, { variantTitle: re }];
  }
  const skus = await Sku.find(filter).sort({ sku: 1 }).limit(500).lean();
  const levels = await InventoryLevel.find({ merchant: req.query.merchant, sku: { $in: skus.map(s => s._id) } }).lean();
  const bySku = new Map(levels.map(l => [l.sku, l]));
  res.json(skus.map(s => {
    const level = bySku.get(s._id);
    const onHand = level?.onHand ?? 0;
    const reserved = level?.reserved ?? 0;
    return { ...s, onHand, reserved, available: onHand - reserved };
  }));
}));

router.get('/locations', asyncRoute(async (req, res) => {
  if (!req.query.site) return fail('Select a facility.');
  res.json(await WarehouseLocation.find({ site: req.query.site }).sort({ warehouse: 1, name: 1 }).limit(2000).lean());
}));

// Receiving a delivery or recording a stock count.
router.post('/stock', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'ADJUST_STOCK', ctx => adjustStock(ctx, req.body)))
));

router.patch('/skus/:id', asyncRoute(async (req, res) => {
  const sku = await Sku.findById(req.params.id);
  if (!sku) return res.status(404).json({ error: 'SKU not found.' });
  if (req.body.defaultLocation !== undefined) sku.defaultLocation = req.body.defaultLocation || null;
  await sku.save();
  res.json(sku.toObject());
}));

// ── Fulfillment jobs ─────────────────────────────────────────────────────
router.get('/jobs', asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.merchant) filter.merchant = req.query.merchant;
  if (req.query.status) filter.status = req.query.status;
  res.json(
    await FulfillmentJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('lines.sku')
      .populate({ path: 'shopifyOrder', model: ShopifyOrder, select: 'shopifyOrderId shopifyOrderName shippingAddress financialStatus' })
      .populate({ path: 'merchant', model: Merchant, select: 'name shopDomain' })
      .lean()
  );
}));

router.get('/jobs/:id', asyncRoute(async (req, res) => {
  const job = await FulfillmentJob.findById(req.params.id)
    .populate('lines.sku').populate('lines.pickLocationHint')
    .populate({ path: 'shopifyOrder', model: ShopifyOrder, select: 'shopifyOrderId shopifyOrderName shippingAddress financialStatus' })
    .populate({ path: 'merchant', model: Merchant, select: 'name shopDomain' })
    .lean();
  if (!job) return res.status(404).json({ error: 'Fulfillment job not found.' });
  res.json(job);
}));

// Phase A "create a test order" tool — restricted to admin/supervisor so
// regular floor workers aren't the ones spawning synthetic orders.
router.post('/jobs', requireAdminHere, asyncRoute(async (req, res) =>
  res.status(201).json(await command(req.warehouseUser, req.body, 'CREATE_MANUAL_JOB', ctx => createManualFulfillmentJob(ctx, req.body)))
));
router.patch('/jobs/:id/assign', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'ASSIGN_JOB', ctx => assignWorker(ctx, req.params.id, req.body.worker)))
));
router.post('/jobs/:id/pick', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'PICK_LINE', ctx => pickFulfillmentLine(ctx, req.params.id, req.body)))
));
router.post('/jobs/:id/pack', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'PACK_JOB', ctx => markPacked(ctx, req.params.id)))
));
router.post('/jobs/:id/ship', asyncRoute(async (req, res) => {
  const result = await command(req.warehouseUser, req.body, 'SHIP_JOB', ctx => markShipped(ctx, req.params.id, req.body));
  // After the shipment is recorded, never instead of it. Waited on so the
  // worker sees straight away whether Shopify has it; a failure is stored on
  // the job and retried in the background.
  const shopify = await pushFulfillment(req.params.id);
  res.json({ ...result, shopify });
}));
router.post('/jobs/:id/push-fulfillment', asyncRoute(async (req, res) => {
  const job = await FulfillmentJob.findById(req.params.id).select('status shopifyFulfillmentId').lean();
  if (!job) return res.status(404).json({ error: 'Fulfillment job not found.' });
  if (job.status !== 'SHIPPED') return res.status(409).json({ error: 'Only shipped jobs can be sent to Shopify.' });
  if (job.shopifyFulfillmentId) return res.json({ ok: true, alreadyPushed: true });
  const result = await pushFulfillment(req.params.id);
  if (result.error) return res.status(502).json({ error: result.error });
  res.json(result);
}));
router.post('/jobs/:id/resolve-backorder', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'RESOLVE_BACKORDER', ctx => resolveBackorder(ctx, req.params.id, req.body)))
));

// Validation failures (fail()) carry their own status and a message meant for
// the person; anything else is logged and kept vague, as in routes/warehouse.js.
router.use((error, _req, res, _next) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[shopify]', error);
  res.status(status).json({ error: status === 500 ? 'Shopify operation failed. Retry with the same request ID.' : error.message });
});

export default router;
