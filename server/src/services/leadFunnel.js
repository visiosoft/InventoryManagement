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

  return { total, lost, alreadyCustomer, stages, history: buildHistory(leads), losses: buildLosses(leads) };
}

/** Only explicitly recorded stage entries count. Never infer a path through skipped stages. */
export function buildHistory(leads) {
  const tracked = leads.map(lead => ({ lead, events: (lead.timeline || []).filter(event =>
    event.toStatus && ['status_changed', 'created'].includes(event.type) && Number.isFinite(new Date(event.at).getTime())) }))
    .filter(row => row.events.length);
  const daysToWin = [];
  for (const { lead, events } of tracked) {
    const won = events.filter(event => event.toStatus === 'won').sort((a, b) => new Date(a.at) - new Date(b.at))[0];
    if (won && lead.createdAt) daysToWin.push(Math.max(0, Math.round((new Date(won.at) - new Date(lead.createdAt)) / 864e5)));
  }
  return {
    tracked: tracked.length, untracked: leads.length - tracked.length,
    medianDaysToWin: median(daysToWin),
    stages: FUNNEL_STAGES.map(stage => {
      const reached = tracked.filter(row => row.events.some(event => event.toStatus === stage.key));
      const closed = reached.filter(({ lead, events }) => ['won', 'lost'].includes(lead.status) && events.some(event => event.toStatus === lead.status));
      const wins = closed.filter(({ lead }) => lead.status === 'won').length;
      return { key: stage.key, reached: reached.length, closed: closed.length, wins,
        winRate: closed.length ? Math.round(wins / closed.length * 100) : null };
    }),
  };
}

function buildLosses(leads) {
  const groups = new Map();
  for (const lead of leads.filter(lead => lead.status === 'lost')) {
    const reason = lead.lossReason || 'not_recorded';
    const source = lead.source || 'other';
    const ownerId = String(lead.owner?._id || lead.owner || 'unassigned');
    const key = JSON.stringify([reason, source, ownerId]);
    const row = groups.get(key) || { reason, source, owner: lead.owner?.name || 'Unassigned', ownerId, count: 0 };
    row.count++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Quotes are already reduced to the latest non-rejected quote for each lead. */
export function buildForecast(leads, quotes, history) {
  const byLead = new Map(quotes.map(quote => [String(quote.lead), quote]));
  let quotedValue = 0, weightedValue = 0, unweightedValue = 0, quotedLeads = 0, withoutQuote = 0, missingCloseDate = 0;
  for (const lead of leads.filter(lead => !['won', 'lost', 'already_customer'].includes(lead.status))) {
    if (!lead.expectedCloseAt) missingCloseDate++;
    const quote = byLead.get(String(lead._id));
    if (!quote || !Number.isFinite(quote.total)) { withoutQuote++; continue; }
    const value = Math.max(0, quote.total);
    quotedLeads++;
    quotedValue += value;
    const sample = history.stages.find(stage => stage.key === lead.status);
    // Five observed closed outcomes is a floor, not a claim of statistical certainty.
    if (!sample || sample.closed < 5) unweightedValue += value;
    else weightedValue += value * sample.wins / sample.closed;
  }
  return { quotedValue: Math.round(quotedValue * 100) / 100, weightedValue: Math.round(weightedValue * 100) / 100,
    unweightedValue: Math.round(unweightedValue * 100) / 100, quotedLeads, withoutQuote, missingCloseDate, minimumSample: 5 };
}
