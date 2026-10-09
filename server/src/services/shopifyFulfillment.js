import { randomUUID } from 'node:crypto';
import { command } from './warehouse.js';
import { fail } from './warehouseRules.js';
import { ScanEvent } from '../models/warehouse.js';
import { Merchant, Sku, InventoryLevel, ShopifyOrder, FulfillmentJob } from '../models/shopify.js';
import { fetchProductsAndVariants, createFulfillment, setAvailableQuantities } from './shopify.js';

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
          shopifyInventoryItemId: v.shopifyInventoryItemId,
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
  scheduleInventoryPush(merchant._id);
  const result = { order: order.toObject(), job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'MANUAL_JOB_CREATED', warehouse: job.warehouse, result });
  return result;
}

const levelKey = (merchantId, skuId, warehouse) => ({ merchant: merchantId, sku: skuId, warehouse });

async function ensureLevel(merchant, skuId) {
  // Upsert, not find-then-create: two orders for a never-stocked SKU arriving
  // together would otherwise both try to insert and one would hit the unique index.
  await InventoryLevel.updateOne(
    levelKey(merchant._id, skuId, merchant.warehouse),
    { $setOnInsert: { _id: randomUUID(), site: merchant.site } },
    { upsert: true },
  );
}

/**
 * Reserves up to `wanted` units, never more than are free. The increment is
 * conditional on the stock not having moved since it was read, so two orders
 * racing for the last few units can't both get them — the loser re-reads and
 * takes what's left. Returns how many units it actually reserved.
 */
async function reserveUpTo(merchant, skuId, wanted) {
  await ensureLevel(merchant, skuId);
  const key = levelKey(merchant._id, skuId, merchant.warehouse);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const level = await InventoryLevel.findOne(key).lean();
    const take = Math.min(Math.max(level.onHand - level.reserved, 0), wanted);
    if (take <= 0) return 0;
    const res = await InventoryLevel.updateOne(
      { ...key, onHand: level.onHand, reserved: level.reserved },
      { $inc: { reserved: take } },
    );
    if (res.modifiedCount) return take;
  }
  return 0;
}

/** Gives reserved units back (cancellation), or consumes them along with
 *  on-hand stock (shipment). Floors at zero rather than going negative. */
async function releaseStock(merchantId, skuId, warehouse, { reserved = 0, onHand = 0 }) {
  if (!reserved && !onHand) return;
  await InventoryLevel.updateOne(levelKey(merchantId, skuId, warehouse), [{
    $set: {
      reserved: { $max: [0, { $subtract: ['$reserved', reserved] }] },
      onHand: { $max: [0, { $subtract: ['$onHand', onHand] }] },
      updatedAt: '$$NOW',
    },
  }]);
}

/** Shared by the manual-order path and the Shopify webhook ingest path —
 *  reserves stock against InventoryLevel for each line and creates the
 *  FulfillmentJob in the status that reservation earned it. Insufficient
 *  stock on ANY line (or a line we can't match to a SKU) flags the whole job
 *  for admin review rather than silently shipping the rest short. */
async function reserveAndCreateJob(merchant, order, resolvedLines, extraNotes = []) {
  let short = extraNotes.length > 0;
  const notes = [...extraNotes];
  const jobLines = [];
  for (const { sku, ordered } of resolvedLines) {
    const toReserve = await reserveUpTo(merchant, sku._id, ordered);
    if (toReserve < ordered) {
      short = true;
      notes.push(`${sku.sku}: needed ${ordered}, only ${toReserve} available`);
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
 * records carrier/tracking. Telling Shopify is pushFulfillment()'s job, run
 * after this — a Shopify outage must never stop a parcel that has physically
 * left from being recorded as shipped here.
 */
export async function markShipped(ctx, jobId, { carrier, trackingNumber }) {
  const job = await FulfillmentJob.findById(uid(jobId, 'job'));
  if (!job) fail('Fulfillment job not found.', 404);
  if (job.status !== 'PACKED') fail('Job must be packed before it can ship.', 409);
  const carrierName = text(carrier, 100);
  const tracking = text(trackingNumber, 100);
  if (!carrierName || !tracking) fail('Carrier and tracking number are required.');

  for (const line of job.lines) {
    await releaseStock(job.merchant, line.sku, job.warehouse, { onHand: line.picked, reserved: line.reserved });
  }

  job.carrier = carrierName;
  job.trackingNumber = tracking;
  job.status = 'SHIPPED';
  job.shippedAt = new Date();
  await job.save();

  await ShopifyOrder.updateOne({ _id: job.shopifyOrder }, { $set: { fulfillmentStatus: 'fulfilled' } });
  scheduleInventoryPush(job.merchant);
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
    await releaseJobReservations(job);
    job.status = 'CANCELLED';
  } else if (action === 'ship_partial') {
    if (!job.lines.some(l => l.reserved > 0)) fail('Nothing is reserved for this job yet — cancel it or wait for stock.', 409);
    for (const line of job.lines) line.ordered = line.reserved;
    job.status = 'READY_TO_PICK';
  } else if (action === 'retry') {
    // Stock has arrived since: try to top up each short line.
    const merchant = await Merchant.findById(job.merchant);
    const notes = [];
    for (const line of job.lines) {
      const missing = line.ordered - line.reserved;
      if (missing > 0) line.reserved += await reserveUpTo(merchant, line.sku, missing);
      if (line.reserved < line.ordered) {
        const sku = await Sku.findById(line.sku).lean();
        notes.push(`${sku?.sku || line.sku}: needed ${line.ordered}, only ${line.reserved} reserved`);
      }
    }
    if (job.lines.length && !notes.length) {
      job.status = 'READY_TO_PICK';
      job.backorderFlaggedAt = null;
      job.backorderNote = '';
    } else if (notes.length) {
      job.backorderNote = notes.join('; ');
    }
  } else {
    fail('action must be "cancel", "ship_partial" or "retry".');
  }
  if (action !== 'retry') job.backorderNote = text(note, 2000) || job.backorderNote;
  await job.save();
  scheduleInventoryPush(job.merchant);
  const result = { job: job.toObject() };
  await logEvent(ctx, { barcode: job._id, objectType: 'FULFILLMENT_JOB', objectId: job._id, eventType: 'BACKORDER_RESOLVED', warehouse: job.warehouse, result });
  return result;
}

async function releaseJobReservations(job) {
  for (const line of job.lines) {
    await releaseStock(job.merchant, line.sku, job.warehouse, { reserved: line.reserved });
    line.reserved = 0;
  }
}

/**
 * Receiving and stock counts. 'add' books in a delivery (or, negative, takes
 * out damaged stock); 'set' records a physical count. On-hand can never go
 * below what open jobs already have reserved — those units are promised to
 * orders, so the job has to be resolved first.
 */
export async function adjustStock(ctx, input) {
  const merchant = await Merchant.findById(uid(input.merchant, 'merchant'));
  if (!merchant) fail('Merchant not found.', 404);
  const sku = await Sku.findOne({ _id: uid(input.sku, 'SKU'), merchant: merchant._id });
  if (!sku) fail('SKU not found for this merchant.', 404);
  const qty = Number(input.quantity);
  if (!Number.isInteger(qty)) fail('Quantity must be a whole number.');
  if (!['add', 'set'].includes(input.mode)) fail('mode must be "add" or "set".');
  if (input.mode === 'set' && qty < 0) fail('A stock count cannot be negative.');
  if (input.mode === 'add' && qty === 0) fail('Enter a quantity to add or remove.');

  await ensureLevel(merchant, sku._id);
  const key = levelKey(merchant._id, sku._id, merchant.warehouse);
  const before = await InventoryLevel.findOne(key).lean();
  const target = input.mode === 'set' ? qty : before.onHand + qty;
  if (target < before.reserved) {
    fail(`On hand can't go below ${before.reserved} — that many are reserved for open orders.`, 409);
  }
  // Conditional on nothing having moved since it was read, same as reserveUpTo.
  const res = await InventoryLevel.updateOne({ ...key, onHand: before.onHand, reserved: before.reserved }, { $set: { onHand: target } });
  if (!res.matchedCount) fail('Stock changed while you were editing — refresh and try again.', 409);

  scheduleInventoryPush(merchant._id);
  const result = { sku: sku._id, before: before.onHand, onHand: target, reserved: before.reserved, available: target - before.reserved };
  await logEvent(ctx, {
    barcode: sku.barcode || sku.sku, objectType: 'SHOPIFY_SKU', objectId: sku._id,
    eventType: input.mode === 'set' ? 'STOCK_COUNTED' : 'STOCK_ADJUSTED', warehouse: merchant.warehouse,
    notes: text(input.note, 500), result,
  });
  return result;
}

/* ── Phase B: orders arriving from Shopify ─────────────────────────────── */

const shippingAddressOf = a => (a ? {
  name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' '),
  address1: a.address1 || '', address2: a.address2 || '', city: a.city || '',
  province: a.province || '', zip: a.zip || '', country: a.country || '', phone: a.phone || '',
} : undefined);

/**
 * Handles one verified orders/create, orders/updated or orders/cancelled
 * webhook. Always refreshes our copy of the order. Creates the fulfillment
 * job the first time an order with shippable items is seen, and cancels it
 * (handing reserved stock back) if the order is cancelled before it ships.
 *
 * Unpaid orders are not held back: cash on delivery is common here, and those
 * stay "pending" in Shopify until the courier collects.
 */
export async function ingestOrderWebhook(merchant, topic, payload) {
  if (!payload?.id) fail('Order payload has no id.');
  const shopifyOrderId = String(payload.id);
  const cancelled = topic === 'orders/cancelled' || Boolean(payload.cancelled_at);

  const shippable = (payload.line_items || []).filter(li => li.requires_shipping !== false);
  const variantIds = [...new Set(shippable.map(li => li.variant_id && String(li.variant_id)).filter(Boolean))];
  const skus = await Sku.find({ merchant: merchant._id, shopifyVariantId: { $in: variantIds } }).lean();
  const skuByVariant = new Map(skus.map(s => [s.shopifyVariantId, s]));

  const order = await ShopifyOrder.findOneAndUpdate(
    { merchant: merchant._id, shopifyOrderId },
    {
      $set: {
        shopifyOrderName: payload.name || `#${payload.order_number || shopifyOrderId}`,
        lineItems: shippable.map(li => ({
          sku: li.sku || '',
          shopifySkuRef: skuByVariant.get(String(li.variant_id))?._id || null,
          title: [li.title, li.variant_title].filter(Boolean).join(' — '),
          quantity: Number(li.quantity) || 0,
          fulfillableQuantity: Number(li.fulfillable_quantity ?? li.quantity) || 0,
        })),
        shippingAddress: shippingAddressOf(payload.shipping_address),
        financialStatus: payload.financial_status || '',
        fulfillmentStatus: payload.fulfillment_status || 'unfulfilled',
        cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : (cancelled ? new Date() : null),
        rawWebhookPayload: payload,
      },
      $setOnInsert: { _id: randomUUID(), receivedAt: new Date() },
    },
    { upsert: true, new: true },
  );
  await Merchant.updateOne({ _id: merchant._id }, { $set: { lastOrderWebhookAt: new Date() } });

  const existing = await FulfillmentJob.findOne({ shopifyOrder: order._id });
  if (cancelled) {
    if (!existing || ['SHIPPED', 'CANCELLED'].includes(existing.status)) return { action: 'ignored', reason: existing ? existing.status : 'no job' };
    await releaseJobReservations(existing);
    existing.status = 'CANCELLED';
    existing.backorderNote = [existing.backorderNote, 'Order was cancelled in Shopify.'].filter(Boolean).join(' ');
    await existing.save();
    scheduleInventoryPush(merchant._id);
    return { action: 'cancelled', job: existing._id };
  }
  if (existing) return { action: 'updated', job: existing._id };
  if (payload.fulfillment_status === 'fulfilled') return { action: 'ignored', reason: 'already fulfilled in Shopify' };

  // Sum per variant (an order can list the same variant twice) and note
  // anything we can't match to a synced SKU.
  const wanted = new Map();
  const unknown = [];
  for (const li of shippable) {
    const qty = Number(li.fulfillable_quantity ?? li.quantity) || 0;
    if (qty <= 0) continue;
    const sku = skuByVariant.get(String(li.variant_id));
    if (!sku) { unknown.push(`${li.sku || li.title || 'Unknown item'} ×${qty} is not in the synced catalog`); continue; }
    wanted.set(sku._id, { sku, ordered: (wanted.get(sku._id)?.ordered || 0) + qty });
  }
  if (!wanted.size && !unknown.length) return { action: 'ignored', reason: 'nothing to ship' };

  const claimed = await ShopifyOrder.findOneAndUpdate({ _id: order._id, jobClaimedAt: null }, { $set: { jobClaimedAt: new Date() } });
  if (!claimed) return { action: 'ignored', reason: 'job already being created' };
  try {
    const job = await reserveAndCreateJob(merchant, order, [...wanted.values()], unknown);
    scheduleInventoryPush(merchant._id);
    return { action: 'created', job: job._id, status: job.status };
  } catch (e) {
    // Let the next delivery (Shopify retries on a non-2xx) try again.
    await ShopifyOrder.updateOne({ _id: order._id }, { $set: { jobClaimedAt: null } });
    throw e;
  }
}

/**
 * Tells Shopify a shipped job's items are fulfilled, with tracking — Shopify
 * then emails the customer. Never throws: a failure is stored on the job and
 * retried by retryFailedFulfillmentPushes(). Test orders made by hand are
 * skipped, there is nothing in Shopify to fulfil.
 */
export async function pushFulfillment(jobId) {
  const job = await FulfillmentJob.findById(jobId);
  if (!job || job.status !== 'SHIPPED' || job.shopifyFulfillmentId) return { skipped: true };
  const order = await ShopifyOrder.findById(job.shopifyOrder).lean();
  if (!order || order.shopifyOrderId.startsWith('MANUAL-')) return { skipped: true, reason: 'test order' };

  const skus = await Sku.find({ _id: { $in: job.lines.map(l => l.sku) } }).lean();
  const variantOf = new Map(skus.map(s => [s._id, s.shopifyVariantId]));
  const quantities = {};
  for (const line of job.lines) {
    const variant = variantOf.get(String(line.sku));
    if (variant && line.picked > 0) quantities[variant] = (quantities[variant] || 0) + line.picked;
  }

  const update = { $inc: { shopifyPushAttempts: 1 } };
  try {
    const merchant = await Merchant.findById(job.merchant);
    const fulfillment = await createFulfillment(merchant, order.shopifyOrderId, {
      quantities, carrier: job.carrier, trackingNumber: job.trackingNumber,
    });
    update.$set = { shopifyFulfillmentId: fulfillment.id, shopifyPushFailedAt: null, shopifyPushError: '' };
  } catch (e) {
    update.$set = { shopifyPushFailedAt: new Date(), shopifyPushError: String(e.message || e).slice(0, 1000) };
  }
  await FulfillmentJob.updateOne({ _id: job._id, shopifyFulfillmentId: '' }, update);
  return { ok: !update.$set.shopifyPushError, error: update.$set.shopifyPushError || undefined };
}

/** Background retry for pushes that failed. Gives up after ten attempts —
 *  by then it needs a person (the order was probably changed in Shopify),
 *  who can retry from the job. */
export async function retryFailedFulfillmentPushes() {
  const jobs = await FulfillmentJob.find({
    status: 'SHIPPED', shopifyFulfillmentId: '', shopifyPushFailedAt: { $ne: null }, shopifyPushAttempts: { $lt: 10 },
  }).select('_id').limit(50).lean();
  let fixed = 0;
  for (const { _id } of jobs) if ((await pushFulfillment(_id)).ok) fixed += 1;
  return { tried: jobs.length, fixed };
}

/* ── Phase C: PurpleBox stock → Shopify ─────────────────────────────────── */

/**
 * Writes this warehouse's free stock (on hand minus reserved) to the
 * merchant's Shopify location. `full` pushes every SKU we hold a stock
 * record for; otherwise only those changed since the last push. SKUs the
 * warehouse has never recorded stock for are left alone, so turning sync on
 * doesn't zero out products the merchant stocks somewhere else.
 */
export async function pushInventory(merchantId, { full = false } = {}) {
  const merchant = await Merchant.findById(merchantId);
  if (!merchant) fail('Merchant not found.', 404);
  if (!merchant.isActive) fail('Merchant is not active.', 409);
  if (!merchant.shopifyLocationId) fail('Choose this warehouse\'s Shopify location first.', 409);

  const startedAt = new Date();
  const filter = { merchant: merchant._id, warehouse: merchant.warehouse };
  if (!full && merchant.lastInventoryPushAt) filter.updatedAt = { $gte: new Date(merchant.lastInventoryPushAt.getTime() - 60_000) };
  const levels = await InventoryLevel.find(filter).lean();
  const skus = await Sku.find({ _id: { $in: levels.map(l => l.sku) }, shopifyInventoryItemId: { $ne: '' } }).lean();
  const itemOf = new Map(skus.map(s => [s._id, s.shopifyInventoryItemId]));
  const items = levels
    .filter(l => itemOf.has(l.sku))
    .map(l => ({ inventoryItemId: itemOf.get(l.sku), quantity: l.onHand - l.reserved }));

  try {
    if (items.length) await setAvailableQuantities(merchant, merchant.shopifyLocationId, items);
  } catch (e) {
    await Merchant.updateOne({ _id: merchant._id }, { $set: { lastInventoryPushError: String(e.message || e).slice(0, 1000) } });
    throw e;
  }
  await Merchant.updateOne({ _id: merchant._id }, { $set: { lastInventoryPushAt: startedAt, lastInventoryPushError: '' } });
  if (items.length) {
    await InventoryLevel.updateMany(
      { merchant: merchant._id, warehouse: merchant.warehouse, sku: { $in: [...itemOf.keys()] } },
      { $set: { lastSyncedAt: startedAt } },
      { timestamps: false },
    );
  }
  return { pushed: items.length, skippedWithoutShopifyItem: levels.length - items.length };
}

/* A stock change pushes that merchant's stock half a minute later, so a burst
 * of picks or a receiving session becomes one Shopify call, not dozens. The
 * periodic sweep in index.js catches anything a restart lost. */
const pendingPushes = new Map();
export function scheduleInventoryPush(merchantId) {
  const key = String(merchantId);
  if (process.env.NODE_ENV === 'test' || pendingPushes.has(key)) return;
  pendingPushes.set(key, setTimeout(async () => {
    pendingPushes.delete(key);
    try {
      const merchant = await Merchant.findById(key).lean();
      if (merchant?.isActive && merchant.inventorySyncEnabled && merchant.shopifyLocationId) await pushInventory(key);
    } catch (e) {
      console.error('[Shopify] stock push failed:', e.message);
    }
  }, 30_000).unref());
}

/** The periodic sweep: every merchant with sync on, changed SKUs only. */
export async function runInventorySync() {
  const merchants = await Merchant.find({ isActive: true, inventorySyncEnabled: true, shopifyLocationId: { $ne: '' } }).select('_id name').lean();
  const results = [];
  for (const m of merchants) {
    try { results.push({ merchant: m.name, ...(await pushInventory(m._id)) }); }
    catch (e) { results.push({ merchant: m.name, error: e.message }); }
  }
  return results;
}
