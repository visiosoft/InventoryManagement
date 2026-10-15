import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { Site, User } from '../src/models/index.js';
import { Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob } from '../src/models/shopify.js';

process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const { encrypt } = await import('../src/utils/crypto.js');
const {
  command, createManualFulfillmentJob, pickFulfillmentLine, markPacked, markShipped, resolveBackorder,
} = await import('../src/services/shopifyFulfillment.js');

let replica, admin, site, merchant, skuA, skuB;
const run = (actor, operation, input, fn) => command(actor, { requestId: randomUUID(), ...input }, operation, ctx => fn(ctx, input));

async function seedInventory(sku, onHand) {
  await InventoryLevel.create({ merchant: merchant._id, sku: sku._id, site: site._id, warehouse: 'WH1', onHand, reserved: 0 });
}

before(async () => {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  // Never reads .env or connects to an existing database.
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(replica.getUri(), { dbName: 'shopify_fulfillment_test' });
  await Promise.all([User, Site, Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob].map(m => m.init()));

  admin = await User.create({ name: 'Admin', email: 'admin@test.invalid', passwordHash: 'test', role: 'admin' });
  site = await Site.create({ name: 'Test facility', code: 'TEST', isDefault: true });

  const secret = encrypt('shpat_test_token');
  const webhook = encrypt('whsec_test');
  merchant = await Merchant.create({
    name: 'Duriya', shopDomain: 'duriya.myshopify.com',
    adminApiAccessTokenEnc: secret.ciphertext, adminApiAccessTokenIv: secret.iv, adminApiAccessTokenTag: secret.tag,
    webhookSecretEnc: webhook.ciphertext, webhookSecretIv: webhook.iv, webhookSecretTag: webhook.tag,
    site: site._id, warehouse: 'WH1', createdBy: admin._id,
  });
  skuA = await Sku.create({ merchant: merchant._id, shopifyProductId: 'p1', shopifyVariantId: 'v1', sku: 'ABC-1' });
  skuB = await Sku.create({ merchant: merchant._id, shopifyProductId: 'p2', shopifyVariantId: 'v2', sku: 'ABC-2' });
}, { timeout: 240000 });

after(async () => { await mongoose.disconnect(); await replica?.stop(); });

test('an order fully covered by stock reserves it and lands READY_TO_PICK', async () => {
  await seedInventory(skuA, 10);
  const { job } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuA._id, quantity: 4 }] }, createManualFulfillmentJob);
  assert.equal(job.status, 'READY_TO_PICK');
  const level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuA._id, warehouse: 'WH1' });
  assert.equal(level.reserved, 4);
  assert.equal(level.onHand, 10);
});

test('an order that exceeds available stock is flagged PARTIAL_BACKORDER, not silently short-shipped', async () => {
  await InventoryLevel.deleteMany({ sku: skuB._id });
  await seedInventory(skuB, 2);
  const { job } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuB._id, quantity: 5 }] }, createManualFulfillmentJob);
  assert.equal(job.status, 'PARTIAL_BACKORDER');
  assert.match(job.backorderNote, /ABC-2/);
  const level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuB._id, warehouse: 'WH1' });
  // Only what was actually available gets reserved — never more than onHand.
  assert.equal(level.reserved, 2);
});

test('picking more than ordered on a line is rejected', async () => {
  await InventoryLevel.deleteMany({ sku: skuA._id });
  await seedInventory(skuA, 10);
  const { job } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuA._id, quantity: 3 }] }, createManualFulfillmentJob);
  await assert.rejects(
    run(admin, 'PICK_LINE', {}, (ctx) => pickFulfillmentLine(ctx, job._id, { sku: skuA._id, quantity: 4 })),
    /Cannot pick more than ordered/
  );
});

test('full pick -> pack -> ship happy path decrements onHand and reserved together', async () => {
  await InventoryLevel.deleteMany({ sku: skuA._id });
  await seedInventory(skuA, 10);
  const { job: created } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuA._id, quantity: 4 }] }, createManualFulfillmentJob);

  const { job: picked } = await run(admin, 'PICK_LINE', {}, (ctx) => pickFulfillmentLine(ctx, created._id, { sku: skuA._id, quantity: 4 }));
  assert.equal(picked.status, 'PICKED');

  const { job: packed } = await run(admin, 'PACK', {}, (ctx) => markPacked(ctx, created._id));
  assert.equal(packed.status, 'PACKED');
  assert.ok(packed.packedAt);

  const { job: shipped } = await run(admin, 'SHIP', {}, (ctx) => markShipped(ctx, created._id, { carrier: 'DHL', trackingNumber: 'TRK123' }));
  assert.equal(shipped.status, 'SHIPPED');
  assert.equal(shipped.carrier, 'DHL');
  assert.equal(shipped.trackingNumber, 'TRK123');

  const level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuA._id, warehouse: 'WH1' });
  assert.equal(level.onHand, 6); // 10 - 4 shipped
  assert.equal(level.reserved, 0); // reservation consumed, not left dangling

  const order = await ShopifyOrder.findById(shipped.shopifyOrder);
  assert.equal(order.fulfillmentStatus, 'fulfilled');
});

test('cannot ship a job that has not been packed', async () => {
  await InventoryLevel.deleteMany({ sku: skuA._id });
  await seedInventory(skuA, 10);
  const { job } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuA._id, quantity: 2 }] }, createManualFulfillmentJob);
  await assert.rejects(
    run(admin, 'SHIP', {}, (ctx) => markShipped(ctx, job._id, { carrier: 'DHL', trackingNumber: 'X' })),
    /must be packed/
  );
});

test('resolveBackorder(ship_partial) caps the line down to what is actually reservable and lets the job proceed', async () => {
  await InventoryLevel.deleteMany({ sku: skuB._id });
  await seedInventory(skuB, 3);
  const { job: created } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuB._id, quantity: 5 }] }, createManualFulfillmentJob);
  assert.equal(created.status, 'PARTIAL_BACKORDER');

  const { job: resolved } = await run(admin, 'RESOLVE_BACKORDER', {}, (ctx) => resolveBackorder(ctx, created._id, { action: 'ship_partial', note: 'restock delayed' }));
  assert.equal(resolved.status, 'READY_TO_PICK');
  assert.equal(resolved.lines[0].ordered, 3);
  assert.equal(resolved.backorderNote, 'restock delayed');
});

test('resolveBackorder(cancel) releases the reservation back to available stock', async () => {
  await InventoryLevel.deleteMany({ sku: skuB._id });
  await seedInventory(skuB, 2);
  const { job: created } = await run(admin, 'CREATE_MANUAL_JOB', { merchant: String(merchant._id), lines: [{ sku: skuB._id, quantity: 5 }] }, createManualFulfillmentJob);
  let level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuB._id, warehouse: 'WH1' });
  assert.equal(level.reserved, 2);

  const { job: cancelled } = await run(admin, 'RESOLVE_BACKORDER', {}, (ctx) => resolveBackorder(ctx, created._id, { action: 'cancel' }));
  assert.equal(cancelled.status, 'CANCELLED');
  level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuB._id, warehouse: 'WH1' });
  assert.equal(level.reserved, 0);
});

test('a repeated requestId replays the original result instead of double-reserving stock', async () => {
  await InventoryLevel.deleteMany({ sku: skuA._id });
  await seedInventory(skuA, 10);
  const requestId = randomUUID();
  const input = { merchant: String(merchant._id), lines: [{ sku: skuA._id, quantity: 3 }] };
  const first = await command(admin, { requestId, ...input }, 'CREATE_MANUAL_JOB', (ctx) => createManualFulfillmentJob(ctx, input));
  const second = await command(admin, { requestId, ...input }, 'CREATE_MANUAL_JOB', (ctx) => createManualFulfillmentJob(ctx, input));
  assert.equal(second.replayed, true);
  assert.equal(first.job._id, second.job._id);
  const level = await InventoryLevel.findOne({ merchant: merchant._id, sku: skuA._id, warehouse: 'WH1' });
  assert.equal(level.reserved, 3); // not 6 — the retry did not run twice
});
