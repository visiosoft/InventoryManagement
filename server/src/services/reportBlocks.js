/**
 * The things a report can be built out of.
 *
 * A language model asked to write database queries will eventually return a
 * number that is wrong and entirely plausible, with nothing in the system to
 * catch it. So it never touches the database and never does arithmetic. It
 * picks from this catalogue — named, parameterised functions that each answer
 * one question — and decides how to arrange and describe them. The figures
 * come from here, where they can be tested.
 *
 * Every block is facility-aware through the `scope` argument, which is the
 * result of `utils/siteScope.js`. A null scope means the whole company.
 *
 * Adding a question the catalogue cannot answer is a new block plus its test,
 * not a longer prompt.
 */

import { Contract, Unit, Lead, Payment, User } from '../models/index.js';

const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Month boundaries in Dubai time, which is where the business is. */
function monthRange(offset = 0) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    return { start, end };
}

function parseDate(v, fallback) {
    if (!v) return fallback;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? fallback : d;
}

/* Filters derived from the facility scope. Spread into a query; an unscoped
   report spreads nothing and therefore covers every facility. */
const unitWhere = (scope) => (scope ? scope.unitFilter : {});
const contractWhere = (scope) => (scope ? scope.contractFilter : {});
const paymentWhere = (scope) => (scope ? scope.paymentFilter : {});

export const BLOCKS = {
    occupancy_now: {
        summary: 'Units right now: booked, reserved, vacant, under maintenance, and occupancy percent.',
        params: {},
        shape: 'stat',
        async run(_params, scope) {
            const rows = await Unit.aggregate([
                { $match: unitWhere(scope) },
                { $group: { _id: '$status', n: { $sum: 1 } } },
            ]);
            const get = (k) => rows.find((r) => r._id === k)?.n ?? 0;
            const booked = get('occupied');
            const reserved = get('reserved');
            const vacant = get('available');
            const maintenance = get('maintenance');
            // Occupancy is measured against what can actually be let, so a unit
            // out of service is not counted as empty stock nobody has sold.
            const lettable = booked + reserved + vacant;
            return {
                stats: [
                    { label: 'Booked', value: booked },
                    { label: 'Reserved', value: reserved },
                    { label: 'Vacant', value: vacant },
                    { label: 'Under maintenance', value: maintenance },
                    { label: 'Occupancy', value: lettable ? Math.round(((booked + reserved) / lettable) * 100) : 0, unit: '%' },
                ],
                totals: { units: booked + reserved + vacant + maintenance, lettable },
            };
        },
    },

    units_available: {
        summary: 'Every vacant unit, with its size, floor and list price. Optionally filtered to one size.',
        params: { sizeSqf: 'number?' },
        shape: 'table',
        async run({ sizeSqf }, scope) {
            const q = { ...unitWhere(scope), status: 'available' };
            if (Number.isFinite(Number(sizeSqf))) q.sizeSqf = Number(sizeSqf);
            const units = await Unit.find(q).sort({ floor: 1, unitNumber: 1 }).lean();
            return {
                columns: ['Unit', 'Floor', 'Size (sq ft)', 'Price'],
                rows: units.map((u) => [u.unitNumber, u.floor || '', u.sizeSqf ?? '', u.price ?? '']),
                totals: { units: units.length },
            };
        },
    },

    unit_size_demand: {
        summary: 'How many units of each size exist and how many are free — where the stock is and is not.',
        params: {},
        shape: 'table',
        async run(_params, scope) {
            const rows = await Unit.aggregate([
                { $match: unitWhere(scope) },
                { $group: {
                    _id: '$sizeSqf',
                    total: { $sum: 1 },
                    available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
                } },
                { $sort: { _id: 1 } },
            ]);
            return {
                columns: ['Size (sq ft)', 'Total', 'Vacant', 'Let'],
                rows: rows.map((r) => [r._id ?? '—', r.total, r.available, r.total - r.available]),
                totals: { units: rows.reduce((s, r) => s + r.total, 0) },
            };
        },
    },

    contracts_active: {
        summary: 'Contracts currently running: tenant, unit, term and rate.',
        params: {},
        shape: 'table',
        async run(_params, scope) {
            const rows = await Contract.find({ ...contractWhere(scope), status: 'active' })
                .populate('customer', 'fullName').populate('unit', 'unitNumber').populate('units', 'unitNumber')
                .sort({ endDate: 1 }).lean();
            return {
                columns: ['Contract', 'Tenant', 'Unit', 'Start', 'End', 'Rate'],
                rows: rows.map((c) => [
                    c.contractNo, c.customer?.fullName || '',
                    (c.units?.length ? c.units : [c.unit]).filter(Boolean).map((u) => u.unitNumber).join(', '),
                    iso(c.startDate), iso(c.endDate), money(c.rate),
                ]),
                totals: { contracts: rows.length, rate: money(rows.reduce((s, c) => s + Number(c.rate || 0), 0)) },
            };
        },
    },

    contracts_expiring: {
        summary: 'Contracts still running whose end date falls in a date range — the re-letting pipeline.',
        params: { from: 'date?', to: 'date?' },
        shape: 'table',
        async run({ from, to }, scope) {
            const { start, end } = monthRange(0);
            const f = parseDate(from, start);
            const t = parseDate(to, end);
            const rows = await Contract.find({
                ...contractWhere(scope), status: 'active', endDate: { $gte: f, $lt: t },
            }).populate('customer', 'fullName').populate('unit', 'unitNumber').populate('units', 'unitNumber')
                .sort({ endDate: 1 }).lean();
            return {
                columns: ['Contract', 'Tenant', 'Unit', 'Ends', 'Rate'],
                rows: rows.map((c) => [
                    c.contractNo, c.customer?.fullName || '',
                    (c.units?.length ? c.units : [c.unit]).filter(Boolean).map((u) => u.unitNumber).join(', '),
                    iso(c.endDate), money(c.rate),
                ]),
                totals: { contracts: rows.length, from: iso(f), to: iso(t) },
            };
        },
    },

    contracts_ended: {
        summary: 'Past contracts that have ended in a date range, and how long each tenant stayed.',
        params: { from: 'date?', to: 'date?' },
        shape: 'table',
        async run({ from, to }, scope) {
            const f = parseDate(from, new Date(2000, 0, 1));
            const t = parseDate(to, new Date());
            const rows = await Contract.find({
                ...contractWhere(scope), status: 'ended', endDate: { $gte: f, $lte: t },
            }).populate('customer', 'fullName').populate('unit', 'unitNumber')
                .sort({ endDate: -1 }).lean();
            const days = (c) => Math.max(0, Math.round((new Date(c.endDate) - new Date(c.startDate)) / 86400000));
            return {
                columns: ['Contract', 'Tenant', 'Unit', 'Started', 'Ended', 'Days stayed'],
                rows: rows.map((c) => [
                    c.contractNo, c.customer?.fullName || '', c.unit?.unitNumber || '',
                    iso(c.startDate), iso(c.endDate), days(c),
                ]),
                totals: {
                    contracts: rows.length,
                    averageDays: rows.length ? Math.round(rows.reduce((s, c) => s + days(c), 0) / rows.length) : 0,
                },
            };
        },
    },

    move_ins_outs: {
        summary: 'Move-ins and move-outs per month over the last N months.',
        params: { months: 'number?' },
        shape: 'series',
        async run({ months }, scope) {
            const n = Math.min(Math.max(Number(months) || 6, 1), 24);
            const cW = contractWhere(scope);
            const points = [];
            for (let i = n - 1; i >= 0; i--) {
                const { start, end } = monthRange(-i);
                const [ins, outs] = await Promise.all([
                    Contract.countDocuments({ ...cW, startDate: { $gte: start, $lt: end } }),
                    Contract.countDocuments({ ...cW, status: 'ended', endDate: { $gte: start, $lt: end } }),
                ]);
                points.push({
                    label: start.toLocaleString('en-GB', { month: 'short', year: '2-digit' }),
                    'Move-ins': ins,
                    'Move-outs': outs,
                });
            }
            return { series: points, keys: ['Move-ins', 'Move-outs'], totals: { months: n } };
        },
    },

    revenue_collected: {
        summary: 'Payments actually received per month over the last N months.',
        params: { months: 'number?' },
        shape: 'series',
        async run({ months }, scope) {
            const n = Math.min(Math.max(Number(months) || 6, 1), 24);
            const pW = paymentWhere(scope);
            const points = [];
            for (let i = n - 1; i >= 0; i--) {
                const { start, end } = monthRange(-i);
                const agg = await Payment.aggregate([
                    { $match: { ...pW, status: 'paid', paidDate: { $gte: start, $lt: end } } },
                    { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } },
                ]);
                points.push({
                    label: start.toLocaleString('en-GB', { month: 'short', year: '2-digit' }),
                    Collected: money(agg[0]?.total || 0),
                    payments: agg[0]?.n || 0,
                });
            }
            return {
                series: points, keys: ['Collected'],
                totals: { collected: money(points.reduce((s, p) => s + p.Collected, 0)) },
            };
        },
    },

    revenue_outstanding: {
        summary: 'Money owed but not paid, aged by how overdue it is.',
        params: {},
        shape: 'table',
        async run(_params, scope) {
            const now = new Date();
            const rows = await Payment.find({ ...paymentWhere(scope), status: { $in: ['overdue', 'pending'] } })
                .populate({ path: 'contract', select: 'contractNo customer', populate: { path: 'customer', select: 'fullName' } })
                .sort({ dueDate: 1 }).lean();
            const bucket = (d) => {
                const days = Math.floor((now - new Date(d)) / 86400000);
                if (days < 0) return 'Not yet due';
                if (days <= 7) return '1–7 days';
                if (days <= 30) return '8–30 days';
                return 'Over 30 days';
            };
            return {
                columns: ['Contract', 'Tenant', 'Due', 'Amount', 'Age'],
                rows: rows.map((p) => [
                    p.contract?.contractNo || '', p.contract?.customer?.fullName || '',
                    iso(p.dueDate), money(p.amount), bucket(p.dueDate),
                ]),
                totals: { payments: rows.length, amount: money(rows.reduce((s, p) => s + Number(p.amount || 0), 0)) },
            };
        },
    },

    leads_funnel: {
        summary: 'Leads by stage, and by where they came from, over a date range.',
        params: { from: 'date?', to: 'date?' },
        shape: 'table',
        async run({ from, to }) {
            // Leads are company-wide: a lead is not attached to a facility until
            // it becomes a contract on a unit, so scoping here would silently
            // drop every enquiry that has not been placed yet.
            const f = parseDate(from, new Date(2000, 0, 1));
            const t = parseDate(to, new Date());
            const match = { createdAt: { $gte: f, $lte: t } };
            const [byStatus, bySource] = await Promise.all([
                Lead.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
                Lead.aggregate([{ $match: match }, { $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
            ]);
            const total = byStatus.reduce((s, r) => s + r.n, 0);
            return {
                columns: ['Grouping', 'Value', 'Leads', 'Share'],
                rows: [
                    ...byStatus.map((r) => ['Stage', r._id ?? '—', r.n, total ? `${Math.round((r.n / total) * 100)}%` : '0%']),
                    ...bySource.map((r) => ['Source', r._id ?? '—', r.n, total ? `${Math.round((r.n / total) * 100)}%` : '0%']),
                ],
                totals: { leads: total, from: iso(f), to: iso(t) },
            };
        },
    },

    leads_by_rep: {
        summary: 'Per sales rep: leads owned, how many were contacted, how many won, and conversion rate.',
        params: { from: 'date?', to: 'date?' },
        shape: 'table',
        async run({ from, to }) {
            const f = parseDate(from, new Date(2000, 0, 1));
            const t = parseDate(to, new Date());
            const [users, rows] = await Promise.all([
                User.find({}).select('name email').lean(),
                Lead.aggregate([
                    { $match: { createdAt: { $gte: f, $lte: t }, owner: { $ne: null } } },
                    { $group: {
                        _id: '$owner',
                        leads: { $sum: 1 },
                        contacted: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$attempts', []] } }, 0] }, 1, 0] } },
                        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
                        lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
                    } },
                    { $sort: { leads: -1 } },
                ]),
            ]);
            const nameOf = (id) => users.find((u) => String(u._id) === String(id));
            return {
                columns: ['Sales rep', 'Leads', 'Contacted', 'Won', 'Lost', 'Conversion'],
                rows: rows.map((r) => {
                    const u = nameOf(r._id);
                    return [
                        u?.name || u?.email || 'Unknown', r.leads, r.contacted, r.won, r.lost,
                        r.leads ? `${Math.round((r.won / r.leads) * 100)}%` : '0%',
                    ];
                }),
                totals: {
                    leads: rows.reduce((s, r) => s + r.leads, 0),
                    won: rows.reduce((s, r) => s + r.won, 0),
                    from: iso(f), to: iso(t),
                },
            };
        },
    },

    rep_performance: {
        summary: 'Per sales rep: contracts credited to them and the total deal value of those contracts.',
        params: { from: 'date?', to: 'date?' },
        shape: 'table',
        async run({ from, to }, scope) {
            const f = parseDate(from, new Date(2000, 0, 1));
            const t = parseDate(to, new Date());
            const [users, rows] = await Promise.all([
                User.find({}).select('name email').lean(),
                Contract.aggregate([
                    /* Credited by `salesRep` and bucketed on `createdAt`, deliberately
                       matching routes/salesTeam.js, which is the only other place that
                       puts money against a person. Two pages disagreeing about a rep's
                       number is worse than either definition being imperfect.

                       `totalQuotation` is the deal value; `rate` is only the periodic
                       charge, so summing rate would understate a long contract and
                       flatter a short one. */
                    { $match: { ...contractWhere(scope), salesRep: { $ne: null }, createdAt: { $gte: f, $lte: t } } },
                    { $group: {
                        _id: '$salesRep',
                        contracts: { $sum: 1 },
                        value: { $sum: { $ifNull: ['$totalQuotation', 0] } },
                    } },
                    { $sort: { value: -1 } },
                ]),
            ]);
            const nameOf = (id) => users.find((u) => String(u._id) === String(id));
            return {
                columns: ['Sales rep', 'Contracts', 'Deal value'],
                rows: rows.map((r) => {
                    const u = nameOf(r._id);
                    return [u?.name || u?.email || 'Unknown', r.contracts, money(r.value)];
                }),
                totals: {
                    contracts: rows.reduce((s, r) => s + r.contracts, 0),
                    value: money(rows.reduce((s, r) => s + Number(r.value || 0), 0)),
                    from: iso(f), to: iso(t),
                },
                /* Said out loud because it is the obvious next question and the
                   data cannot answer it: a Payment has no rep on it, so this is
                   what was signed, not what was collected. */
                note: 'Deal value is what was signed, not what has been collected — payments are not attributed to a rep.',
            };
        },
    },
};

/** What the model is told it can use. Names and descriptions only — never data. */
export function blockCatalogue() {
    return Object.entries(BLOCKS).map(([name, b]) => ({
        name, summary: b.summary, params: b.params, shape: b.shape,
    }));
}

export function blockNames() {
    return Object.keys(BLOCKS);
}
