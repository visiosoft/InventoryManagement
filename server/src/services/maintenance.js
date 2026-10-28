/**
 * Maintenance ticket rules (WP-11). Pure functions; routes/maintenance.js
 * does the reading and writing.
 *
 * SLA hours are the spec's provisional values until the owner confirms them
 * (OQ-08): S1 respond 4 h / resolve 24 h; S2 24 h / 72 h; S3 48 h / 7 days;
 * S4 resolve 30 days.
 */

export const SLA_HOURS = {
   S1: { respond: 4, resolve: 24 },
   S2: { respond: 24, resolve: 72 },
   S3: { respond: 48, resolve: 7 * 24 },
   S4: { respond: null, resolve: 30 * 24 },
};

const H = 3_600_000;

/** Due dates from the severity and the time the ticket was opened. Pure. */
export function slaDue(severity, from = new Date()) {
   const s = SLA_HOURS[severity] || SLA_HOURS.S3;
   const t = new Date(from).getTime();
   return { responseDueAt: s.respond ? new Date(t + s.respond * H) : null, resolveDueAt: new Date(t + s.resolve * H) };
}

/** 'met' | 'on_track' | 'due_soon' (under a quarter of the time left) | 'overdue'. Pure. */
export function slaState(ticket, now = new Date()) {
   if (['resolved', 'closed'].includes(ticket.status)) {
      const done = new Date(ticket.resolvedAt || ticket.closedAt || now);
      return ticket.resolveDueAt && done > new Date(ticket.resolveDueAt) ? 'missed' : 'met';
   }
   if (!ticket.resolveDueAt) return 'on_track';
   const due = new Date(ticket.resolveDueAt).getTime();
   const start = new Date(ticket.createdAt || now).getTime();
   if (now.getTime() > due) return 'overdue';
   return (due - now.getTime()) < (due - start) / 4 ? 'due_soon' : 'on_track';
}

/** Allowed moves between statuses. Pure. */
const NEXT = {
   open: ['assigned', 'in_progress', 'resolved', 'closed'],
   assigned: ['in_progress', 'awaiting_parts', 'resolved', 'open', 'closed'],
   in_progress: ['awaiting_parts', 'resolved', 'assigned'],
   awaiting_parts: ['in_progress', 'resolved'],
   resolved: ['closed', 'in_progress'],
   closed: [],
};
export const canMove = (from, to) => (NEXT[from] || []).includes(to);

/**
 * What a unit's status should be once its last open ticket closes:
 * occupied when a contract covers it, otherwise available. Pure.
 */
export const statusAfterLastTicket = (coveredByContract) => (coveredByContract ? 'occupied' : 'available');

/** Only S1 and S2 take a unit out of use (provisional until OQ-08). Pure. */
export const blocksUnit = (severity) => severity === 'S1' || severity === 'S2';

/** A severity suggestion from a free-text description; the user confirms it. Pure. */
export function suggestSeverity(text) {
   const t = String(text || '').toLowerCase();
   if (/fire|smoke|flood|leak.*(electric|power)|break.?in|forced|security|locked out|can.?t (get|open)|access (blocked|denied)|injur/.test(t)) return 'S1';
   if (/leak|water|broken (door|lock|shutter)|no power|unusable|\b(pests?|rats?|mouse|mice|termites?|mould|mold)\b/.test(t)) return 'S2';
   if (/scratch|paint|cosmetic|dent|stain|label|sign/.test(t)) return 'S4';
   return 'S3';
}
