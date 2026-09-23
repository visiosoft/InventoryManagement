import { Router } from 'express';
import { User } from '../models/index.js';
import { WarehouseLocation } from '../models/warehouse.js';
import { Merchant, Sku, InventoryLevel, FulfillmentJob } from '../models/shopify.js';
import { operationalPermission, command } from '../services/warehouse.js';
import { fail } from '../services/warehouseRules.js';
import {
  syncMerchantCatalog, createManualFulfillmentJob, assignWorker,
  pickFulfillmentLine, markPacked, markShipped, resolveBackorder,
} from '../services/shopifyFulfillment.js';
import { verifyShopifyToken, encryptMerchantSecret, forgetMerchantClient } from '../services/shopify.js';

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

router.post('/merchants', requireAdminHere, asyncRoute(async (req, res) => {
  const { name, shopDomain, accessToken, webhookSecret, apiVersion, site, warehouse } = req.body || {};
  if (!name || !shopDomain || !accessToken || !site || !warehouse) {
    return res.status(400).json({ error: 'name, shopDomain, accessToken, site and warehouse are required.' });
  }
  const domain = String(shopDomain).trim().toLowerCase();
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
    return res.status(400).json({ error: 'shopDomain should look like "yourstore.myshopify.com".' });
  }
  // Fails loudly (with a message the form can show) before anything is
  // saved — same "verify before persisting" shape as Stripe's connect route.
  await verifyShopifyToken(domain, accessToken, apiVersion);

  const token = encryptMerchantSecret(accessToken);
  const webhook = webhookSecret ? encryptMerchantSecret(webhookSecret) : null;
  const merchant = await Merchant.create({
    name: String(name).trim(),
    shopDomain: domain,
    adminApiAccessTokenEnc: token.enc, adminApiAccessTokenIv: token.iv, adminApiAccessTokenTag: token.tag,
    ...(webhook ? { webhookSecretEnc: webhook.enc, webhookSecretIv: webhook.iv, webhookSecretTag: webhook.tag } : {}),
    apiVersion: apiVersion || undefined,
    site, warehouse: String(warehouse).trim().toUpperCase(),
    createdBy: req.warehouseUser._id,
  });
  const safe = merchant.toObject();
  delete safe.adminApiAccessTokenEnc; delete safe.adminApiAccessTokenIv; delete safe.adminApiAccessTokenTag;
  delete safe.webhookSecretEnc; delete safe.webhookSecretIv; delete safe.webhookSecretTag;
  res.status(201).json(safe);
}));

router.patch('/merchants/:id', requireAdminHere, asyncRoute(async (req, res) => {
  const merchant = await Merchant.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found.' });
  if (req.body.isActive !== undefined) merchant.isActive = Boolean(req.body.isActive);
  if (req.body.name !== undefined) merchant.name = String(req.body.name).trim();
  if (req.body.warehouse !== undefined) merchant.warehouse = String(req.body.warehouse).trim().toUpperCase();
  if (req.body.site !== undefined) merchant.site = req.body.site;
  // Rotating the token: verify the new one before saving, same as creation.
  if (req.body.accessToken) {
    await verifyShopifyToken(merchant.shopDomain, req.body.accessToken, merchant.apiVersion);
    const token = encryptMerchantSecret(req.body.accessToken);
    merchant.adminApiAccessTokenEnc = token.enc; merchant.adminApiAccessTokenIv = token.iv; merchant.adminApiAccessTokenTag = token.tag;
    forgetMerchantClient(merchant._id);
  }
  if (req.body.webhookSecret) {
    const webhook = encryptMerchantSecret(req.body.webhookSecret);
    merchant.webhookSecretEnc = webhook.enc; merchant.webhookSecretIv = webhook.iv; merchant.webhookSecretTag = webhook.tag;
  }
  await merchant.save();
  const safe = merchant.toObject();
  delete safe.adminApiAccessTokenEnc; delete safe.adminApiAccessTokenIv; delete safe.adminApiAccessTokenTag;
  delete safe.webhookSecretEnc; delete safe.webhookSecretIv; delete safe.webhookSecretTag;
  res.json(safe);
}));

router.post('/merchants/:id/sync', asyncRoute(async (req, res) => {
  res.json(await syncMerchantCatalog(req.params.id));
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
      .lean()
  );
}));

router.get('/jobs/:id', asyncRoute(async (req, res) => {
  const job = await FulfillmentJob.findById(req.params.id).populate('lines.sku').populate('lines.pickLocationHint').lean();
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
router.post('/jobs/:id/ship', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'SHIP_JOB', ctx => markShipped(ctx, req.params.id, req.body)))
));
router.post('/jobs/:id/resolve-backorder', asyncRoute(async (req, res) =>
  res.json(await command(req.warehouseUser, req.body, 'RESOLVE_BACKORDER', ctx => resolveBackorder(ctx, req.params.id, req.body)))
));

export default router;
