import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Approval rules and requests (WP-04). */
export const APPROVAL_ACTIONS = ['discount_pct', 'rate_change', 'total_change', 'checkout_change', 'write_off', 'refund', 'contract_terms'];

const ruleSchema = new Schema({
   action: { type: String, enum: APPROVAL_ACTIONS, required: true },
   operator: { type: String, enum: ['gt', 'any'], default: 'gt' },
   threshold: { type: Number, default: 0 },
   requiredRole: { type: String, default: 'admin' },
   label: { type: String, default: '' },
   active: { type: Boolean, default: false },
   provisional: { type: Boolean, default: true },
   version: { type: Number, default: 1 },
   history: [{ at: Date, by: String, change: String, _id: false }],
}, { timestamps: true });

const requestSchema = new Schema({
   action: { type: String, required: true },
   entity: { type: String, enum: ['contract'], default: 'contract' },
   entityId: { type: Schema.Types.ObjectId, required: true, index: true },
   entityLabel: { type: String, default: '' },
   requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
   requestedByName: { type: String, default: '' },
   proposed: { type: Schema.Types.Mixed, default: {} },
   old: { type: Schema.Types.Mixed, default: {} },
   reason: { type: String, default: '' },
   rule: { type: Schema.Types.ObjectId, ref: 'ApprovalRule' },
   ruleLabel: { type: String, default: '' },
   ruleVersion: { type: Number, default: 1 },
   status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired'], default: 'pending', index: true },
   decidedBy: { type: String, default: '' },
   decidedAt: { type: Date, default: null },
   note: { type: String, default: '' },
}, { timestamps: true });

export const ApprovalRule = model('ApprovalRule', ruleSchema);
export const ApprovalRequest = model('ApprovalRequest', requestSchema);
