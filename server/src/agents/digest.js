/**
 * What a manager should know about the AI agents' last 24 hours, folded
 * into the shared morning brief (services/dayBrief.js) rather than sent as
 * a separate message — the whole point of that brief is to be the one
 * place a manager looks, not one more thing to check.
 *
 * Read-only. Nothing is sent from here.
 */

import { AgentAction, AgentLeadFile } from './models.js';
import { inbox } from './service.js';

export async function agentsBriefSection({ now = new Date() } = {}) {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const recent = await AgentAction.find({ at: { $gte: since } }).select('kind resolution').lean();
    const sentLast24h = recent.filter((a) => a.resolution === 'approved' || a.resolution === 'edited').length;
    const escalatedLast24h = recent.filter((a) => a.kind === 'escalated').length;

    const queue = await inbox();
    const pending = queue.drafts.length + queue.touches.length + queue.emails.length;
    const escalatedNow = queue.handed.length;

    const counts = {};
    for (const f of await AgentLeadFile.aggregate([{ $group: { _id: '$bucket', n: { $sum: 1 } } }])) counts[f._id] = f.n;

    return { sentLast24h, escalatedLast24h, pending, escalatedNow, counts };
}
