/**
 * The pipeline, as a funnel: how many leads currently sit at each stage,
 * and how long they have been there.
 *
 * `Lead.status` is not a strictly ordered pipeline — site_visit_scheduled,
 * follow_up_scheduled and quotation_sent can be revisited in any order — so
 * this reads it as a snapshot ("at or past this stage right now"), not as a
 * rigorous history of every lead's path. Nothing here writes anything;
 * routes/leads.js's own PATCH /:id/status is what already records a
 * status_changed timeline entry on every change, and this only reads it.
 *
 * Pure — takes the leads already fetched, so the counting itself is
 * checkable without a database.
 */

export const FUNNEL_STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contact_attempted', label: 'Contact Attempted' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'site_visit_scheduled', label: 'Site Visit Scheduled' },
  { key: 'follow_up_scheduled', label: 'Follow-up Scheduled' },
  { key: 'quotation_sent', label: 'Quotation Sent' },
  { key: 'won', label: 'Won' },
];
const FUNNEL_ORDER = new Map(FUNNEL_STAGES.map((s, i) => [s.key, i]));

export function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * `leads`: [{ status, createdAt, timeline: [{ type, at }] }]
 */
export function buildFunnel(leads = [], { now = new Date() } = {}) {
  const nowT = new Date(now).getTime();
  const daysInStage = new Map(FUNNEL_STAGES.map((s) => [s.key, []]));
  let lost = 0;
  let alreadyCustomer = 0;

  for (const l of leads) {
    if (l.status === 'lost') { lost++; continue; }
    if (l.status === 'already_customer') { alreadyCustomer++; continue; }
    const bucket = daysInStage.get(l.status);
    if (!bucket) continue; // an unrecognised status: skip rather than guess

    // How long since this lead last changed status — never having changed
    // (still `new`) falls back to when it was created.
    const lastChange = (l.timeline || [])
      .filter((t) => t.type === 'status_changed')
      .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    const since = lastChange ? new Date(lastChange.at).getTime() : new Date(l.createdAt).getTime();
    bucket.push(Math.max(0, Math.round((nowT - since) / 864e5)));
  }

  const total = leads.length;
  const stages = FUNNEL_STAGES.map((s) => {
    const days = daysInStage.get(s.key);
    // Currently at this stage or any later one — the closest an
    // unordered-in-practice status field can honestly give to "reached this
    // point", without inventing a history the data does not reliably carry.
    const atOrPast = leads.filter((l) => {
      const idx = FUNNEL_ORDER.get(l.status);
      return idx !== undefined && idx >= FUNNEL_ORDER.get(s.key);
    }).length;
    return {
      key: s.key,
      label: s.label,
      count: days.length,
      medianDays: median(days),
      atOrPastPct: total ? Math.round((atOrPast / total) * 100) : 0,
    };
  });

  return { total, lost, alreadyCustomer, stages };
}
