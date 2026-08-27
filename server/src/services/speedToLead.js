/**
 * How long an assigned lead has been sitting untouched.
 *
 * A lead handed to somebody should be contacted within a couple of minutes.
 * Nothing measured that, and nothing said when it had not happened: over the
 * last thirty days the median time to a first reply was an hour, and
 * seventy-nine conversations never got one at all.
 *
 * The clock starts when a person chooses an owner — not when the WhatsApp sync
 * gives an inbound chat its default one, or every enquiry of the day would be
 * on the board within two minutes of arriving.
 *
 * It stops when the rep does something about it: logs an attempt, or moves the
 * stage. Both record who and when. Opening the lead does not count — reading a
 * name is not answering a customer, and a measure you can satisfy by looking
 * at a screen measures nothing.
 *
 * Nothing here sends anything, and nothing here is scheduled. The panel is
 * computed when somebody asks for it.
 */

const MINUTE_MS = 60_000;

/** The default, when the plan has not been given one. */
export const DEFAULT_SLA_MINUTES = 2;

/** How long this lead has been waiting, in ms. Zero if it was never assigned. */
export function waitingFor(lead = {}, now = new Date()) {
  if (!lead.assignedAt) return 0;
  const since = new Date(lead.assignedAt).getTime();
  if (Number.isNaN(since)) return 0;
  return Math.max(0, new Date(now).getTime() - since);
}

/**
 * Is this lead past its window with nothing done about it?
 *
 * A lead nobody owns is nobody's to answer, and a won or lost one is finished
 * — neither belongs on a panel about what needs doing now.
 */
export function isWaiting(lead = {}, now = new Date(), slaMs = DEFAULT_SLA_MINUTES * MINUTE_MS) {
  if (!lead.assignedAt) return false;
  if (lead.firstResponseAt) return false;
  if (!lead.owner) return false;
  if (lead.status === 'won' || lead.status === 'lost') return false;
  return waitingFor(lead, now) >= slaMs;
}

/**
 * What is waiting, longest first — the order it should be dealt with, so the
 * panel reads top-down rather than asking anybody to scan it.
 */
export function summarise(leads = [], now = new Date(), slaMinutes = DEFAULT_SLA_MINUTES) {
  const slaMs = Math.max(1, Number(slaMinutes) || DEFAULT_SLA_MINUTES) * MINUTE_MS;

  const rows = leads
    .filter((l) => isWaiting(l, now, slaMs))
    .map((l) => ({
      _id: String(l._id),
      fullName: l.fullName || l.phone || 'Unnamed',
      phone: l.phone || '',
      ownerName: l.owner?.name || '',
      waitedMs: waitingFor(l, now),
    }))
    .sort((a, b) => b.waitedMs - a.waitedMs);

  return {
    slaMinutes: Math.round(slaMs / MINUTE_MS),
    count: rows.length,
    longestMs: rows.length ? rows[0].waitedMs : 0,
    rows,
  };
}
