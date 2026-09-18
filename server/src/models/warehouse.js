import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { softDeletePlugin } from '../utils/softDelete.js';

const { Schema, model } = mongoose;
const uuid = () => ({ type: String, default: randomUUID });
const ref = (name, required = false) => ({ type: Schema.Types.ObjectId, ref: name, required });
export const CONTAINER_TYPES = ['BOX', 'SUITCASE', 'BAG', 'FURNITURE', 'LOOSE_ITEM', 'PALLET', 'TOTE', 'DOCUMENT_BOX', 'OTHER'];
export const CONTAINER_STATES = ['CREATED', 'RECEIVED', 'AWAITING_PUTAWAY', 'IN_STORAGE', 'DISPATCHED'];
export const LOCATION_TYPES = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN', 'RECEIVING', 'PACKING', 'DISPATCH'];

const locationSchema = new Schema({
  _id: uuid(), displayCode: { type: String, required: true, unique: true },
  name: { type: String, required: true, maxlength: 120 },
  site: ref('Site', true), warehouse: { type: String, required: true },
  parent: { type: String, ref: 'WarehouseLocation', default: null },
  kind: { type: String, enum: LOCATION_TYPES, required: true },
  maxContainers: { type: Number, min: 1, default: null },
  maxWeight: { type: Number, min: 0, default: null },
  maxVolume: { type: Number, min: 0, default: null },
  usedContainers: { type: Number, default: 0, min: 0 },
  usedWeight: { type: Number, default: 0, min: 0 },
  usedVolume: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
locationSchema.index({ site: 1, warehouse: 1, displayCode: 1 });

const containerSchema = new Schema({
  _id: uuid(), displayCode: { type: String, required: true, unique: true },
  type: { type: String, enum: CONTAINER_TYPES, required: true },
  customer: ref('Customer', true), booking: ref('Contract'), unit: ref('Unit'), site: ref('Site', true),
  warehouse: { type: String, required: true },
  description: { type: String, maxlength: 1000, default: '' },
  contents: { type: String, maxlength: 4000, default: '' },
  condition: { type: String, enum: ['GOOD', 'WORN', 'DAMAGED'], default: 'GOOD' },
  weight: { type: Number, min: 0, default: null },
  length: { type: Number, min: 0, default: null },
  width: { type: Number, min: 0, default: null },
  height: { type: Number, min: 0, default: null },
  volume: { type: Number, min: 0, default: null },
  currentStatus: { type: String, enum: CONTAINER_STATES, default: 'CREATED' },
  currentLocation: { type: String, ref: 'WarehouseLocation', default: null },
  lastScanAt: Date, lastScanBy: ref('User'), storedAt: Date,
  photoCount: { type: Number, default: 0 },
  revision: { type: Number, default: 0 },
}, { timestamps: true });
containerSchema.index({ customer: 1, createdAt: -1 });
containerSchema.index({ site: 1, currentStatus: 1, currentLocation: 1 });
containerSchema.index({ booking: 1 });
// Deleting an item never erases its history — the scan-event chain of
// custody stays intact and queryable by objectId either way. Same
// soft-delete convention as the rest of the app.
containerSchema.plugin(softDeletePlugin);

const eventSchema = new Schema({
  _id: uuid(), requestId: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  barcode: { type: String, required: true }, objectType: { type: String, required: true },
  objectId: { type: String, required: true }, eventType: { type: String, required: true },
  customer: ref('Customer'), booking: ref('Contract'), site: ref('Site'), warehouse: String,
  previousLocation: String, currentLocation: String, destinationLocation: String,
  previousStatus: String, newStatus: String,
  employee: ref('User', true), deviceId: String,
  timestamp: { type: Date, default: Date.now, immutable: true },
  notes: { type: String, maxlength: 2000 },
  result: Schema.Types.Mixed,
}, { versionKey: false });
eventSchema.index({ objectId: 1, timestamp: -1 });
eventSchema.index({ customer: 1, timestamp: -1 });
// No route exposes mutations, and model operations fail closed. Production DB
// roles should additionally deny update/delete on warehouse_scan_events.
eventSchema.pre('save', function () { if (!this.isNew) throw new Error('Scan events are immutable'); });
eventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () { throw new Error('Scan events are immutable'); });
eventSchema.pre('deleteOne', { document: true, query: false }, function () { throw new Error('Scan events are immutable'); });
eventSchema.pre('bulkWrite', function () { throw new Error('Scan events are immutable'); });

const photoSchema = new Schema({
  _id: uuid(), container: { type: String, ref: 'StoredContainer', required: true, index: true },
  data: { type: Buffer, required: true, select: false },
  mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
  employee: ref('User', true), createdAt: { type: Date, default: Date.now },
});
const counterSchema = new Schema({ _id: String, value: { type: Number, default: 0 } });

export const StoredContainer = model('StoredContainer', containerSchema);
export const WarehouseLocation = model('WarehouseLocation', locationSchema);
export const ScanEvent = model('WarehouseScanEvent', eventSchema, 'warehouse_scan_events');
export const ItemPhoto = model('WarehouseItemPhoto', photoSchema);
export const WarehouseCounter = model('WarehouseCounter', counterSchema);
