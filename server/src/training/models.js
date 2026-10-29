import mongoose from 'mongoose';

/**
 * AI Training & Quality Control: the stored records. Every collection carries
 * `org`, and every query goes through repo.js, which adds it — a tenant can
 * never read another's conversations, intents, knowledge or keys.
 *
 * Collections are prefixed training_ so the module can be lifted out into its
 * own database or service without touching the CRM's.
 */

const { Schema, model } = mongoose;
const org = { type: Schema.Types.ObjectId, ref: 'TrainingOrg', required: true, index: true };
const by = { userId: String, name: String };

const orgSchema = new Schema({
   name: { type: String, required: true },
   slug: { type: String, required: true, unique: true },
   // What a suggested answer is written for: "self-storage company in Dubai".
   business: { type: String, default: '' },
   categories: { type: [String], default: [] },
   // Phrases an answer must never contain, and the longest reply allowed.
   prohibited: { type: [String], default: [] },
   maxReplyLength: { type: Number, default: 700 },
   // Retention: imported questions older than this are deleted (0 = keep).
   retentionDays: { type: Number, default: 365 },
   activeSnapshot: { type: Number, default: 0 },
   apiKeys: { type: [{ _id: false, id: String, label: String, hash: String, last4: String, createdAt: Date, revokedAt: Date }], default: [] },
}, { timestamps: true, collection: 'training_orgs' });

const memberSchema = new Schema({
   org, userId: { type: String, required: true }, name: String, email: String,
   role: { type: String, enum: ['owner', 'admin', 'trainer', 'reviewer', 'approver', 'analyst'], required: true },
}, { timestamps: true, collection: 'training_members' });
memberSchema.index({ org: 1, userId: 1 }, { unique: true });

const importSchema = new Schema({
   org, source: { type: String, required: true }, label: String,
   params: Schema.Types.Mixed,
   status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
   stage: { type: String, default: 'reading' },
   progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
   counts: { messages: Number, turns: Number, questions: Number, skipped: Number, intents: Number, newIntents: Number, holdout: Number },
   problems: { type: [String], default: [] },
   startedBy: by, finishedAt: Date,
}, { timestamps: true, collection: 'training_imports' });

const questionSchema = new Schema({
   org, import: { type: Schema.Types.ObjectId, ref: 'TrainingImport', index: true },
   source: String, ref: String, at: Date,
   text: String, lang: String, repeats: { type: Number, default: 1 },
   context: { type: [{ _id: false, from: String, text: String }], default: [] },
   humanReply: { type: String, default: '' },
   cluster: { type: Schema.Types.ObjectId, ref: 'TrainingCluster', index: true, default: null },
   skipped: { type: Boolean, default: false },
   // Held out for evaluation: never an example for clustering or suggestions.
   split: { type: String, enum: ['train', 'eval'], default: 'train', index: true },
}, { timestamps: true, collection: 'training_questions' });

const clusterSchema = new Schema({
   org, key: { type: String, required: true },
   name: String, category: String, question: String,
   count: { type: Number, default: 0 },
   languages: { type: [String], default: [] },
   status: { type: String, enum: ['new', 'suggested', 'approved', 'rejected', 'escalated'], default: 'new', index: true },
   suggestion: {
      text: { type: String, default: '' }, sources: { type: [String], default: [] },
      needsData: { type: String, default: '' }, escalate: { type: Boolean, default: false },
      by: String, at: Date, error: String,
   },
   record: { type: Schema.Types.ObjectId, ref: 'TrainingKnowledge', default: null },
   comments: { type: [{ _id: false, by, text: String, at: Date }], default: [] },
   history: { type: [{ _id: false, action: String, by, at: Date, note: String }], default: [] },
}, { timestamps: true, collection: 'training_clusters' });
clusterSchema.index({ org: 1, key: 1 }, { unique: true });

const versionSchema = new Schema({
   _id: false, version: Number, answer: String, followUp: String, status: String,
   by, at: Date, note: String, original: String,
}, { _id: false });

const knowledgeSchema = new Schema({
   org, cluster: { type: Schema.Types.ObjectId, ref: 'TrainingCluster', default: null },
   intent: String, category: String, question: String,
   variations: { type: [String], default: [] },
   answer: String, followUp: { type: String, default: '' },
   language: { type: String, default: 'en' }, channels: { type: [String], default: ['whatsapp'] },
   escalate: { type: Boolean, default: false }, escalationNote: { type: String, default: '' },
   allowMultiple: { type: Boolean, default: false },
   status: { type: String, enum: ['draft', 'approved', 'published', 'superseded', 'archived'], default: 'draft', index: true },
   version: { type: Number, default: 1 },
   versions: { type: [versionSchema], default: [] },
   approvedBy: by, approvedAt: Date, effectiveFrom: Date, expiresAt: Date,
}, { timestamps: true, collection: 'training_knowledge' });

const snapshotSchema = new Schema({
   org, version: { type: Number, required: true },
   items: { type: [Schema.Types.Mixed], default: [] }, count: Number,
   note: String, publishedBy: by,
   conflicts: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true, collection: 'training_snapshots' });
snapshotSchema.index({ org: 1, version: 1 }, { unique: true });

const evalSchema = new Schema({
   org, agent: String, label: String, snapshotVersion: Number,
   status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
   progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
   cases: { type: [Schema.Types.Mixed], default: [] },
   summary: Schema.Types.Mixed, error: String, startedBy: by, finishedAt: Date,
}, { timestamps: true, collection: 'training_evals' });

const feedbackSchema = new Schema({
   org, source: String, question: String, aiReply: String, humanReply: String,
   note: String, status: { type: String, enum: ['open', 'used', 'dismissed'], default: 'open' },
}, { timestamps: true, collection: 'training_feedback' });

const auditSchema = new Schema({
   org, by, action: String, target: String, detail: Schema.Types.Mixed, at: { type: Date, default: Date.now },
}, { collection: 'training_audit' });

export const TrainingOrg = model('TrainingOrg', orgSchema);
export const TrainingMember = model('TrainingMember', memberSchema);
export const TrainingImport = model('TrainingImport', importSchema);
export const TrainingQuestion = model('TrainingQuestion', questionSchema);
export const TrainingCluster = model('TrainingCluster', clusterSchema);
export const TrainingKnowledge = model('TrainingKnowledge', knowledgeSchema);
export const TrainingSnapshot = model('TrainingSnapshot', snapshotSchema);
export const TrainingEval = model('TrainingEval', evalSchema);
export const TrainingFeedback = model('TrainingFeedback', feedbackSchema);
export const TrainingAudit = model('TrainingAudit', auditSchema);
