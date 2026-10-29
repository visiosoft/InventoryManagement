/**
 * Tenant isolation, in one place. Every read and write the training module
 * makes goes through `scoped(org)`, which adds `{ org }` to the filter and to
 * every document it creates. A route handler never builds a query against a
 * training collection itself, so forgetting the tenant is not possible.
 *
 * Takes the models as an argument so the isolation can be tested without a
 * database.
 */

const ID = /^[0-9a-f]{24}$/i;

export function scoped(models, orgId) {
   if (!orgId) throw new Error('No organisation for this request');
   const org = String(orgId);
   const where = (filter = {}) => {
      // A caller's own `org` is overwritten, never trusted.
      const { org: _ignored, ...rest } = filter || {};
      return { ...rest, org };
   };
   const make = (Model) => ({
      find: (filter, opts = {}) => {
         let q = Model.find(where(filter));
         if (opts.select) q = q.select(opts.select);
         if (opts.sort) q = q.sort(opts.sort);
         if (opts.skip) q = q.skip(opts.skip);
         if (opts.limit) q = q.limit(opts.limit);
         return q.lean();
      },
      findOne: (filter, opts = {}) => { let q = Model.findOne(where(filter)); if (opts.sort) q = q.sort(opts.sort); return opts.doc ? q : q.lean(); },
      byId: (id, opts = {}) => (ID.test(String(id)) ? (opts.doc ? Model.findOne(where({ _id: id })) : Model.findOne(where({ _id: id })).lean()) : Promise.resolve(null)),
      count: (filter) => Model.countDocuments(where(filter)),
      create: (doc) => Model.create({ ...doc, org }),
      insertMany: (docs) => Model.insertMany(docs.map((d) => ({ ...d, org }))),
      updateOne: (filter, update, opts) => Model.updateOne(where(filter), update, opts),
      updateMany: (filter, update) => Model.updateMany(where(filter), update),
      deleteMany: (filter) => Model.deleteMany(where(filter)),
      aggregate: (pipeline) => Model.aggregate([{ $match: { org: Model.base?.Types?.ObjectId ? new Model.base.Types.ObjectId(org) : org } }, ...pipeline]),
   });
   return {
      org,
      imports: make(models.TrainingImport),
      questions: make(models.TrainingQuestion),
      clusters: make(models.TrainingCluster),
      knowledge: make(models.TrainingKnowledge),
      snapshots: make(models.TrainingSnapshot),
      evals: make(models.TrainingEval),
      feedback: make(models.TrainingFeedback),
      members: make(models.TrainingMember),
      audit: make(models.TrainingAudit),
   };
}
