import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Collections (WP-21). States from the spec, section 8.2. */
export const COLLECTION_STATES = ['current', 'due', 'reminder_1', 'reminder_2', 'promise_to_pay', 'payment_plan', 'escalated', 'written_off'];
/** States a person sets; the rest are worked out from the payments. */
export const MANUAL_STATES = ['promise_to_pay', 'payment_plan', 'escalated', 'written_off'];

const accountSchema = new Schema({
   contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, unique: true },
   state: { type: String, enum: ['', ...MANUAL_STATES], default: '' },
   disputed: { type: Boolean, default: false },
   disputeNote: { type: String, default: '' },
   // Every contact and change, in order.
   history: [{
      at: { type: Date, default: Date.now }, by: { type: String, default: '' }, from: String, to: String,
      channel: { type: String, default: '' }, note: { type: String, default: '' }, _id: false,
   }],
}, { timestamps: true });

const promiseSchema = new Schema({
   contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
   amount: { type: Number, required: true },
   promisedDate: { type: Date, required: true },
   channel: { type: String, enum: ['call', 'whatsapp', 'email', 'in_person'], default: 'call' },
   note: { type: String, default: '' },
   status: { type: String, enum: ['open', 'kept', 'broken'], default: 'open', index: true },
   createdBy: { type: String, default: '' },
   resolvedAt: { type: Date, default: null },
}, { timestamps: true });

export const CollectionAccount = model('CollectionAccount', accountSchema);
export const PromiseToPay = model('PromiseToPay', promiseSchema);
