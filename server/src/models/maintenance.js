import mongoose from 'mongoose';
import { Counter } from './index.js';

const { Schema, model } = mongoose;

/** Maintenance tickets (WP-11). Enums from the spec, section 8.2. */
export const TICKET_CATEGORIES = ['ac', 'access', 'elevator', 'cctv', 'fire', 'cleaning', 'lighting', 'pest', 'inspection', 'incident', 'general'];
export const TICKET_SEVERITIES = ['S1', 'S2', 'S3', 'S4'];
export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'awaiting_parts', 'resolved', 'closed'];
export const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'awaiting_parts'];

const ticketSchema = new Schema({
   ticketNo: { type: String, required: true, unique: true },
   site: { type: Schema.Types.ObjectId, ref: 'Site', default: null },
   units: [{ type: Schema.Types.ObjectId, ref: 'Unit' }],
   category: { type: String, enum: TICKET_CATEGORIES, default: 'general' },
   severity: { type: String, enum: TICKET_SEVERITIES, default: 'S3' },
   status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
   description: { type: String, default: '' },
   photos: [{ type: String }],
   owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
   vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
   responseDueAt: { type: Date, default: null },
   resolveDueAt: { type: Date, default: null },
   respondedAt: { type: Date, default: null },
   costEstimate: { type: Number, default: null },
   costActual: { type: Number, default: null },
   resolvedAt: { type: Date, default: null },
   closedAt: { type: Date, default: null },
   createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
   backfilled: { type: Boolean, default: false },
}, { timestamps: true });
ticketSchema.index({ units: 1, status: 1 });

// Append only: one row per status change.
const historySchema = new Schema({
   ticket: { type: Schema.Types.ObjectId, ref: 'MaintenanceTicket', required: true, index: true },
   fromStatus: { type: String, default: '' },
   toStatus: { type: String, required: true },
   user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
   userName: { type: String, default: '' },
   note: { type: String, default: '' },
   at: { type: Date, default: Date.now },
}, { versionKey: false });

export const MaintenanceTicket = model('MaintenanceTicket', ticketSchema);
export const MaintenanceTicketHistory = model('MaintenanceTicketHistory', historySchema);

/** MT-000001, MT-000002, … */
export async function nextTicketNo() {
   const c = await Counter.findOneAndUpdate({ key: 'maintenance-ticket' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
   return `MT-${String(c.seq).padStart(6, '0')}`;
}
