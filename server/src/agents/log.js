/**
 * The action log, and undoing what it records.
 *
 * Every decision the agent or a person makes about a lead goes through
 * record(): one row, a one-line summary, the full detail, and a snapshot
 * of the lead file before and after. Revert puts the snapshot back and
 * cancels anything scheduled after it, then logs itself — nothing can be
 * made to quietly disappear.
 *
 * The detail payload is the only thing with a retention window. The
 * summary is small and is the history a manager reads; the prompts and
 * tool results underneath are only needed while a complaint or an eval
 * regression is still possible.
 */

import { AgentAction, AgentLeadFile } from './models.js';

export const DETAIL_RETENTION_DAYS = 90;

/** The fields revert restores. Everything else on the file is derived or a timestamp. */
const SNAPSHOT_FIELDS = ['bucket', 'previousBucket', 'touchCount', 'anchorAt', 'nextTouchAt', 'nextTouchIntent', 'need', 'offers', 'openQuestions', 'lastSummary', 'frozenAt'];

export function snapshotOf(leadFile) {
    if (!leadFile) return null;
    const src = typeof leadFile.toObject === 'function' ? leadFile.toObject() : leadFile;
    const out = {};
    for (const f of SNAPSHOT_FIELDS) out[f] = src[f] === undefined ? null : JSON.parse(JSON.stringify(src[f]));
    return out;
}

export async function record({
    agent, lead, leadFile, kind, summary, detail = null,
    bucketBefore = null, bucketAfter = null,
    snapshotBefore = null, snapshotAfter = null,
    revertible = false, actor = 'agent', user = null, revertOf = null, at = new Date(),
}) {
    const row = await AgentAction.create({
        agent: agent?._id || agent || null,
        lead: lead?._id || lead || null,
        leadFile: leadFile?._id || leadFile || null,
        kind, summary, detail,
        detailExpiresAt: detail ? new Date(at.getTime() + DETAIL_RETENTION_DAYS * 86_400_000) : null,
        bucketBefore, bucketAfter, snapshotBefore, snapshotAfter,
        revertible, actor, user: user?.id || user || null, revertOf, at,
    });
    if (leadFile?._id) {
        await AgentLeadFile.updateOne({ _id: leadFile._id }, { $set: { lastActionAt: at } });
    }
    return row;
}

/**
 * Put the lead file back the way it was before this action, and cancel
 * anything scheduled after it. Fails plainly rather than half-applying.
 */
export async function revert(actionId, user) {
    const action = await AgentAction.findById(actionId);
    if (!action) throw new Error('That action does not exist');
    if (!action.revertible) throw new Error('That action cannot be reverted — a sent message can only be stopped, not unsent');
    if (action.revertedAt) throw new Error('That action was already reverted');
    if (!action.snapshotBefore) throw new Error('That action has nothing to restore');

    const file = await AgentLeadFile.findById(action.leadFile);
    if (!file) throw new Error('The lead file is gone');

    const before = snapshotOf(file);
    for (const f of SNAPSHOT_FIELDS) {
        if (f in action.snapshotBefore) file[f] = action.snapshotBefore[f];
    }
    // A revert is a person saying "not that" — nothing the agent had lined
    // up after the mistake should still fire.
    file.nextTouchAt = action.snapshotBefore.nextTouchAt ?? null;
    await file.save();

    action.revertedAt = new Date();
    action.revertedBy = user?.id || null;
    await action.save();

    return record({
        agent: action.agent, lead: action.lead, leadFile: file,
        kind: 'reverted',
        summary: `Reverted: ${action.summary}`,
        bucketBefore: before.bucket, bucketAfter: file.bucket,
        snapshotBefore: before, snapshotAfter: snapshotOf(file),
        revertible: false, actor: 'person', user, revertOf: action._id,
    });
}

/** Drop detail payloads past their window. The summary rows stay. */
export async function purgeExpiredDetail(now = new Date()) {
    const r = await AgentAction.updateMany(
        { detailExpiresAt: { $lte: now }, detail: { $ne: null } },
        { $set: { detail: null } },
    );
    return r.modifiedCount || 0;
}
