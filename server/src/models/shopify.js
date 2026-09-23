import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const { Schema, model } = mongoose;
const uuid = () => ({ type: String, default: randomUUID });
const ref = (name, required = false) => ({ type: Schema.Types.ObjectId, ref: name, required });
// Merchant/Sku/ShopifyOrder/FulfillmentJob below all use a UUID string _id
// (matching models/warehouse.js's StoredContainer/WarehouseLocation/
// WarehouseJob convention), so referencing any of them needs a String ref,
// not an ObjectId one — same reason warehouse.js's own `containers`/
// `currentLocation` fields are typed `String` rather than reusing its `ref()`.
const uref = (name, required = false) => ({ type: String, ref: name, required });

export const FULFILLMENT_STATES = [
  'AWAITING_STOCK', 'READY_TO_PICK', 'PICKING', 'PICKED', 'PACKED', 'SHIPPED',
  'PARTIAL_BACKORDER', 'CANCELLED',
];

// One row per Shopify store this warehouse fulfills for. Credentials are
// encrypted at rest (see utils/crypto.js) — unlike the single-tenant
// integrations (Stripe/Zoho/WhatsApp), these are per-merchant secrets that
// grant live write access to someone else's store if the database ever
// leaked, not an operator-controlled .env value.
const merchantSchema = new Schema({
  _id: uuid(),
  name: { type: String, required: true, maxlength: 200 },
  shopDomain: { type: String, required: true, unique: true, lowercase: true, trim: true },
  adminApiAccessTokenEnc: { type: String, required: true, select: false },
  adminApiAccessTokenIv: { type: String, required: true, select: false },
  adminApiAccessTokenTag: { type: String, required: true, select: false },
  webhookSecretEnc: { type: String, default: '', select: false },
  webhookSecretIv: { type: String, default: '', select: false },
  webhookSecretTag: { type: String, default: '', select: false },
  apiVersion: { type: String, default: '2025-01' },
  // Which PurpleBox facility/warehouse code fulfills this merchant's orders.
  site: ref('Site', true),
  warehouse: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  lastInventorySyncAt: { type: Date, default: null },
  lastOrderWebhookAt: { type: Date, default: null },
  createdBy: ref('User', true),
}, { timestamps: true });
merchantSchema.index({ isActive: 1 });

// A merchant's product variant — the unit inventory is actually tracked
// against. Not unique on `sku` alone: Shopify does not enforce SKU
// uniqueness within a shop, so two variants can legitimately share one.
const skuSchema = new Schema({
  _id: uuid(),
  merchant: uref('Merchant', true),
  shopifyProductId: { type: String, required: true },
  shopifyVariantId: { type: String, required: true },
  sku: { type: String, required: true, trim: true },
  productTitle: { type: String, default: '' },
  variantTitle: { type: String, default: '' },
  barcode: { type: String, default: '' },
  // Advisory only — where a picker should look first. Not capacity-enforced
  // the way a StoredContainer's currentLocation is; SKU stock is fungible
  // quantity, not individually-scanned items, so it isn't tied into
  // WarehouseLocation's used-counters.
  defaultLocation: { type: String, ref: 'WarehouseLocation', default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });
skuSchema.index({ merchant: 1, shopifyVariantId: 1 }, { unique: true });
skuSchema.index({ merchant: 1, sku: 1 });

// Quantity on hand per (merchant, sku, warehouse). Deliberately warehouse-
// level, not per-bin — see the plan's design-decision note on why bin-level
// SKU accounting was scoped out of this first pass.
const inventoryLevelSchema = new Schema({
  _id: uuid(),
  merchant: uref('Merchant', true),
  sku: uref('Sku', true),
  site: ref('Site', true),
  warehouse: { type: String, required: true },
  onHand: { type: Number, default: 0, min: 0 },
  // Allocated to open FulfillmentJobs, not yet shipped. `available` is
  // derived (onHand - reserved) wherever it's needed, never stored, so the
  // two numbers can't drift apart.
  reserved: { type: Number, default: 0, min: 0 },
  shopifyInventoryItemId: { type: String, default: '' },
  lastSyncedAt: { type: Date, default: null },
}, { timestamps: true });
inventoryLevelSchema.index({ merchant: 1, sku: 1, warehouse: 1 }, { unique: true });

// The system-of-record copy of what Shopify told us about an order. Kept
// separate from FulfillmentJob so a webhook replay (orders/updated) can
// refresh line items/status here without touching in-progress pick/pack
// state on the job itself.
const shopifyOrderSchema = new Schema({
  _id: uuid(),
  merchant: uref('Merchant', true),
  shopifyOrderId: { type: String, required: true },
  shopifyOrderName: { type: String, default: '' },
  lineItems: [{
    _id: false,
    sku: { type: String, default: '' },
    shopifySkuRef: { type: String, ref: 'Sku', default: null },
    title: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    fulfillableQuantity: { type: Number, default: 0, min: 0 },
  }],
  shippingAddress: {
    name: String, address1: String, address2: String, city: String,
    province: String, zip: String, country: String, phone: String,
  },
  financialStatus: { type: String, default: '' },
  fulfillmentStatus: { type: String, default: '' },
  rawWebhookPayload: { type: Schema.Types.Mixed, default: null },
  receivedAt: { type: Date, default: Date.now },
}, { timestamps: true });
shopifyOrderSchema.index({ merchant: 1, shopifyOrderId: 1 }, { unique: true });

// The actual pick -> pack -> ship work item. Not a WarehouseJob variant —
// see the plan's design-decision note: WarehouseJob is shaped around a
// single external partner coordinating pickup/delivery of already-known
// containers at a customer's address, which doesn't fit an internal
// SKU/quantity pick-pack-ship pipeline.
const fulfillmentJobSchema = new Schema({
  _id: uuid(),
  merchant: uref('Merchant', true),
  shopifyOrder: uref('ShopifyOrder', true),
  site: ref('Site', true),
  warehouse: { type: String, required: true },
  status: { type: String, enum: FULFILLMENT_STATES, default: 'AWAITING_STOCK' },
  lines: [{
    _id: false,
    sku: { type: String, ref: 'Sku', required: true },
    ordered: { type: Number, required: true, min: 0 },
    picked: { type: Number, default: 0, min: 0 },
    // How much of InventoryLevel.reserved (an aggregate across every open
    // job for that sku/warehouse) belongs to this line specifically — set
    // once at reservation time, since the aggregate alone can't be
    // unwound back to a single line's share later (e.g. resolveBackorder
    // needs to know exactly how much THIS line holds, not the total).
    reserved: { type: Number, default: 0, min: 0 },
    pickLocationHint: { type: String, ref: 'WarehouseLocation', default: null },
  }],
  assignedWorker: ref('User'),
  packedAt: { type: Date, default: null },
  carrier: { type: String, default: '' },
  trackingNumber: { type: String, default: '' },
  shippedAt: { type: Date, default: null },
  shopifyFulfillmentId: { type: String, default: '' },
  // Set if the local ship-confirmation succeeded but pushing the Fulfillment
  // to Shopify failed — the physical shipment already happened, so this
  // never blocks the worker; a retry loop clears it once the push succeeds.
  shopifyPushFailedAt: { type: Date, default: null },
  backorderFlaggedAt: { type: Date, default: null },
  backorderNote: { type: String, default: '' },
}, { timestamps: true });
fulfillmentJobSchema.index({ merchant: 1, status: 1, createdAt: -1 });
// One fulfillment job per order in this first pass — no split-shipment yet.
fulfillmentJobSchema.index({ shopifyOrder: 1 }, { unique: true });

export const Merchant = model('Merchant', merchantSchema);
export const Sku = model('Sku', skuSchema);
export const InventoryLevel = model('InventoryLevel', inventoryLevelSchema);
export const ShopifyOrder = model('ShopifyOrder', shopifyOrderSchema);
export const FulfillmentJob = model('FulfillmentJob', fulfillmentJobSchema);
