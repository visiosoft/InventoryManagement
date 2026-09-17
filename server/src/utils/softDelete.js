import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Adds soft-delete fields to a schema and auto-excludes soft-deleted
 * documents from find/count queries. A query that needs to see deleted
 * documents too passes `{ includeDeleted: true }` as a query option, e.g.
 * `Model.findOne({...}, null, { includeDeleted: true })`.
 *
 * `deletedAtField`/`deletedByField` let a schema that already has its own
 * unrelated `deletedAt` (WhatsAppMessage, which records WhatsApp reporting a
 * message deleted by the sender) use different field names so nothing
 * collides.
 */
export function softDeletePlugin(schema, opts = {}) {
  const deletedAtField = opts.deletedAtField || 'deletedAt';
  const deletedByField = opts.deletedByField || 'deletedBy';

  schema.add({
    [deletedAtField]: { type: Date, default: null },
    [deletedByField]: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  });

  function autoExclude() {
    if (this.getOptions().includeDeleted) return;
    this.where({ [deletedAtField]: null });
  }

  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'distinct'], autoExclude);
}

/** Marks an already-fetched document deleted in place and saves it. */
export async function softDelete(doc, userId, opts = {}) {
  const deletedAtField = opts.deletedAtField || 'deletedAt';
  const deletedByField = opts.deletedByField || 'deletedBy';
  doc[deletedAtField] = new Date();
  doc[deletedByField] = userId ?? null;
  await doc.save();
  return doc;
}

/** The bulk-delete equivalent — soft-deletes every document matching `filter`. */
export async function softDeleteMany(Model, filter, userId, opts = {}) {
  const deletedAtField = opts.deletedAtField || 'deletedAt';
  const deletedByField = opts.deletedByField || 'deletedBy';
  return Model.updateMany(
    { ...filter, [deletedAtField]: null },
    { $set: { [deletedAtField]: new Date(), [deletedByField]: userId ?? null } }
  );
}
