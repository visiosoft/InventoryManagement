import { before, after, beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import express from 'express';
import axios from 'axios';
import mongoose from 'mongoose';
import request from 'supertest';
import { Site, User } from '../src/models/index.js';
import { Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob, ShopifyWebhookEvent } from '../src/models/shopify.js';

process.env.NODE_ENV = 'test';
process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const { encrypt } = await import('../src/utils/crypto.js');
const svc = await import('../src/services/shopifyFulfillment.js');
const { default: webhookRoutes } = await import('../src/routes/shopifyWebhook.js');

const WEBHOOK_SECRET = 'whsec_integration';
let replica, admin, site, merchant, skuA, skuB, app;
const run = (operation, input, fn) => svc.command(admin, { requestId: randomUUID(), ...input }, operation, ctx => fn(ctx, input));
const level = sku => InventoryLevel.findOne({ merchant: merchant._id, sku: sku._id, warehouse: 'WH1' }).lean();
const setStock = (sku, onHand) => InventoryLevel.updateOne(
  { merchant: merchant._id, sku: sku._id, warehouse: 'WH1' },
  { $set: { onHand, reserved: 0 }, $setOnInsert: { _id: randomUUID(), site: site._id } },
  { upsert: true },
);
const orderPayload = (id, lines, extra = {}) => ({
  id, name: `#${id}`, financial_status: 'pending', fulfillment_status: null, cancelled_at: null,
  line_items: lines.map(([variant, qty, sku]) => ({ variant_id: variant, quantity: qty, fulfillable_quantity: qty, sku, title: 'Item', requires_shipping: true })),
  shipping_address: { first_name: 'Sara', last_name: 'K', address1: 'Marina', city: 'Dubai', country: 'UAE' },
  ...extra,
});
function deliver(topic, payload, { secret = WEBHOOK_SECRET, webhookId = randomUUID() } = {}) {
  const body = JSON.stringify(payload);
  return request(app).post('/hook')
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Shop-Domain', 'duriya.myshopify.com')
    .set('X-Shopify-Topic', topic)
    .set('X-Shopify-Webhook-Id', webhookId)
    .set('X-Shopify-Hmac-Sha256', createHmac('sha256', secret).update(body).digest('base64'))
    .send(body);
}

before(async () => {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(replica.getUri(), { dbName: 'shopify_integration_test' });
  await Promise.all([User, Site, Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob, ShopifyWebhookEvent].map(m => m.init()));

  admin = await User.create({ name: 'Admin', email: 'admin@test.invalid', passwordHash: 'test', role: 'admin' });
  site = await Site.create({ name: 'Test facility', code: 'TEST', isDefault: true });
  const token = encrypt('shpat_test_token');
  const webhook = encrypt(WEBHOOK_SECRET);
  merchant = await Merchant.create({
    name: 'Duriya', shopDomain: 'duriya.myshopify.com',
    adminApiAccessTokenEnc: token.ciphertext, adminApiAccessTokenIv: token.iv, adminApiAccessTokenTag: token.tag,
    webhookSecretEnc: webhook.ciphertext, webhookSecretIv: webhook.iv, webhookSecretTag: webhook.tag,
    site: site._id, warehouse: 'WH1', createdBy: admin._id,
    shopifyLocationId: 'gid://shopify/Location/9',
  });
  skuA = await Sku.create({ merchant: merchant._id, shopifyProductId: 'p1', shopifyVariantId: '111', sku: 'ABC-1', shopifyInventoryItemId: 'gid://shopify/InventoryItem/501' });
  skuB = await Sku.create({ merchant: merchant._id, shopifyProductId: 'p2', shopifyVariantId: '222', sku: 'ABC-2', shopifyInventoryItemId: 'gid://shopify/InventoryItem/502' });

  app = express();
  app.use('/hook', express.raw({ type: '*/*' }), webhookRoutes);
}, { timeout: 240000 });

beforeEach(async () => {
  mock.restoreAll();
  await Promise.all([InventoryLevel.deleteMany({}), ShopifyOrder.deleteMany({}), FulfillmentJob.deleteMany({}), ShopifyWebhookEvent.deleteMany({})]);
});

after(async () => { await mongoose.disconnect(); await replica?.stop(); });

test('a signed orders/create webhook creates a job and reserves stock', async () => {
  await setStock(skuA, 10);
  const res = await deliver('orders/create', orderPayload(1001, [[111, 3, 'ABC-1']]));
  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'created');
  const job = await FulfillmentJob.findById(res.body.job).lean();
  assert.equal(job.status, 'READY_TO_PICK');
  assert.equal((await level(skuA)).reserved, 3);
  const order = await ShopifyOrder.findById(job.shopifyOrder).lean();
  assert.equal(order.shippingAddress.name, 'Sara K');
});

test('a webhook with a bad signature is rejected and changes nothing', async () => {
  const res = await deliver('orders/create', orderPayload(1002, [[111, 1, 'ABC-1']]), { secret: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(await ShopifyOrder.countDocuments(), 0);
});

test('the same delivery twice, or create + updated together, reserves stock only once', async () => {
  await setStock(skuA, 10);
  const payload = orderPayload(1003, [[111, 4, 'ABC-1']]);
  const webhookId = randomUUID();
  await deliver('orders/create', payload, { webhookId });
  const dup = await deliver('orders/create', payload, { webhookId });
  assert.equal(dup.body.duplicate, true);
  await Promise.all([deliver('orders/updated', payload), deliver('orders/updated', payload)]);
  assert.equal(await FulfillmentJob.countDocuments(), 1);
  assert.equal((await level(skuA)).reserved, 4);
});

test('two orders racing for the last units cannot both reserve them', async () => {
  await setStock(skuA, 5);
  await Promise.all([
    deliver('orders/create', orderPayload(2001, [[111, 4, 'ABC-1']])),
    deliver('orders/create', orderPayload(2002, [[111, 4, 'ABC-1']])),
  ]);
  const jobs = await FulfillmentJob.find().lean();
  assert.equal(jobs.length, 2);
  assert.equal(jobs.filter(j => j.status === 'PARTIAL_BACKORDER').length, 1);
  assert.equal((await level(skuA)).reserved, 5);
});

test('an item not in the synced catalog flags the job instead of dropping the line', async () => {
  await setStock(skuA, 10);
  const res = await deliver('orders/create', orderPayload(1004, [[111, 1, 'ABC-1'], [999, 2, 'NEW-SKU']]));
  const job = await FulfillmentJob.findById(res.body.job).lean();
  assert.equal(job.status, 'PARTIAL_BACKORDER');
  assert.match(job.backorderNote, /NEW-SKU ×2 is not in the synced catalog/);
});

test('cancelling the order in Shopify cancels the job and returns its stock', async () => {
  await setStock(skuA, 10);
  const payload = orderPayload(1005, [[111, 6, 'ABC-1']]);
  await deliver('orders/create', payload);
  assert.equal((await level(skuA)).reserved, 6);
  const res = await deliver('orders/cancelled', { ...payload, cancelled_at: new Date().toISOString() });
  assert.equal(res.body.action, 'cancelled');
  assert.equal((await level(skuA)).reserved, 0);
  assert.equal((await FulfillmentJob.findOne().lean()).status, 'CANCELLED');
});

test('receiving stock then retrying a backorder makes the job pickable', async () => {
  await setStock(skuB, 1);
  const { job } = await run('CREATE_MANUAL_JOB', { merchant: merchant._id, lines: [{ sku: skuB._id, quantity: 3 }] }, svc.createManualFulfillmentJob);
  assert.equal(job.status, 'PARTIAL_BACKORDER');

  await run('ADJUST_STOCK', { merchant: merchant._id, sku: skuB._id, mode: 'add', quantity: 5 }, svc.adjustStock);
  const { job: retried } = await run('RESOLVE_BACKORDER', {}, ctx => svc.resolveBackorder(ctx, job._id, { action: 'retry' }));
  assert.equal(retried.status, 'READY_TO_PICK');
  assert.equal(retried.backorderNote, '');
  const l = await level(skuB);
  assert.equal(l.onHand, 6);
  assert.equal(l.reserved, 3);
});

test('a stock count cannot go below what is reserved for open orders', async () => {
  await setStock(skuA, 10);
  await run('CREATE_MANUAL_JOB', { merchant: merchant._id, lines: [{ sku: skuA._id, quantity: 4 }] }, svc.createManualFulfillmentJob);
  await assert.rejects(
    run('ADJUST_STOCK', { merchant: merchant._id, sku: skuA._id, mode: 'set', quantity: 3 }, svc.adjustStock),
    /reserved for open orders/,
  );
  const ok = await run('ADJUST_STOCK', { merchant: merchant._id, sku: skuA._id, mode: 'set', quantity: 4 }, svc.adjustStock);
  assert.equal(ok.available, 0);
});

/** Stands in for Shopify's GraphQL endpoint; records every call. */
function fakeShopify(handler) {
  const calls = [];
  mock.method(axios, 'post', async (url, body) => {
    calls.push({ url, body });
    return { data: { data: handler(body.query, body.variables) } };
  });
  return calls;
}

async function shipWebhookOrder(orderId, qty) {
  const res = await deliver('orders/create', orderPayload(orderId, [[111, qty, 'ABC-1']]));
  const id = res.body.job;
  await run('PICK', {}, ctx => svc.pickFulfillmentLine(ctx, id, { sku: skuA._id, quantity: qty }));
  await run('PACK', {}, ctx => svc.markPacked(ctx, id));
  await run('SHIP', {}, ctx => svc.markShipped(ctx, id, { carrier: 'Aramex', trackingNumber: 'ARX1' }));
  return id;
}

test('shipping a webhook order pushes a fulfillment with tracking to Shopify', async () => {
  await setStock(skuA, 10);
  const jobId = await shipWebhookOrder(3001, 2);
  const calls = fakeShopify(query => (query.includes('fulfillmentOrders')
    ? { order: { fulfillmentOrders: { nodes: [{
      id: 'gid://shopify/FulfillmentOrder/7', status: 'OPEN',
      assignedLocation: { location: { id: 'gid://shopify/Location/9' } },
      lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/70', remainingQuantity: 2, variant: { id: 'gid://shopify/ProductVariant/111' } }] },
    }] } } }
    : { fulfillmentCreate: { fulfillment: { id: 'gid://shopify/Fulfillment/55', status: 'SUCCESS' }, userErrors: [] } }));

  const result = await svc.pushFulfillment(jobId);
  assert.equal(result.ok, true);
  const sent = calls[1].body.variables.fulfillment;
  assert.deepEqual(sent.lineItemsByFulfillmentOrder, [{
    fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/7',
    fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/70', quantity: 2 }],
  }]);
  assert.deepEqual(sent.trackingInfo, { company: 'Aramex', number: 'ARX1' });
  const job = await FulfillmentJob.findById(jobId).lean();
  assert.equal(job.shopifyFulfillmentId, 'gid://shopify/Fulfillment/55');
  assert.equal(job.shopifyPushFailedAt, null);
});

test('a failed fulfillment push is recorded on the job and retried later', async () => {
  await setStock(skuA, 10);
  const jobId = await shipWebhookOrder(3002, 1);
  fakeShopify(() => { throw new Error('boom'); });
  const first = await svc.pushFulfillment(jobId);
  assert.equal(first.ok, false);
  let job = await FulfillmentJob.findById(jobId).lean();
  assert.ok(job.shopifyPushFailedAt);
  assert.equal(job.status, 'SHIPPED'); // the shipment itself stands

  mock.restoreAll();
  fakeShopify(query => (query.includes('fulfillmentOrders')
    ? { order: { fulfillmentOrders: { nodes: [{
      id: 'gid://shopify/FulfillmentOrder/8', status: 'OPEN',
      assignedLocation: { location: { id: 'gid://shopify/Location/9' } },
      lineItems: { nodes: [{ id: 'gid://shopify/FulfillmentOrderLineItem/80', remainingQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/111' } }] },
    }] } } }
    : { fulfillmentCreate: { fulfillment: { id: 'gid://shopify/Fulfillment/56' }, userErrors: [] } }));
  const retry = await svc.retryFailedFulfillmentPushes();
  assert.deepEqual(retry, { tried: 1, fixed: 1 });
  job = await FulfillmentJob.findById(jobId).lean();
  assert.equal(job.shopifyFulfillmentId, 'gid://shopify/Fulfillment/56');
});

test('stock push sends on-hand minus reserved, only for SKUs this warehouse holds', async () => {
  await setStock(skuA, 10);
  await run('CREATE_MANUAL_JOB', { merchant: merchant._id, lines: [{ sku: skuA._id, quantity: 3 }] }, svc.createManualFulfillmentJob);
  const calls = fakeShopify(() => ({ inventorySetQuantities: { userErrors: [] } }));
  const out = await svc.pushInventory(merchant._id, { full: true });
  assert.equal(out.pushed, 1);
  const { input, key } = calls[0].body.variables;
  assert.ok(key);
  assert.equal(input.name, 'available');
  assert.deepEqual(input.quantities, [{
    inventoryItemId: 'gid://shopify/InventoryItem/501', locationId: 'gid://shopify/Location/9', quantity: 7, changeFromQuantity: null,
  }]);
  assert.match(calls[0].url, /\/admin\/api\/2026-07\/graphql\.json$/);
});
