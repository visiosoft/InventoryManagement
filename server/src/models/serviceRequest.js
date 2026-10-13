import mongoose from 'mongoose';
import { Counter } from './index.js';

const { Schema, model } = mongoose;

export const SERVICE_TYPES = ['supplies', 'pickup', 'dropoff', 'both', 'worker', 'disposal'];
export const DISPOSAL_LOADS = ['small', 'large'];
export const SERVICE_STATUSES = ['requested', 'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled'];

/* A valet job the customer booked from the app: boxes and labels sent out,
 * their packed things collected, stored items brought back, a worker or two
 * at their unit, or a dump truck to take away what they no longer want.
 *
 * This is the customer's side of the job. Physical custody of each item still
 * only changes through warehouse scans; `warehouseJob` is just staff linking
 * this request to the WarehouseJob that carries it out. Nothing is charged at
 * booking — `estimate` is what the app quoted, `charged` is what staff settle
 * on once the job is done. */
const serviceRequestSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
  ref: { type: String, required: true, unique: true },
  type: { type: String, enum: SERVICE_TYPES, required: true },
  status: { type: String, enum: SERVICE_STATUSES, default: 'requested' },
  // A calendar day in Dubai, kept as the string the customer picked so no
  // timezone conversion can ever move it to the day before.
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  slot: { type: String, default: null },        // pickup / drop-off / supplies
  startTime: { type: String, default: null },   // worker, 'HH:MM'
  hours: { type: Number, default: null },       // worker, in half hours (0.5, 1, 1.5 …)
  workers: { type: Number, default: null },     // worker, how many (1 or 2)
  address: {
    label: { type: String, default: '' },
    line: { type: String, default: '' },
  },
  pickup: {
    boxes: { type: Number, default: 0 },
    bulky: { type: Number, default: 0 },
    description: { type: String, default: '' },
  },
  supplies: {
    boxes: { type: Number, default: 0 },
    extraLabels: { type: Number, default: 0 },
  },
  disposal: {
    load: { type: String, enum: [...DISPOSAL_LOADS, null], default: null },
    description: { type: String, default: '' },
  },
  items: [{ type: String, ref: 'StoredContainer' }],
  job: { type: String, default: '' },
  notes: { type: String, default: '' },
  estimate: {
    lines: [{ _id: false, label: String, amount: Number }],
    total: { type: Number, default: 0 },
  },
  charged: { type: Number, default: null },
  statusLog: [{ _id: false, status: { type: String, enum: SERVICE_STATUSES }, at: { type: Date, default: Date.now } }],
  driverName: { type: String, default: '' },
  driverPhone: { type: String, default: '' },
  warehouseJob: { type: String, ref: 'WarehouseJob', default: null },
  staffNote: { type: String, default: '' },
}, { timestamps: true });
serviceRequestSchema.index({ customer: 1, createdAt: -1 });
// Capacity checks count the bookings on one day.
serviceRequestSchema.index({ date: 1, status: 1 });
serviceRequestSchema.index({ status: 1, createdAt: -1 });

export const ServiceRequest = model('ServiceRequest', serviceRequestSchema);

export async function nextServiceRequestNo() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'service-request' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `SR-${String(counter.seq).padStart(4, '0')}`;
}
