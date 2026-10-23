/**
 * Calls from the reps' phones, synced by the staff app from Android's call
 * log: who called whom, when, for how long, answered or not.
 *
 * Only calls to a lead or an existing customer are kept — everything else on
 * a rep's phone is their own business and is dropped without being stored.
 * An outgoing call to a lead counts as a call attempt exactly as if the rep
 * had logged it by hand (stage, next chase date and all); an incoming or
 * missed call is noted on the lead's activity.
 */

import { CallLog, Lead, User } from '../models/index.js';
import { normalizePhone, phoneTail9 } from './phone.js';

// An outgoing call this short is a ring with no answer, not a conversation.
export const ANSWERED_MIN_SEC = 10;
const DIRECTIONS = new Set(['outgoing', 'incoming', 'missed', 'rejected']);

/** One call from the phone, checked and normalised; null if unusable. */
export function cleanCall(c) {
    const phoneNormalized = normalizePhone(c?.number || c?.phone || '');
    const startedAt = new Date(Number(c?.timestamp) || c?.startedAt || NaN);
    const direction = String(c?.direction || c?.type || '').toLowerCase();
    if (!phoneTail9(phoneNormalized) || Number.isNaN(startedAt.getTime()) || !DIRECTIONS.has(direction)) return null;
    const durationSec = Math.max(0, Math.round(Number(c?.durationSec ?? c?.duration) || 0));
    const deviceCallId = String(c?.id || `${phoneNormalized}-${startedAt.getTime()}`).slice(0, 120);
    return { phoneNormalized, startedAt, direction, durationSec, deviceCallId };
}

/** How an outgoing call counts as an attempt. */
export const attemptOutcome = (call) => (call.durationSec >= ANSWERED_MIN_SEC ? 'reached' : 'no_answer');

export function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** The line on the lead's activity. */
export function callLine(call, repName) {
    const who = repName || 'A rep';
    if (call.direction === 'outgoing') {
        return call.durationSec >= ANSWERED_MIN_SEC
            ? `📞 ${who} called — answered, ${formatDuration(call.durationSec)}`
            : `📞 ${who} called — no answer`;
    }
    if (call.direction === 'incoming') return `📞 Called ${who} — ${formatDuration(call.durationSec)}`;
    return `📞 Missed call to ${who}`;
}

/**
 * Store a batch of calls from one rep's phone. Returns counts. `deps` lets
 * tests run without a database.
 */
export async function ingestCalls(userId, calls, deps = {}) {
    const d = {
        findLead: async (phone) => {
            const exact = await Lead.findOne({ phoneNormalized: phone });
            if (exact) return exact;
            const tail = phoneTail9(phone);
            return tail ? Lead.findOne({ phoneNormalized: { $regex: `${tail}$` } }) : null;
        },
        isCustomer: async (phone) => (await import('./customerLeads.js')).isExistingCustomerPhone(phone).catch(() => false),
        exists: (deviceCallId) => CallLog.exists({ user: userId, deviceCallId }),
        save: (doc) => CallLog.create(doc),
        attempt: async (lead, call) => {
            const { applyOutcome, getFollowUpPlan } = await import('./followUpSequence.js');
            const { syncFollowUpTask } = await import('./followUps.js');
            applyOutcome(lead, await getFollowUpPlan(), { channel: 'call', outcome: attemptOutcome(call), userId, now: call.startedAt });
            if (lead.status === 'new') lead.status = 'contact_attempted';
            if (!lead.firstResponseAt) lead.firstResponseAt = call.startedAt;
            await syncFollowUpTask(lead).catch(() => null);
        },
        repName: async () => (await User.findById(userId).select('name').lean())?.name || '',
        ...deps,
    };
    const out = { received: (calls || []).length, saved: 0, ignored: 0, duplicates: 0, attempts: 0 };
    const name = await d.repName();
    for (const raw of (calls || []).slice(0, 500)) {
        const call = cleanCall(raw);
        if (!call) { out.ignored += 1; continue; }
        if (await d.exists(call.deviceCallId)) { out.duplicates += 1; continue; }
        const lead = await d.findLead(call.phoneNormalized);
        const isCustomer = lead ? false : await d.isCustomer(call.phoneNormalized);
        // Not a lead, not a customer: a personal call. Not stored.
        if (!lead && !isCustomer) { out.ignored += 1; continue; }
        try {
            await d.save({ ...call, user: userId, lead: lead?._id || null, isCustomer });
        } catch (e) {
            if (e?.code === 11000) { out.duplicates += 1; continue; }
            throw e;
        }
        out.saved += 1;
        if (lead) {
            if (call.direction === 'outgoing') { await d.attempt(lead, call); out.attempts += 1; }
            lead.timeline.push({ type: 'call', text: callLine(call, name), user: userId, at: call.startedAt });
            await lead.save().catch((e) => console.error('[CallLog] lead save:', e.message));
        }
    }
    return out;
}

/**
 * Per rep over a period: calls made, answered, talk time, incoming, missed,
 * and how many different leads they called. Rows are CallLog documents.
 */
export function summariseCalls(rows) {
    const by = new Map();
    for (const r of rows) {
        const id = String(r.user?._id || r.user);
        const t = by.get(id) || { userId: id, name: r.user?.name || '', made: 0, answered: 0, talkSec: 0, incoming: 0, missed: 0, leads: new Set() };
        if (r.direction === 'outgoing') {
            t.made += 1;
            if (r.durationSec >= ANSWERED_MIN_SEC) t.answered += 1;
            if (r.lead) t.leads.add(String(r.lead));
        } else if (r.direction === 'incoming') t.incoming += 1;
        else t.missed += 1;
        t.talkSec += r.durationSec || 0;
        by.set(id, t);
    }
    return [...by.values()].map((t) => ({ ...t, leads: t.leads.size })).sort((a, b) => b.made - a.made);
}
