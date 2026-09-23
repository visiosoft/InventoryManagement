import { randomUUID } from 'node:crypto';
import { command } from './warehouse.js';
import { fail } from './warehouseRules.js';
import { ScanEvent } from '../models/warehouse.js';
import { Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob } from '../models/shopify.js';
import { fetchProductsAndVariants } from './shopify.js';

export { command };

const text = (value, max = 1000) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`Text must be at most ${max} characters.`);
  return value.trim();
};
// For real Mongo ObjectId refs (User, Site) — NOT for Merchant/Sku/
// ShopifyOrder/FulfillmentJob, which use a UUID string _id (see models/
// shopify.js's uref() comment) and so are looked up without a format check,
// the same way warehouse.js's editContainer()/updateWarehouseJob() do.
const objectId = (value, label = 'ID') => {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail(`Invalid ${label}.`);
  return value;
};
const uid = (value, label = 'ID') => {
  if (typeof value !== 'string' || !value) fail(`Invalid ${label}.`);
  return value;
};
const positiveInt = (value, label) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(`Invalid ${label} — must be a whole number greater than zero.`);
  return n;
};

/** Every command()-wrapped mutation below logs one of these so a retried
 *  requestId has something to replay from — command() itself only checks
 *  ScanEvent for a prior record, it doesn't write one. Mirrors warehouse.js's
 *  own (private) event() helper; duplicated rather than imported since that
 *  one isn't exported and its required fields (barcode/customer/booking) are
 *  container-shaped, not a natural fit to reuse here. */
function logEvent(ctx, fields) {
  return ScanEvent.create([{
    requestId: ctx.requestId, requestHash: ctx.hash,
    employee: ctx.user._id, deviceId: ctx.deviceId, ...fields,
  }], { session: ctx.session });
}

/**
 * Pulls a merchant's current product/variant catalog from Shopify and
 * upserts local Sku records. Read-only against Shopify (no writes there),
 * naturally idempotent via upsert — not run through command()/ScanEvent,
 * unlike the stock-affecting mutations below. Safe to call as often as
 * wanted from the admin "sync now" button; this is the Phase A substitute
 * for a live product webhook.
 */
export async function syncMerchantCatalog(merchantId) {
  const merchant = await Merchant.findById(uid(merchantId, 'merchant'));
  if (!merchant) fail('Merchant not found.', 404);
  if (!merchant.isActive) fail('Merchant is not active.', 409);

  const variants = await fetchProductsAndVariants(merchant._id);
  let created = 0, updated = 0;
  for (const v of variants) {
    if (!v.sku) continue; // a variant with no SKU code can't be inventoried against
    const res = await Sku.updateOne(
      { merchant: merchant._id, shopifyVariantId: v.shopifyVariantId },
      {
        $set: {
          shopifyProductId: v.shopifyProductId, sku: v.sku,
          productTitle: v.productTitle, variantTitle: v.variantTitle, barcode: v.barcode,
        },
        $setOnInsert: { merchant: merchant._id, shopifyVariantId: v.shopifyVariantId, active: true },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created += 1; else if (res.modifiedCount) updated += 1;
  }
  merchant.lastInventorySyncAt = new Date();
  await merchant.save();
  return { total: variants.length, created, updated };
}

/**
 * Phase A stand-in for a real Shopify order webhook: an admin picks a
 * merchant and SKU/quantity lines directly, so the reservation, backorder,
 * and pick/pack/ship flow can be built and tested before any webhook
 * reliability is in play. Creates a synthetic ShopifyOrder (shopifyOrderId
 * prefixed 'MANUAL-') so FulfillmentJob's schema — which always references a
 * real order, matching Phase B's real flow — needs no special-casing.
 */
export async function createManualFulfillmentJob(ctx, input) {
  const merchant = await Merchant.findById(uid(input.merchant, 'merchant'));
  if (!merchant) fail('Merchant not found.', 404);
  if (!merchant.isActive) fail('Merchant is not active.', 409);
  if (!Array.isArray(input.lines) || !input.lines.length) fail('Add at least one line item.');

  const resolvedLines = [];
  for (const line of input.lines) {
    const sku = await Sku.findOne({ _id: uid(line.sku, 'SKU'), merchant: merchant._id });
    if (!sku) fail(`SKU not found for this merchant: ${line.sku}`, 404);
    resolvedLines.push({ sku, ordered: positiveInt(line.quantity, 'quantity') });
  }

  const [order] = await ShopifyOrder.create([{
    merchant: merchant._id,
    shopifyOrderId: `MANUAL-${randomUUID()}`,
    shopifyOrderName: text(input.reference, 200) || 'Manual test order',
    lineItems: resolvedLines.map(({ sku, ordered }) => ({
      sku: sku.sku, shopifySkuRef: sku._id, title: sku.productTitle, quantity: ordered, fulfillableQuantity: ordered,
    })),
    fulfillmentStatus: 'unfulfilled',
  }]);

  const job = await reserveAndCreateJob(merchant, order, resolvedLines);
  const result = { order: order.toObject(), job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'MANUAL_JOB_CREATED', warehouse: job.warehouse, result });
  return result;
}

/** Shared by the manual-order path (Phase A) and, later, the real webhook
 *  ingest path (Phase B) — reserves stock against InventoryLevel for each
 *  line and creates the FulfillmentJob in the status that reservation
 *  earned it. Insufficient stock on ANY line flags the whole job for
 *  admin review rather than silently shipping the rest short. */
async function reserveAndCreateJob(merchant, order, resolvedLines) {
  let short = false;
  const notes = [];
  const jobLines = [];
  for (const { sku, ordered } of resolvedLines) {
    let level = await InventoryLevel.findOne({ merchant: merchant._id, sku: sku._id, warehouse: merchant.warehouse });
    if (!level) {
      level = await InventoryLevel.create({ merchant: merchant._id, sku: sku._id, site: merchant.site, warehouse: merchant.warehouse });
    }
    const available = level.onHand - level.reserved;
    const toReserve = Math.min(Math.max(available, 0), ordered);
    if (toReserve < ordered) {
      short = true;
      notes.push(`${sku.sku}: needed ${ordered}, only ${Math.max(available, 0)} available`);
    }
    if (toReserve > 0) {
      level.reserved += toReserve;
      await level.save();
    }
    jobLines.push({ sku: sku._id, ordered, picked: 0, reserved: toReserve, pickLocationHint: sku.defaultLocation || null });
  }

  const [job] = await FulfillmentJob.create([{
    merchant: merchant._id,
    shopifyOrder: order._id,
    site: merchant.site,
    warehouse: merchant.warehouse,
    status: short ? 'PARTIAL_BACKORDER' : 'READY_TO_PICK',
    lines: jobLines,
    backorderFlaggedAt: short ? new Date() : null,
    backorderNote: short ? notes.join('; ') : '',
  }]);
  return job;
}

export async function assignWorker(ctx, jobId, workerId) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (['SHIPPED', 'CANCELLED'].includes(job.status)) fail('This job is already closed.', 409);
  job.assignedWorker = objectId(workerId, 'worker');
  if (job.status === 'READY_TO_PICK') job.status = 'PICKING';
  await job.save();
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'JOB_ASSIGNED', warehouse: job.warehouse, result });
  return result;
}

/** Records units picked against one line. Moves the job to PICKING on the
 *  first pick and to PICKED once every line is fully picked. */
export async function pickFulfillmentLine(ctx, jobId, { sku, quantity }) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (!['READY_TO_PICK', 'PICKING'].includes(job.status)) fail('This job is not ready to pick.', 409);
  const line = job.lines.find(l => String(l.sku) === String(sku));
  if (!line) fail('That SKU is not on this job.', 404);
  const qty = positiveInt(quantity, 'picked quantity');
  if (line.picked + qty > line.ordered) fail(`Cannot pick more than ordered (${line.ordered}) for this line.`);
  line.picked += qty;
  job.status = job.lines.every(l => l.picked >= l.ordered) ? 'PICKED' : 'PICKING';
  await job.save();
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'LINE_PICKED', warehouse: job.warehouse, result });
  return result;
}

export async function markPacked(ctx, jobId) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (job.status !== 'PICKED') fail('All lines must be fully picked before packing.', 409);
  job.status = 'PACKED';
  job.packedAt = new Date();
  await job.save();
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'JOB_PACKED', warehouse: job.warehouse, result });
  return result;
}

/**
 * Ships the job: consumes the reservation (decrements onHand by what was
 * physically picked, and reserved by what this job's lines held) and
 * records carrier/tracking. Phase A stops here — pushing the Fulfillment to
 * Shopify (createFulfillment from services/shopify.js) is wired in during
 * Phase B, once real orders exist to push it against.
 */
export async function markShipped(ctx, jobId, { carrier, trackingNumber }) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (job.status !== 'PACKED') fail('Job must be packed before it can ship.', 409);
  const carrierName = text(carrier, 100);
  const tracking = text(trackingNumber, 100);
  if (!carrierName || !tracking) fail('Carrier and tracking number are required.');

  for (const line of job.lines) {
    const level = await InventoryLevel.findOne({ merchant: job.merchant, sku: line.sku, warehouse: job.warehouse });
    if (level) {
      level.onHand = Math.max(0, level.onHand - line.picked);
      level.reserved = Math.max(0, level.reserved - line.reserved);
      await level.save();
    }
  }

  job.carrier = carrierName;
  job.trackingNumber = tracking;
  job.status = 'SHIPPED';
  job.shippedAt = new Date();
  await job.save();

  await ShopifyOrder.updateOne({ _id: job.shopifyOrder }, { $set: { fulfillmentStatus: 'fulfilled' } });
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'JOB_SHIPPED', warehouse: job.warehouse, result });
  return result;
}

/** An admin's call on a PARTIAL_BACKORDER job: either cancel it (releasing
 *  whatever was reserved back to available stock) or explicitly approve
 *  shipping what's currently reserved, capping each line's `ordered` down
 *  to its own `reserved` amount so pick/pack/ship proceeds against a job
 *  that can actually be completed. Never happens silently — this is the one
 *  path where a rep chooses to under-ship, not something the system decides
 *  on its own. Waiting for restock (the third option) is simply not calling
 *  this at all — nothing here re-runs the reservation automatically, since
 *  a delayed order might be cancelled by the customer before stock arrives. */
export async function resolveBackorder(ctx, jobId, { action, note }) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (job.status !== 'PARTIAL_BACKORDER') fail('This job is not flagged as a backorder.', 409);
  if (action === 'cancel') {
    for (const line of job.lines) {
      const level = await InventoryLevel.findOne({ merchant: job.merchant, sku: line.sku, warehouse: job.warehouse });
      if (level) { level.reserved = Math.max(0, level.reserved - line.reserved); await level.save(); }
      line.reserved = 0;
    }
    job.status = 'CANCELLED';
  } else if (action === 'ship_partial') {
    for (const line of job.lines) line.ordered = line.reserved;
    job.status = 'READY_TO_PICK';
  } else {
    fail('action must be "cancel" or "ship_partial".');
  }
  job.backorderNote = text(note, 2000) || job.backorderNote;
  await job.save();
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'BACKORDER_RESOLVED', warehouse: job.warehouse, result });
  return result;
}
