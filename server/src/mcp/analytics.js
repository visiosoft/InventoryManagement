import { Contract, Unit, Lead, Payment, Quote, Invoice } from '../models/index.js';
import { responseTimeReport } from './crmTools.js';

/**
 * Trends and forecasts. Everything is computed from the live contracts, leads
 * and payments: no outside data. Forecasts are projections with stated
 * assumptions, not promises: each one returns the assumptions it used so they
 * can be questioned.
 */

const DAY = 864e5;
const VAT_PCT = 5;
const incVat = (n) => money(n * (1 + VAT_PCT / 100));
const day = (d) => new Date(d).toISOString().slice(0, 10);
const money = (n) => Number(Number(n || 0).toFixed(2));
const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const rate4wk = (c) => Number(c.leasedPrice || c.rate || 0);
const ids = (c) => [c.unit, ...(c.units || [])].filter(Boolean).map(String);
const live = { archived: { $ne: true }, status: { $in: ['active', 'ended'] } };

function endOfMonth(y, m) { return new Date(Date.UTC(y, m + 1, 1) - 1); }

/** Occupied units on a date, from contract dates. */
function occupiedOn(contracts, at) {
  const t = at.getTime();
  const set = new Set();
  for (const c of contracts) {
    if (!c.startDate || new Date(c.startDate).getTime() > t) continue;
    if (c.endDate && new Date(c.endDate).getTime() < t) continue;
    ids(c).forEach((u) => set.add(u));
  }
  return set.size;
}

/**
 * Money received per month. Every payment recorded against an invoice lives on
 * the invoice itself (with its date), and the scheduled Payment rows only mirror
 * those, so the invoices are the source. Scheduled payments marked paid with no
 * invoice behind them are added on top, so nothing is counted twice or missed.
 */
export async function collectedByMonth(from) {
  const [inv, loose] = await Promise.all([
    Invoice.aggregate([{ $match: { deletedAt: null, status: { $ne: 'cancelled' } } }, { $unwind: '$paymentHistory' }, { $match: { 'paymentHistory.date': { $gte: from } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paymentHistory.date' } }, total: { $sum: '$paymentHistory.amount' }, n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: 'paid', deletedAt: null, invoice: { $in: [null, undefined] }, paidDate: { $gte: from } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidDate' } }, total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
  ]);
  const m = new Map();
  for (const r of [...inv, ...loose]) { const x = m.get(r._id) || { _id: r._id, total: 0, n: 0 }; x.total += r.total; x.n += r.n; m.set(r._id, x); }
  return [...m.values()];
}

export async function occupancyAndRevenueTrend({ months = 12 } = {}) {
  const m = Math.min(36, Math.max(2, months));
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 1));
  const [totalUnits, contracts, paid] = await Promise.all([
    Unit.countDocuments({ status: { $ne: 'maintenance' } }),
    Contract.find({ ...live, endDate: { $gte: from } }).select('unit units startDate endDate').lean(),
    collectedByMonth(from),
  ]);
  const byMonth = new Map(paid.map((p) => [p._id, p]));
  const rows = [];
  const now = new Date();
  for (let i = m - 1; i >= 0; i -= 1) {
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const eom = i === 0 ? now : endOfMonth(ref.getUTCFullYear(), ref.getUTCMonth());
    const occ = occupiedOn(contracts, eom);
    const key = monthKey(ref);
    rows.push({ month: key, occupiedUnits: occ, occupancyPct: totalUnits ? Math.round((occ / totalUnits) * 1000) / 10 : null, paymentsCollectedAed: money(byMonth.get(key)?.total), paymentsCount: byMonth.get(key)?.n || 0 });
  }
  return { totalUnits, note: 'Occupancy at each month end (today for the current month), from contract start and end dates. Collected = money recorded against invoices that month (plus any paid scheduled payment with no invoice), VAT included.', months: rows };
}

export async function conversionReport({ days = 90 } = {}) {
  const since = new Date(Date.now() - days * DAY);
  const leads = await Lead.find({ deletedAt: null, createdAt: { $gte: since } }).populate('owner', 'name').select('source status owner lostReason').lean();
  const group = (keyFn) => {
    const m = new Map();
    for (const l of leads) { const k = keyFn(l); const r = m.get(k) || { key: k, leads: 0, won: 0, lost: 0, open: 0 }; r.leads += 1; if (l.status === 'won') r.won += 1; else if (l.status === 'lost') r.lost += 1; else if (l.status !== 'already_customer') r.open += 1; m.set(k, r); }
    return [...m.values()].map((r) => ({ ...r, winRatePct: r.leads ? Math.round((r.won / r.leads) * 1000) / 10 : 0, winRateOfClosedPct: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null })).sort((a, b) => b.leads - a.leads);
  };
  const reasons = new Map();
  for (const l of leads) if (l.status === 'lost') reasons.set(l.lostReason || 'not_recorded', (reasons.get(l.lostReason || 'not_recorded') || 0) + 1);
  return { periodDays: days, totalLeads: leads.length, overall: group(() => 'all')[0] || null, bySource: group((l) => l.source || 'manual'), byRep: group((l) => l.owner?.name || 'Unassigned'), lostReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
}

/**
 * Where occupancy and monthly revenue are heading over the next N weeks.
 * Contracts ending in the window renew with a probability from what the tenant
 * said (renewing / not renewing) or, if undecided, from the real renewal rate of
 * contracts that ended in the last 12 months. New tenants arrive at the recent
 * average pace, and the open quoted pipeline is shown separately as upside.
 */
export async function forecast({ weeks = 12, renewalRatePct, newTenantsPerWeek } = {}) {
  const w = Math.min(52, Math.max(1, weeks));
  const now = new Date();
  const horizon = new Date(now.getTime() + w * 7 * DAY);
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const [totalUnits, contracts] = await Promise.all([
    Unit.countDocuments({ status: { $ne: 'maintenance' } }),
    Contract.find({ ...live, $or: [{ endDate: { $gte: yearAgo } }, { status: 'active' }] }).select('customer unit units startDate endDate status renewalIntent rate leasedPrice').lean(),
  ]);

  // Real renewal rate: ended contracts followed by another for the same customer within 30 days.
  const byCustomer = new Map();
  for (const c of contracts) { const k = String(c.customer); (byCustomer.get(k) || byCustomer.set(k, []).get(k)).push(c); }
  let ended = 0; let renewed = 0;
  for (const c of contracts) {
    if (!c.endDate || new Date(c.endDate) >= now || new Date(c.endDate) < yearAgo) continue;
    ended += 1;
    const next = (byCustomer.get(String(c.customer)) || []).some((o) => o !== c && new Date(o.startDate) >= new Date(new Date(c.endDate).getTime() - 7 * DAY) && new Date(o.startDate) <= new Date(new Date(c.endDate).getTime() + 30 * DAY));
    if (next) renewed += 1;
  }
  const given = Number.isFinite(Number(renewalRatePct)) && renewalRatePct !== undefined && renewalRatePct !== null && renewalRatePct !== '';
  const histRenewal = given ? Math.min(1, Math.max(0, Number(renewalRatePct) / 100)) : ended >= 10 ? renewed / ended : 0.6;

  // Recent pace of new contracts (last 12 weeks), in contracts and AED per 4 weeks.
  const paceFrom = new Date(now.getTime() - 84 * DAY);
  const fresh = contracts.filter((c) => c.startDate && new Date(c.startDate) >= paceFrom && new Date(c.startDate) <= now);
  const newPerWeek = Number.isFinite(Number(newTenantsPerWeek)) && newTenantsPerWeek !== undefined && newTenantsPerWeek !== null && newTenantsPerWeek !== '' ? Math.max(0, Number(newTenantsPerWeek)) : fresh.length / 12;
  const avgRate = fresh.length ? fresh.reduce((s, c) => s + rate4wk(c), 0) / fresh.length : 0;
  const avgUnitsPer = fresh.length ? fresh.reduce((s, c) => s + ids(c).length, 0) / fresh.length : 1;

  const probOf = (c, mode) => {
    const base = c.renewalIntent === 'renewing' ? 0.95 : c.renewalIntent === 'not_renewing' ? 0.05 : histRenewal;
    return mode === 'low' ? Math.max(0, base - 0.15) : mode === 'high' ? Math.min(1, base + 0.15) : base;
  };

  const activeNow = contracts.filter((c) => c.status === 'active' && new Date(c.startDate) <= now && (!c.endDate || new Date(c.endDate) >= now));
  const rows = [];
  for (let i = 1; i <= w; i += 1) {
    const at = new Date(now.getTime() + i * 7 * DAY);
    const scenario = (mode) => {
      let units = 0; let revenue = 0;
      for (const c of activeNow) {
        const end = c.endDate ? new Date(c.endDate) : null;
        const p = end && end < at ? probOf(c, mode) : 1;
        units += ids(c).length * p; revenue += rate4wk(c) * p;
      }
      const growth = newPerWeek * i * (mode === 'low' ? 0.7 : mode === 'high' ? 1.3 : 1);
      units += growth * avgUnitsPer; revenue += growth * avgRate;
      return { units: Math.min(totalUnits, Math.round(units)), revenue: money(revenue) };
    };
    const lo = scenario('low'); const base = scenario('base'); const hi = scenario('high');
    rows.push({ weekEnding: day(at), occupiedUnits: { low: lo.units, base: base.units, high: hi.units }, occupancyPct: totalUnits ? Math.round((base.units / totalUnits) * 1000) / 10 : null, revenuePer4WeeksAed: { low: lo.revenue, base: base.revenue, high: hi.revenue }, revenuePer4WeeksIncVatAed: { low: incVat(lo.revenue), base: incVat(base.revenue), high: incVat(hi.revenue) } });
  }

  const endingSoon = activeNow.filter((c) => c.endDate && new Date(c.endDate) <= horizon);
  const quoted = await Lead.countDocuments({ deletedAt: null, status: 'quotation_sent' });
  const quoteStats = await Quote.aggregate([{ $match: { deletedAt: null, createdAt: { $gte: yearAgo }, status: { $in: ['accepted', 'rejected', 'expired', 'sent'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const qn = Object.fromEntries(quoteStats.map((q) => [q._id, q.n]));
  const quoteWin = (qn.accepted || 0) + (qn.rejected || 0) + (qn.expired || 0) >= 10 ? (qn.accepted || 0) / ((qn.accepted || 0) + (qn.rejected || 0) + (qn.expired || 0)) : null;

  return {
    horizonWeeks: w, totalUnits,
    now: { occupiedUnits: new Set(activeNow.flatMap(ids)).size, revenuePer4WeeksAed: money(activeNow.reduce((s, c) => s + rate4wk(c), 0)), revenuePer4WeeksIncVatAed: incVat(activeNow.reduce((s, c) => s + rate4wk(c), 0)) },
    assumptions: {
      revenueBasis: `Run-rate: each contract's 4-week price, excluding VAT (the IncVat figures add ${VAT_PCT}%). One-off first-period discounts are deliberately left out of the run-rate.`,
      overrides: 'Pass renewalRatePct and/or newTenantsPerWeek to replace the history-based figures with your own.',
      renewalRateUsed: `${Math.round(histRenewal * 100)}% for undecided tenants (${given ? 'your figure' : ended >= 10 ? `real: ${renewed} of ${ended} contracts that ended in the last 12 months were followed by another` : 'default, too little history'})`,
      tenantSaidRenewing: '95% renew', tenantSaidNotRenewing: '5% renew',
      newTenantsPerWeek: Math.round(newPerWeek * 10) / 10, averageNewRatePer4WeeksAed: money(avgRate),
      scenarios: 'low = renewals 15 points lower and 30% fewer new tenants; high = 15 points higher and 30% more',
    },
    contractsEndingInWindow: { count: endingSoon.length, saidRenewing: endingSoon.filter((c) => c.renewalIntent === 'renewing').length, saidNotRenewing: endingSoon.filter((c) => c.renewalIntent === 'not_renewing').length, undecided: endingSoon.filter((c) => !c.renewalIntent || c.renewalIntent === 'undecided').length },
    pipelineUpside: { leadsWithQuoteSent: quoted, historicalQuoteAcceptancePct: quoteWin == null ? null : Math.round(quoteWin * 100), expectedWins: quoteWin == null ? null : Math.round(quoted * quoteWin) },
    weeks: rows,
  };
}

/** Money expected in over the next N weeks: scheduled payments by due week, plus renewals likely to pay. */
export async function cashForecast({ weeks = 8 } = {}) {
  const w = Math.min(26, Math.max(1, weeks));
  const now = new Date();
  const horizon = new Date(now.getTime() + w * 7 * DAY);
  const pending = await Payment.find({ deletedAt: null, status: { $in: ['pending', 'overdue'] }, dueDate: { $lte: horizon } }).select('amount dueDate').lean();
  let overdue = 0; let overdueN = 0;
  const buckets = Array.from({ length: w }, (_, i) => ({ weekEnding: day(new Date(now.getTime() + (i + 1) * 7 * DAY)), scheduledAed: 0, count: 0 }));
  for (const p of pending) {
    if (new Date(p.dueDate) < now) { overdue += p.amount || 0; overdueN += 1; continue; }
    const idx = Math.min(w - 1, Math.floor((new Date(p.dueDate) - now) / (7 * DAY)));
    buckets[idx].scheduledAed += p.amount || 0; buckets[idx].count += 1;
  }
  const f = await forecast({ weeks: w });
  return {
    horizonWeeks: w,
    overdueNow: { aed: money(overdue), count: overdueN, note: 'Already due; collection depends on chasing, not on the calendar.' },
    scheduledByWeek: buckets.map((b) => ({ ...b, scheduledAed: money(b.scheduledAed) })),
    scheduledTotalAed: money(buckets.reduce((s, b) => s + b.scheduledAed, 0)),
    renewalNote: `${f.contractsEndingInWindow.count} contracts end in this window; those likely to renew will generate further invoices. See forecast for the revenue effect.`,
  };
}

/** One call for the whole picture. */
export async function businessSnapshot() {
  const [f, rt, conv, trend] = await Promise.all([forecast({ weeks: 4 }), responseTimeReport({ days: 30 }), conversionReport({ days: 30 }), occupancyAndRevenueTrend({ months: 3 })]);
  const owed = await Payment.aggregate([{ $match: { deletedAt: null, status: { $in: ['pending', 'overdue'] } } }, { $group: { _id: { $cond: [{ $lt: ['$dueDate', new Date()] }, 'overdue', 'upcoming'] }, total: { $sum: '$amount' }, n: { $sum: 1 } } }]);
  const o = Object.fromEntries(owed.map((x) => [x._id, { aed: money(x.total), count: x.n }]));
  return { occupancy: { occupiedUnits: f.now.occupiedUnits, totalUnits: f.totalUnits, pct: f.totalUnits ? Math.round((f.now.occupiedUnits / f.totalUnits) * 1000) / 10 : null }, revenuePer4WeeksAed: f.now.revenuePer4WeeksAed, owed: { overdue: o.overdue || { aed: 0, count: 0 }, upcoming: o.upcoming || { aed: 0, count: 0 } }, salesLast30Days: { leads: conv.totalLeads, won: conv.overall?.won || 0, winRatePct: conv.overall?.winRatePct, averageResponse: rt.team.averageReadable, medianResponse: rt.team.medianReadable, neverAnswered: rt.team.leadsNeverAnswered }, nextFourWeeks: f.weeks.map((w) => ({ weekEnding: w.weekEnding, occupiedUnits: w.occupiedUnits.base, revenuePer4WeeksAed: w.revenuePer4WeeksAed.base })), lastThreeMonths: trend.months };
}
