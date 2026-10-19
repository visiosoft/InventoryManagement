import mongoose from 'mongoose';
import { Counter } from './index.js';

const { Schema, model } = mongoose;

export const CLIENT_REQUEST_TYPES = ['service', 'extend', 'moveout', 'deposit_refund', 'id_check', 'booking_review', 'new_signup'];
export const CLIENT_REQUEST_TEAMS = ['warehouse', 'sales', 'accounts'];
export const CLIENT_REQUEST_STATUSES = ['new', 'in_progress', 'waiting_customer', 'resolved', 'declined', 'cancelled'];
export const OPEN_STATUSES = ['new', 'in_progress', 'waiting_customer'];
export const CLOSED_STATUSES = ['resolved', 'declined', 'cancelled'];
export const SOURCE_KINDS = ['ServiceRequest', 'CustomerRequest', 'Document', 'Quote', 'Customer'];
export const ACTIVITY_KINDS = ['created', 'assigned', 'claimed', 'status', 'note', 'action', 'customer_message', 'escalated', 'synced'];

/* One thing a customer did in the app that a person here has to act on — a
 * valet booking, an extension or early move-out, a deposit refund, an ID to
 * check, a paid booking that could not become a contract, a new sign-up.
 *
 * Before this, each of those landed in its own collection and reached nobody.
 * This is the staff inbox row on top of them: who owns it, by when, what was
 * said and decided. The underlying record (`source`) stays the truth about the
 * request itself; this is the truth about who is handling it.
 *
 * (source.kind, source.id, type) is unique, so a hook firing twice — a webhook
 * redelivered, a backfill re-run — finds the row already there. */
const activitySchema = new Schema({
  at: { type: Date, default: Date.now },
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  kind: { type: String, enum: ACTIVITY_KINDS, required: true },
  text: { type: String, default: '' },
}, { _id: false });

const clientRequestSchema = new Schema({
  ref: { type: String, required: true, unique: true },
  type: { type: String, enum: CLIENT_REQUEST_TYPES, required: true },
  team: { type: String, enum: CLIENT_REQUEST_TEAMS, required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
  source: {
    kind: { type: String, enum: SOURCE_KINDS, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  // id_check only: every upload in the batch, the source document first. A
  // front and a back arrive as two uploads and are checked as one.
  documents: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
  // new_signup: the lead made from it.
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  title: { type: String, default: '' },
  summary: { type: String, default: '' },
  status: { type: String, enum: CLIENT_REQUEST_STATUSES, default: 'new' },
  // null = sitting in the team pool for whoever picks it up.
  assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  dueAt: { type: Date, default: null },
  // Set once, by the overdue job, so a late request is escalated once.
  escalatedAt: { type: Date, default: null },
  priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
  activity: { type: [activitySchema], default: [] },
  resolution: {
    type: new Schema({
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      byName: { type: String, default: '' },
      outcome: { type: String, default: '' },
      reason: { type: String, default: '' },
    }, { _id: false }),
    default: null,
  },
}, { timestamps: true });
clientRequestSchema.index({ 'source.kind': 1, 'source.id': 1, type: 1 }, { unique: true });
clientRequestSchema.index({ team: 1, status: 1, dueAt: 1 });
clientRequestSchema.index({ assignee: 1, status: 1 });
clientRequestSchema.index({ customer: 1, type: 1, status: 1 });
clientRequestSchema.index({ status: 1, dueAt: 1, escalatedAt: 1 });

export const ClientRequest = model('ClientRequest', clientRequestSchema);

export async function nextClientRequestNo() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'client-request' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `CR-${String(counter.seq).padStart(4, '0')}`;
}
