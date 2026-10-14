import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const NOTIFICATION_KINDS = ['payment', 'renewal', 'promotion', 'inspection', 'service'];

/* One message to a customer in the app: the push, and the inbox row that
 * stays behind after the push is swiped away. Written whether or not a phone
 * could be reached — a customer who turned notifications off still finds it
 * in their inbox.
 *
 * `data.route` is an expo-router path in the customer app, so tapping the
 * push or the row opens the screen it is about.
 *
 * `key` makes a notification happen once. The daily sweep runs every day and
 * a webhook can be delivered twice; a key like `due:<invoice>:today` turns the
 * second attempt into a duplicate-key error rather than a second push. */
const customerNotificationSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  data: { type: Schema.Types.Mixed, default: () => ({}) },
  key: { type: String },
  readAt: { type: Date, default: null },
}, { timestamps: true });
customerNotificationSchema.index({ customer: 1, createdAt: -1 });
// `$type: 'string'` rather than `$exists`: a key saved as null must not
// collide with every other keyless row.
customerNotificationSchema.index({ customer: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
customerNotificationSchema.index({ kind: 1, createdAt: -1 });

export const CustomerNotification = model('CustomerNotification', customerNotificationSchema);
