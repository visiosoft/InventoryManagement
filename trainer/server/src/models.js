import mongoose from 'mongoose';

/**
 * Everything the trainer stores, in its own database. A user signs up, owns
 * or joins organisations (one per customer business), and every training
 * record carries `org` — reads and writes go through repo.js, which adds it.
 */

const { Schema, model } = mongoose;
const org = { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true };
const by = { userId: String, name: String };

export const ROLES = ['owner', 'admin', 'trainer', 'reviewer', 'approver', 'analyst'];

const userSchema = new Schema({
   email: { type: String, required: true, unique: true, lowercase: true, trim: true },
   name: { type: String, default: '' },
   passwordHash: { type: String, required: true },
   // Runs the platform: sees every organisation and sets the platform AI keys.
   platformAdmin: { type: Boolean, default: false },
   lastLoginAt: Date,
}, { timestamps: true });

const orgSchema = new Schema({
   name: { type: String, required: true },
   slug: { type: String, required: true, unique: true },
   business: { type: String, default: '' },
   categories: { type: [String], default: ['Pricing', 'Products and services', 'Availability', 'Booking and payment', 'Delivery', 'Account and billing', 'Complaints', 'Location and hours', 'Other'] },
   prohibited: { type: [String], default: [] },
   maxReplyLength: { type: Number, default: 700 },
   retentionDays: { type: Number, default: 365 },
   activeSnapshot: { type: Number, default: 0 },
   plan: { type: String, default: 'pilot' },
   // The business's own facts and fixed {variables}, for organisations with no connected system.
   facts: { type: String, default: '' },
   variables: { type: [{ _id: false, name: String, value: String }], default: [] },
   // Bring your own AI key; empty uses the platform key.
   ai: { provider: { type: String, enum: ['', 'anthropic', 'openai'], default: '' }, model: { type: String, default: '' }, keyEnc: { type: String, default: '' }, keyHint: { type: String, default: '' } },
   // A system that implements the Connector protocol (conversations, live facts, agent replies).
   connector: { url: { type: String, default: '' }, tokenEnc: { type: String, default: '' }, enabled: { type: Boolean, default: false }, lastCheckAt: Date, lastCheck: String },
   // WhatsApp Business: messages arrive by webhook from the moment it is connected.
   whatsapp: { verifyToken: { type: String, default: '' }, appSecretEnc: { type: String, default: '' }, phoneNumberId: { type: String, default: '' }, connectedAt: Date },
   apiKeys: { type: [{ _id: false, id: String, label: String, hash: String, last4: String, createdAt: Date, revokedAt: Date }], default: [] },
}, { timestamps: true });

const memberSchema = new Schema({
   org, user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
   role: { type: String, enum: ROLES, required: true },
}, { timestamps: true });
memberSchema.index({ org: 1, user: 1 }, { unique: true });

const inviteSchema = new Schema({
   org, email: { type: String, lowercase: true, trim: true, required: true }, role: { type: String, enum: ROLES, required: true },
   tokenHash: { type: String, required: true, index: true }, invitedBy: by, expiresAt: Date, acceptedAt: Date,
}, { timestamps: true });

// Raw messages that arrived by API or WhatsApp webhook, waiting to be imported.
const messageSchema = new Schema({
   org, source: { type: String, index: true }, conversation: { type: String, index: true },
   from: { type: String, enum: ['customer', 'agent'] }, byAi: Boolean, text: String, at: { type: Date, index: true }, externalId: String,
}, { timestamps: true });
messageSchema.index({ org: 1, source: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

const usageSchema = new Schema({
   org, day: { type: String, index: true }, feature: String, provider: String, model: String,
   calls: { type: Number, default: 0 }, inputTokens: { type: Number, default: 0 }, outputTokens: { type: Number, default: 0 }, platformKey: Boolean,
});
usageSchema.index({ org: 1, day: 1, feature: 1, provider: 1, model: 1, platformKey: 1 }, { unique: true });

const platformSchema = new Schema({
   key: { type: String, default: 'platform', unique: true },
   anthropicKeyEnc: { type: String, default: '' }, openaiKeyEnc: { type: String, default: '' },
   provider: { type: String, default: 'anthropic' }, model: { type: String, default: '' },
   allowSignup: { type: Boolean, default: true },
});

/* ---------- training records (same shapes as the shared core expects) ---------- */

const importSchema = new Schema({
   org, source: { type: String, required: true }, label: String, params: Schema.Types.Mixed,
   status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
   stage: { type: String, default: 'reading' },
   progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
   counts: { messages: Number, turns: Number, questions: Number, skipped: Number, intents: Number, newIntents: Number, holdout: Number },
   problems: { type: [String], default: [] }, startedBy: by, finishedAt: Date,
}, { timestamps: true });

const questionSchema = new Schema({
   org, import: { type: Schema.Types.ObjectId, index: true }, source: String, ref: String, at: Date,
   text: String, lang: String, repeats: { type: Number, default: 1 },
   context: { type: [{ _id: false, from: String, text: String }], default: [] }, humanReply: { type: String, default: '' },
   cluster: { type: Schema.Types.ObjectId, index: true, default: null }, skipped: { type: Boolean, default: false },
   split: { type: String, enum: ['train', 'eval'], default: 'train', index: true },
}, { timestamps: true });

const clusterSchema = new Schema({
   org, key: { type: String, required: true }, name: String, category: String, question: String,
   count: { type: Number, default: 0 }, languages: { type: [String], default: [] },
   status: { type: String, enum: ['new', 'suggested', 'approved', 'rejected', 'escalated'], default: 'new', index: true },
   suggestion: { text: { type: String, default: '' }, sources: { type: [String], default: [] }, needsData: { type: String, default: '' }, escalate: { type: Boolean, default: false }, by: String, at: Date, error: String },
   record: { type: Schema.Types.ObjectId, default: null },
   comments: { type: [{ _id: false, by, text: String, at: Date }], default: [] },
   history: { type: [{ _id: false, action: String, by, at: Date, note: String }], default: [] },
}, { timestamps: true });
clusterSchema.index({ org: 1, key: 1 }, { unique: true });

const knowledgeSchema = new Schema({
   org, cluster: { type: Schema.Types.ObjectId, default: null }, intent: String, category: String, question: String,
   variations: { type: [String], default: [] }, answer: String, followUp: { type: String, default: '' },
   language: { type: String, default: 'en' }, channels: { type: [String], default: ['chat'] },
   escalate: { type: Boolean, default: false }, escalationNote: { type: String, default: '' }, allowMultiple: { type: Boolean, default: false },
   status: { type: String, enum: ['draft', 'approved', 'published', 'superseded', 'archived'], default: 'draft', index: true },
   version: { type: Number, default: 1 },
   versions: { type: [{ _id: false, version: Number, answer: String, followUp: String, status: String, by, at: Date, note: String, original: String }], default: [] },
   approvedBy: by, approvedAt: Date, effectiveFrom: Date, expiresAt: Date,
}, { timestamps: true });

const snapshotSchema = new Schema({
   org, version: { type: Number, required: true }, items: { type: [Schema.Types.Mixed], default: [] }, count: Number,
   note: String, publishedBy: by, conflicts: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true });
snapshotSchema.index({ org: 1, version: 1 }, { unique: true });

const evalSchema = new Schema({
   org, agent: String, label: String, snapshotVersion: Number,
   status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
   progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
   cases: { type: [Schema.Types.Mixed], default: [] }, summary: Schema.Types.Mixed, error: String, startedBy: by, finishedAt: Date,
}, { timestamps: true });

const feedbackSchema = new Schema({
   org, source: String, question: String, aiReply: String, humanReply: String, note: String,
   status: { type: String, enum: ['open', 'used', 'dismissed'], default: 'open' },
}, { timestamps: true });

const auditSchema = new Schema({ org, by, action: String, target: String, detail: Schema.Types.Mixed, at: { type: Date, default: Date.now } });

export const User = model('User', userSchema);
export const Org = model('Org', orgSchema);
export const Member = model('Member', memberSchema);
export const Invite = model('Invite', inviteSchema);
export const Message = model('Message', messageSchema);
export const Usage = model('Usage', usageSchema);
export const Platform = model('Platform', platformSchema);
// The names repo.js and service.js use.
export const TrainingImport = model('Import', importSchema);
export const TrainingQuestion = model('Question', questionSchema);
export const TrainingCluster = model('Cluster', clusterSchema);
export const TrainingKnowledge = model('Knowledge', knowledgeSchema);
export const TrainingSnapshot = model('Snapshot', snapshotSchema);
export const TrainingEval = model('Eval', evalSchema);
export const TrainingFeedback = model('Feedback', feedbackSchema);
export const TrainingAudit = model('Audit', auditSchema);
export const TrainingMember = Member;
export const TrainingOrg = Org;
