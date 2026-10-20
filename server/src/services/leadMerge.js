/**
 * Duplicate leads — the same person twice — found and merged.
 *
 * They came from numbers typed the local way (054…) while the WhatsApp chat
 * is 97154…: two records, one linked to the chat and one not, often with
 * different owners and stages. A merge keeps one, brings across what only
 * the other had, re-points everything that referred to the other (quotes,
 * contracts, tasks, follow-ups, messages, agent history) and soft-deletes it.
 * Nothing is merged without an admin choosing to.
 */

import { Lead, Quote, Contract, Task, LeadFollowUp, WhatsAppMessage, User } from '../models/index.js';
import { AgentLeadFile, AgentAction } from '../agents/models.js';
import { normalizePhone, phoneTail9 } from './phone.js';

// How far along a stage is; the merged lead takes the further one.
const STAGE_RANK = {
    new: 0, contact_attempted: 1, contacted: 2, follow_up_scheduled: 3, site_visit_scheduled: 4,
    quotation_sent: 5, won: 7, already_customer: 6, lost: -1,
};
const PLACEHOLDER = /^(lead \d+|whatsapp contact|website lead|unknown|test)/i;

/** The later of two dates, or whichever is set. */
const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);

/** Which stage the merged lead should be at. */
export function mergedStatus(a, b) {
    if (a === 'won' || b === 'won') return 'won';
    if (a === 'lost' && b !== 'lost') return b;
    if (b === 'lost' && a !== 'lost') return a;
    return (STAGE_RANK[a] ?? 0) >= (STAGE_RANK[b] ?? 0) ? a : b;
}

/**
 * What the kept lead becomes. Pure: takes two plain lead objects, returns the
 * fields to set on `keep`. `ownerId` overrides who owns it; otherwise the
 * owner of whichever of the two was worked more recently.
 */
export function planMerge(keep, drop, { ownerId } = {}) {
    const set = {};
    const fill = (k, empty = (v) => v === undefined || v === null || v === '' || v === 0) => {
        if (empty(keep[k]) && !empty(drop[k])) set[k] = drop[k];
    };
    for (const k of ['email', 'whatsappNo', 'storageSizeValue', 'storageStartAt', 'intendedStartDate', 'whenNeeded', 'storingWhat', 'spaceNeeded', 'siteVisitAt', 'temperature', 'locationPreference', 'financiallyQualified']) fill(k);

    // A real name beats "Lead 161" / "WhatsApp Contact 1234".
    if ((!keep.fullName || PLACEHOLDER.test(keep.fullName)) && drop.fullName && !PLACEHOLDER.test(drop.fullName)) {
        set.fullName = drop.fullName; set.firstName = drop.firstName || ''; set.lastName = drop.lastName || '';
    }
    const status = mergedStatus(keep.status, drop.status);
    if (status !== keep.status) {
        set.status = status;
        if (status === 'lost' && drop.lostReason) set.lostReason = drop.lostReason;
    }
    const fu = later(keep.followUpAt, drop.followUpAt);
    if (fu && String(fu) !== String(keep.followUpAt)) { set.followUpAt = fu; set.followUpKind = drop.followUpKind || keep.followUpKind || 'date'; }
    if (drop.notes && !String(keep.notes || '').includes(drop.notes)) set.notes = [keep.notes, drop.notes].filter(Boolean).join('\n\n');
    for (const k of ['firstResponseAt']) if (drop[k] && (!keep[k] || new Date(drop[k]) < new Date(keep[k]))) set[k] = drop[k];

    const worked = (l) => new Date(l.updatedAt || l.createdAt || 0).getTime();
    const owner = ownerId !== undefined ? ownerId : (worked(drop) > worked(keep) ? drop.owner : keep.owner) || keep.owner || drop.owner || null;
    if (String(owner || '') !== String(keep.owner || '')) set.owner = owner || null;

    const tags = [...new Set([...(keep.tags || []), ...(drop.tags || [])].map(String))];
    if (tags.length !== (keep.tags || []).length) set.tags = tags;
    return set;
}

/** Which of a pair to keep by default: the one linked to the WhatsApp chat, else the further-along one. */
export function suggestKeep(a, b, { aChat = 0, bChat = 0 } = {}) {
    if (aChat !== bChat) return aChat > bChat ? a : b;
    const intl = (l) => /^971/.test(String(l.phoneNormalized || ''));
    if (intl(a) !== intl(b)) return intl(a) ? a : b;
    return mergedStatus(a.status, b.status) === a.status ? a : b;
}

/* ---------- reading ---------- */

/** Old records stored the local way, and every set of leads sharing a number. */
export async function duplicateReport() {
    const leads = await Lead.find({ phoneNormalized: { $regex: '^[0-9]{9,}$' } })
        .select('fullName phone phoneNormalized status owner source createdAt updatedAt storageSizeValue')
        .populate('owner', 'name').lean();
    const byTail = new Map();
    for (const l of leads) {
        const t = phoneTail9(l.phoneNormalized);
        if (!t) continue;
        if (!byTail.has(t)) byTail.set(t, []);
        byTail.get(t).push(l);
    }
    const groups = [...byTail.values()].filter((g) => g.length > 1);
    const phones = groups.flat().map((l) => l.phoneNormalized);
    const chats = await WhatsAppMessage.aggregate([
        { $match: { phoneNormalized: { $in: phones } } },
        { $group: { _id: '$phoneNormalized', n: { $sum: 1 } } },
    ]);
    const chatOf = new Map(chats.map((c) => [c._id, c.n]));
    const view = (l) => ({
        _id: String(l._id), fullName: l.fullName, phone: l.phone, phoneNormalized: l.phoneNormalized, status: l.status,
        owner: l.owner ? { _id: String(l.owner._id), name: l.owner.name } : null, source: l.source,
        createdAt: l.createdAt, updatedAt: l.updatedAt, storageSizeValue: l.storageSizeValue, messages: chatOf.get(l.phoneNormalized) || 0,
    });
    const pairs = groups.map((g) => {
        const [a, b] = g;
        const keep = suggestKeep(a, b, { aChat: chatOf.get(a.phoneNormalized) || 0, bChat: chatOf.get(b.phoneNormalized) || 0 });
        return { leads: g.map(view), suggestedKeepId: String(keep._id) };
    }).sort((x, y) => new Date(y.leads[0].updatedAt) - new Date(x.leads[0].updatedAt));

    const duplicateIds = new Set(groups.flat().map((l) => String(l._id)));
    const phoneFixes = leads
        .filter((l) => !duplicateIds.has(String(l._id)) && normalizePhone(l.phoneNormalized) !== l.phoneNormalized)
        .map((l) => ({ _id: String(l._id), fullName: l.fullName, from: l.phoneNormalized, to: normalizePhone(l.phoneNormalized) }));
    return { pairs, phoneFixes };
}

/* ---------- writing ---------- */

/** Old local-format numbers with no twin: rewritten to the WhatsApp form so their chats link up. */
export async function fixPhoneFormats() {
    const { phoneFixes } = await duplicateReport();
    let fixed = 0;
    for (const f of phoneFixes) {
        const r = await Lead.updateOne({ _id: f._id, phoneNormalized: f.from }, { $set: { phoneNormalized: f.to } }).catch(() => ({ modifiedCount: 0 }));
        fixed += r.modifiedCount || 0;
    }
    return { fixed, checked: phoneFixes.length };
}

/** Merge `dropId` into `keepId`. */
export async function mergeLeads({ keepId, dropId, ownerId, user }) {
    if (!keepId || !dropId || String(keepId) === String(dropId)) throw new Error('Choose two different leads');
    const [keep, drop] = await Promise.all([Lead.findById(keepId).lean(), Lead.findById(dropId).lean()]);
    if (!keep || !drop) throw new Error('One of these leads no longer exists');
    if (phoneTail9(keep.phoneNormalized) !== phoneTail9(drop.phoneNormalized)) throw new Error('These two leads do not have the same number');

    const set = planMerge(keep, drop, { ownerId });
    const byName = user?.name || 'An admin';
    const ownerName = set.owner ? (await User.findById(set.owner).select('name').lean())?.name : null;
    const now = new Date();

    // Everything that pointed at the duplicate now points at the kept lead.
    const moved = {};
    moved.quotes = (await Quote.updateMany({ lead: drop._id }, { $set: { lead: keep._id } })).modifiedCount;
    moved.contracts = (await Contract.updateMany({ lead: drop._id }, { $set: { lead: keep._id } })).modifiedCount;
    moved.tasks = (await Task.updateMany({ leadId: drop._id }, { $set: { leadId: keep._id } })).modifiedCount;
    moved.followUps = (await LeadFollowUp.updateMany({ lead: drop._id }, { $set: { lead: keep._id } })).modifiedCount;
    moved.messages = (await WhatsAppMessage.updateMany({ lead: drop._id }, { $set: { lead: keep._id } })).modifiedCount;
    await AgentAction.updateMany({ lead: drop._id }, { $set: { lead: keep._id } });
    if (await AgentLeadFile.exists({ lead: keep._id })) await AgentLeadFile.deleteOne({ lead: drop._id });
    else await AgentLeadFile.updateOne({ lead: drop._id }, { $set: { lead: keep._id, phoneNormalized: normalizePhone(keep.phoneNormalized) } });

    // The duplicate goes first, so the kept lead can take the proper number
    // (one live lead per number).
    await Lead.updateOne({ _id: drop._id }, {
        $set: { deletedAt: now, deletedBy: user?.id || null },
        $push: { timeline: { type: 'updated', text: `${byName} merged this lead into ${keep.fullName || 'another lead'} (same number)`, user: user?.id || null, at: now } },
    });

    const canonical = normalizePhone(keep.phoneNormalized);
    const history = (drop.timeline || []).map((t) => ({ ...t, _id: undefined, text: `[from the duplicate] ${t.text}` }));
    const summary = [
        `${byName} merged the duplicate ${drop.fullName || ''} (${drop.phone || drop.phoneNormalized}) into this lead`,
        set.status ? `stage → ${set.status.replace(/_/g, ' ')}` : '',
        ownerName ? `owner → ${ownerName}` : '',
        moved.quotes ? `${moved.quotes} quotation${moved.quotes === 1 ? '' : 's'} moved` : '',
    ].filter(Boolean).join(' · ');
    await Lead.updateOne({ _id: keep._id }, {
        $set: { ...set, phoneNormalized: canonical },
        $push: {
            attempts: { $each: drop.attempts || [] },
            comments: { $each: drop.comments || [] },
            stageHistory: { $each: drop.stageHistory || [] },
            timeline: { $each: [...history, { type: 'updated', text: summary, user: user?.id || null, at: now }] },
        },
    });
    return { kept: String(keep._id), dropped: String(drop._id), set, moved };
}

/** Every pair, each kept as suggested — for when the suggestions have been checked. */
export async function mergeAllSuggested({ user }) {
    const { pairs } = await duplicateReport();
    const out = { merged: 0, failed: [] };
    for (const p of pairs) {
        if (p.leads.length !== 2) { out.failed.push({ leads: p.leads.map((l) => l.fullName), error: 'More than two — merge these by hand' }); continue; }
        const drop = p.leads.find((l) => l._id !== p.suggestedKeepId);
        try {
            await mergeLeads({ keepId: p.suggestedKeepId, dropId: drop._id, user });
            out.merged += 1;
        } catch (e) {
            out.failed.push({ leads: p.leads.map((l) => l.fullName), error: e.message });
        }
    }
    return out;
}
