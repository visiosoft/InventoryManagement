/**
 * Per rep, what their follow-ups have done: sent today, and over the last
 * seven days how many were sent and how many got a reply. Feeds the admin's
 * team table on the Follow-Ups page; the queue itself (who is waiting) is
 * counted in the browser from the list it already has.
 */

const DUBAI_MS = 4 * 3600000;

/** Midnight in Dubai at the start of the day containing `now`. */
export function dubaiDayStart(now = new Date()) {
    const local = new Date(now.getTime() + DUBAI_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - DUBAI_MS);
}

/** rows: LeadFollowUp documents from the last seven days. */
export function tallyTeam(rows, now = new Date()) {
    const today = dubaiDayStart(now);
    const by = new Map();
    for (const r of rows || []) {
        if (r.status !== 'sent' || !r.sentBy) continue;
        const id = String(r.sentBy);
        const t = by.get(id) || { ownerId: id, name: r.sentByName || '', sentToday: 0, sentWeek: 0, repliedWeek: 0 };
        t.sentWeek += 1;
        if (r.repliedAt) t.repliedWeek += 1;
        if (new Date(r.sentAt) >= today) t.sentToday += 1;
        if (!t.name && r.sentByName) t.name = r.sentByName;
        by.set(id, t);
    }
    return [...by.values()];
}
