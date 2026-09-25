/**
 * The agents module's own records. Kept apart from models/index.js on
 * purpose: this is a separate thing that lives inside the project, and
 * nothing outside the module reads these collections directly.
 *
 *   AgentProfile  — one row per agent: the "employee record". Onboarding an
 *                   agent is creating one of these.
 *   AgentLeadFile — the agent's file on a lead: what they need, which bucket
 *                   they are in, what has been offered, what is due next.
 *                   Read first on every turn; the transcript is evidence.
 *   AgentAction   — one row per decision, with a summary a colleague would
 *                   say out loud, the full detail underneath, and the
 *                   before/after snapshot that makes revert possible.
 */

import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.js';
import { BUCKET_ORDER } from './buckets.js';

const { Schema, model } = mongoose;

/* Live sending is Phase 1. The prototype only knows 'shadow' (drafts and
   proposed touches, nothing sent) and 'off' — so a misconfigured profile
   cannot message a customer. */
export const AGENT_MODES = ['off', 'shadow'];

export const AGENT_TOOLS = [
    'units_available',
    'price_booking',
    'update_lead_file',
    'note_offer',
    'move_bucket',
    'propose_follow_up_template',
    'escalate',
];

const agentProfileSchema = new Schema({
    name: { type: String, required: true, trim: true },
    // The job in two words — "First response", "Follow-ups", "Closing".
    role: { type: String, default: '', trim: true },
    // Which buckets this agent owns. A bucket has at most one owner; a lead
    // entering a bucket someone else owns is handed to them (see service.js).
    ownsBuckets: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    // The router's fallback when no rule matches. Exactly one agent should
    // have it; the first created gets it by default.
    isDefault: { type: Boolean, default: false },
    dailyBudgetAed: { type: Number, default: 0 },
    avatarColor: { type: String, default: '' },
    // The job description. Versioned: bumped on every save that changes it,
    // so an action can always say which instructions produced it.
    systemPrompt: { type: String, default: '' },
    promptVersion: { type: Number, default: 1 },
    // '' means "whatever the server is set to" (openaiModel()).
    model: { type: String, default: '' },
    mode: { type: String, enum: AGENT_MODES, default: 'shadow' },
    enabledTools: { type: [String], default: () => [...AGENT_TOOLS] },
    // Which business numbers this agent answers on. Empty = any.
    whatsappNumbers: { type: [String], default: [] },
    // Day offsets per bucket; empty array = use the default cadence.
    cadence: {
        quoted: { type: [Number], default: [] },
        booking: { type: [Number], default: [] },
        quiet: { type: [Number], default: [] },
        dormant: { type: [Number], default: [] },
    },
    escalateTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    maxToolRounds: { type: Number, default: 4 },
    // Whether a bucket move also updates the human-facing Lead.status. Off
    // by default: while the agent is only shadowing, the sales team's
    // statuses stay theirs. Turn on when the agent's buckets are trusted.
    syncLeadStatus: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
agentProfileSchema.plugin(softDeletePlugin);

const offerSchema = new Schema({
    unitNumber: { type: String, default: '' },
    monthlyPrice: { type: Number, default: null },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    at: { type: Date, default: Date.now },
}, { _id: false });

const agentLeadFileSchema = new Schema({
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    agent: { type: Schema.Types.ObjectId, ref: 'AgentProfile', required: true },
    phoneNormalized: { type: String, required: true, index: true },
    need: {
        sizeSqf: { type: Number, default: null },
        moveIn: { type: String, default: '' },
        durationWeeks: { type: Number, default: null },
        budget: { type: Number, default: null },
        storing: { type: String, default: '' },
    },
    bucket: { type: String, enum: BUCKET_ORDER, default: 'new', index: true },
    previousBucket: { type: String, default: null },
    touchCount: { type: Number, default: 0 },
    anchorAt: { type: Date, default: Date.now },
    nextTouchAt: { type: Date, default: null, index: true },
    nextTouchIntent: { type: String, default: '' },
    offers: { type: [offerSchema], default: [] },
    openQuestions: { type: [String], default: [] },
    // The agent's last one-line read of where things stand.
    lastSummary: { type: String, default: '' },
    lastActionAt: { type: Date, default: null },
    lastInboundAt: { type: Date, default: null },
    // A person pressed stop: no touches until they resume.
    frozenAt: { type: Date, default: null },
}, { timestamps: true });
agentLeadFileSchema.plugin(softDeletePlugin);

export const ACTION_KINDS = [
    'adopted',          // lead file created
    'reply_drafted',    // shadow: what the agent would have replied
    'touch_proposed',   // shadow: the template it would have sent
    'bucket_moved',
    'lead_file_updated',
    'offer_noted',
    'escalated',
    'handed_back',
    'handoff',          // ownership moved to another agent at a bucket boundary
    'frozen',
    'resumed',
    'reverted',
    'skipped',
    'approved',         // a person sent a draft as written
    'edited',           // a person changed a draft, then sent it
    'dismissed',        // a person threw a draft or proposal away
];

/** How a person answered a draft or a proposed touch. */
export const RESOLUTIONS = ['approved', 'edited', 'dismissed', 'skipped'];

const agentActionSchema = new Schema({
    agent: { type: Schema.Types.ObjectId, ref: 'AgentProfile', index: true },
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    leadFile: { type: Schema.Types.ObjectId, ref: 'AgentLeadFile', index: true },
    kind: { type: String, enum: ACTION_KINDS, required: true },
    bucketBefore: { type: String, default: null },
    bucketAfter: { type: String, default: null },
    // What a colleague would say happened, in one sentence.
    summary: { type: String, required: true },
    // Everything needed to reconstruct it. Purged after the retention
    // window; the summary row stays.
    detail: { type: Schema.Types.Mixed, default: null },
    detailExpiresAt: { type: Date, default: null },
    snapshotBefore: { type: Schema.Types.Mixed, default: null },
    snapshotAfter: { type: Schema.Types.Mixed, default: null },
    revertible: { type: Boolean, default: false },
    revertedAt: { type: Date, default: null },
    revertedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revertOf: { type: Schema.Types.ObjectId, ref: 'AgentAction', default: null },
    actor: { type: String, enum: ['agent', 'person', 'system'], default: 'agent' },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now, index: true },
    // For drafts and proposed touches: what a person did with it. Null
    // means it is still waiting in the inbox.
    resolution: { type: String, enum: [...RESOLUTIONS, null], default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // The text that actually went out, when a person edited the draft.
    sentText: { type: String, default: '' },
});
agentActionSchema.index({ kind: 1, resolution: 1, at: -1 });

/* A rehearsal: past conversations replayed through an agent, turn by turn,
   with what a person actually replied at the time beside each draft.
   Nothing is sent and no lead file is touched. */
const rehearsalTurnSchema = new Schema({
    lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    leadName: { type: String, default: '' },
    at: { type: Date },
    customerText: { type: String, default: '' },
    agentReply: { type: String, default: '' },
    needsHuman: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    groundedOk: { type: Boolean, default: true },
    loose: { type: [String], default: [] },
    tools: { type: [String], default: [] },
    humanReply: { type: String, default: '' },
    error: { type: String, default: '' },
}, { _id: false });

const agentRehearsalSchema = new Schema({
    agent: { type: Schema.Types.ObjectId, ref: 'AgentProfile', index: true },
    promptVersion: { type: Number, default: 1 },
    model: { type: String, default: '' },
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
    params: { conversations: Number, turns: Number },
    progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    turns: { type: [rehearsalTurnSchema], default: [] },
    summary: {
        turns: { type: Number, default: 0 },
        grounded: { type: Number, default: 0 },
        handedOver: { type: Number, default: 0 },
        withHumanReply: { type: Number, default: 0 },
        conversations: { type: Number, default: 0 },
    },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
});

/* A manager's review of an agent, written by the model from the agent's
   own record: the numbers, the drafts people changed or threw away, the
   hand-overs, and the latest rehearsal. */
const agentReviewSchema = new Schema({
    agent: { type: Schema.Types.ObjectId, ref: 'AgentProfile', index: true },
    promptVersion: { type: Number, default: 1 },
    model: { type: String, default: '' },
    periodDays: { type: Number, default: 30 },
    stats: { type: Schema.Types.Mixed, default: null },
    rehearsal: { type: Schema.Types.ObjectId, ref: 'AgentRehearsal', default: null },
    review: {
        summary: { type: String, default: '' },
        grade: { type: String, default: '' },
        strengths: { type: [String], default: [] },
        weaknesses: { type: [String], default: [] },
        suggestions: { type: [{ section: String, change: String, why: String, text: String, _id: false }], default: [] },
    },
    at: { type: Date, default: Date.now },
});

export const AgentProfile = model('AgentProfile', agentProfileSchema);
export const AgentRehearsal = model('AgentRehearsal', agentRehearsalSchema);
export const AgentReview = model('AgentReview', agentReviewSchema);
export const AgentLeadFile = model('AgentLeadFile', agentLeadFileSchema);
export const AgentAction = model('AgentAction', agentActionSchema);
