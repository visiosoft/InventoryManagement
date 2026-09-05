import { Unit, Contract, Customer, Lead, Task, Document, WhatsAppMessage } from '../../models/index.js';
import { BLOCKS, blockCatalogue } from '../reportBlocks.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { quoteLines, quoteTotals, termWeeks } from '../quoteLines.js';
import { dayKeyFor, dayRange, previousDay } from '../dailyDigest.js';
import { resolveNames } from '../inboxAsk.js';

/**
 * Everything the assistant is allowed to know.
 *
 * Each tool is a question the server answers from this database. The model
 * chooses which to ask and phrases what comes back; it never reads a
 * collection, never does arithmetic, and cannot ask a question that is not on
 * this list. That is the whole of "never guess": there is no path from a
 * question to an answer that does not pass through one of these.
 *
 * Every tool reuses the code the pages already run — the booking maths is
 * the quote page's, availability is the Book Unit page's, the report figures
 * are the report engine's — so the assistant cannot disagree with the screen.
 */

const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const money = (n) => (n == null ? null : Number(Number(n).toFixed(2)));
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Site scoping, when a facility is selected. Units carry `site`; contracts
 *  are scoped through the report blocks' own filters. */
function siteOf(scope) {
   return scope?.unitFilter?.site ? String(scope.unitFilter.site) : null;
}

const tools = [];

function tool(def) {
   tools.push(def);
   return def;
}

/* ── units and pricing ────────────────────────────────────────────────────── */

tool({
   name: 'units_available',
   description: 'Which units are free, optionally of a size (sq ft), on a floor, or for a date range. Returns the count and each unit with its monthly list price. Use for "how many 10 sq ft units are left", "what is free on floor 2", "anything available from the 10th to the 20th".',
   parameters: {
      type: 'object',
      properties: {
         sizeSqf: { type: 'number', description: 'Unit size in square feet, e.g. 10, 25, 50, 100' },
         floor: { type: 'string', description: 'Floor label as the company uses it' },
         from: { type: 'string', description: 'Start date YYYY-MM-DD, when asking about a period' },
         to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
   },
   async run({ sizeSqf, floor, from, to }, { scope }) {
      const period = from && to ? { from: new Date(from), to: new Date(to) } : {};
      const { allUnits, bookedUnitIds } = await computeUnitAvailability(period);
      const site = siteOf(scope);
      let units = allUnits.filter((u) => !bookedUnitIds.has(String(u._id)));
      if (site) units = units.filter((u) => String(u.site) === site);
      if (sizeSqf) units = units.filter((u) => Number(u.sizeSqf) === Number(sizeSqf));
      if (floor) units = units.filter((u) => String(u.floor).toLowerCase() === String(floor).toLowerCase());

      const bySize = {};
      for (const u of units) bySize[u.sizeSqf] = (bySize[u.sizeSqf] || 0) + 1;

      return {
         count: units.length,
         period: from && to ? { from, to } : 'right now',
         bySize,
         units: units.slice(0, 40).map((u) => ({
            unitNumber: u.unitNumber, floor: u.floor, sizeSqf: u.sizeSqf, monthlyPrice: money(u.price), status: u.status,
         })),
         truncated: units.length > 40,
      };
   },
});

tool({
   name: 'price_booking',
   description: 'What to charge for a unit between two dates, using the company\'s own quote maths (weekly rate = monthly ÷ 4, whole weeks rounded up, any discount applies to the first 4 weeks only, 4 weeks refundable advance, VAT). Give either a unit number or a size; with a size it prices the cheapest free unit of that size.',
   parameters: {
      type: 'object',
      properties: {
         unitNumber: { type: 'string', description: 'A specific unit, e.g. F2-64' },
         sizeSqf: { type: 'number', description: 'Or a size in sq ft' },
         startDate: { type: 'string', description: 'YYYY-MM-DD' },
         endDate: { type: 'string', description: 'YYYY-MM-DD' },
         discountPct: { type: 'number', description: 'Discount percent on the first 4 weeks, default 0' },
      },
      required: ['startDate', 'endDate'],
   },
   async run({ unitNumber, sizeSqf, startDate, endDate, discountPct = 0 }, { scope }) {
      if (!unitNumber && !sizeSqf) return { error: 'Need a unit number or a size' };
      if (new Date(endDate) <= new Date(startDate)) return { error: 'End date must be after the start date' };

      let unit = null;
      if (unitNumber) {
         unit = await Unit.findOne({ unitNumber: new RegExp(`^${String(unitNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
         if (!unit) return { error: `No unit called ${unitNumber}` };
      } else {
         const { allUnits, bookedUnitIds } = await computeUnitAvailability({ from: new Date(startDate), to: new Date(endDate) });
         const site = siteOf(scope);
         const free = allUnits
            .filter((u) => !bookedUnitIds.has(String(u._id)) && Number(u.sizeSqf) === Number(sizeSqf) && u.price > 0)
            .filter((u) => !site || String(u.site) === site)
            .sort((a, b) => a.price - b.price);
         if (!free.length) return { error: `No free ${sizeSqf} sq ft unit for those dates` };
         unit = free[0];
      }
      if (!(unit.price > 0)) return { error: `${unit.unitNumber} has no price set` };

      const quote = {
         units: [{ unitNumber: unit.unitNumber, sizeSqf: unit.sizeSqf, floor: unit.floor, rate: unit.price, discountPct, startDate, endDate }],
         addOns: [], items: [], deposit: 0, holdAdvance: true, vatEnabled: true, vatRate: 5, adjustment: 0,
      };
      const rows = quoteLines(quote);
      const totals = quoteTotals(quote, rows);
      const weeks = termWeeks(quote.units[0]);
      const rent = rows.find((r) => /rent/i.test(r.title) || r.taxable) || rows[0];

      return {
         unit: { unitNumber: unit.unitNumber, floor: unit.floor, sizeSqf: unit.sizeSqf, monthlyPrice: money(unit.price) },
         period: { startDate, endDate, weeks },
         weeklyRate: money(unit.price / 4),
         discountPct,
         lines: rows.map((r) => ({ title: r.title, qty: r.qty, rate: money(r.rate), amount: money(r.amount), taxable: r.taxable })),
         rent: money(rent?.amount),
         subTotal: money(totals.subTotal),
         vatRate: totals.vatRate,
         vatAmount: money(totals.vatAmount),
         total: money(totals.total),
         note: 'Security deposit and add-ons not included. The refundable advance is returned at move-out.',
      };
   },
});

/* ── people, contracts, documents, tasks ──────────────────────────────────── */

tool({
   name: 'find_customer',
   description: 'Look up a customer or lead by name or phone number. Returns their contact details, their contracts (with status and dates), and whether they are a lead or a tenant.',
   parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a name, or a phone number' } },
      required: ['query'],
   },
   async run({ query }) {
      const q = String(query || '').trim();
      const digits = q.replace(/\D/g, '');
      const byPhone = digits.length >= 7;
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      const customers = await Customer.find(byPhone
         ? { $or: [{ phone: new RegExp(`${suffix(digits)}$`) }, { phones: new RegExp(`${suffix(digits)}$`) }] }
         : { fullName: rx }).limit(5).lean();
      const leads = await Lead.find(byPhone
         ? { phoneNormalized: new RegExp(`${suffix(digits)}$`) }
         : { fullName: rx }).populate('owner', 'name').limit(5).lean();

      const out = [];
      for (const c of customers) {
         const contracts = await Contract.find({ customer: c._id }).select('contractNo status startDate endDate rate leasedPrice unit').populate('unit', 'unitNumber sizeSqf').sort({ endDate: -1 }).lean();
         out.push({
            kind: 'customer', name: c.fullName, phone: c.phone, phones: c.phones, email: c.email,
            contracts: contracts.map((k) => ({ contractNo: k.contractNo, status: k.status, unit: k.unit?.unitNumber, sizeSqf: k.unit?.sizeSqf, start: iso(k.startDate), end: iso(k.endDate), monthly: money(k.leasedPrice || k.rate) })),
         });
      }
      for (const l of leads) {
         out.push({ kind: 'lead', name: l.fullName, phone: l.phone, email: l.email, status: l.status, owner: l.owner?.name || null, since: iso(l.leadDateTime), storageSizeSqf: l.storageSizeValue || null });
      }
      return { matches: out.length, people: out };
   },
});

tool({
   name: 'find_contract',
   description: 'Look up contracts by contract number or tenant name. Returns unit, dates, monthly rate and status.',
   parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Contract number like PB-2026-0301, or part of the tenant\'s name' } },
      required: ['query'],
   },
   async run({ query }, { scope }) {
      const q = String(query || '').trim();
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      let filter = { contractNo: rx };
      if (!/^pb-?\d/i.test(q)) {
         const customers = await Customer.find({ fullName: rx }).select('_id').limit(20).lean();
         filter = { customer: { $in: customers.map((c) => c._id) } };
      }
      const contracts = await Contract.find({ ...(scope?.contractFilter || {}), ...filter })
         .populate('customer', 'fullName phone').populate('unit', 'unitNumber sizeSqf floor')
         .sort({ endDate: -1 }).limit(20).lean();
      return {
         matches: contracts.length,
         contracts: contracts.map((k) => ({
            contractNo: k.contractNo, tenant: k.customer?.fullName, phone: k.customer?.phone, status: k.status,
            unit: k.unit?.unitNumber, sizeSqf: k.unit?.sizeSqf, floor: k.unit?.floor,
            start: iso(k.startDate), end: iso(k.endDate), monthly: money(k.leasedPrice || k.rate),
         })),
      };
   },
});

tool({
   name: 'documents_for',
   description: 'The documents on file for a customer or contract — contracts, Emirates ID, passport, visa, trade licence. Search by customer name or contract number.',
   parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
   },
   async run({ query }) {
      const q = String(query || '').trim();
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const [customers, contracts] = await Promise.all([
         Customer.find({ fullName: rx }).select('_id').limit(20).lean(),
         Contract.find({ contractNo: rx }).select('_id').limit(20).lean(),
      ]);
      const docs = await Document.find({ $or: [
         { customer: { $in: customers.map((c) => c._id) } },
         { contract: { $in: contracts.map((c) => c._id) } },
      ] }).populate('customer', 'fullName').populate('contract', 'contractNo').sort({ createdAt: -1 }).limit(50).lean();
      return {
         count: docs.length,
         documents: docs.map((d) => ({ name: d.name, type: d.type, customer: d.customer?.fullName, contract: d.contract?.contractNo, storage: d.storage, uploaded: iso(d.createdAt) })),
      };
   },
});

tool({
   name: 'tasks_due',
   description: 'Tasks on the board: due today, overdue, or this week. Optionally only the asking user\'s own.',
   parameters: {
      type: 'object',
      properties: {
         when: { type: 'string', enum: ['today', 'overdue', 'week', 'all_open'] },
         mine: { type: 'boolean', description: 'Only tasks assigned to the person asking' },
      },
      required: ['when'],
   },
   async run({ when, mine = false }, { user, now }) {
      const { from: dayStart, to: dayEnd } = dayRange(dayKeyFor(now));
      const filter = { status: { $ne: 'done' } };
      if (when === 'today') filter.dueDate = { $gte: dayStart, $lte: dayEnd };
      if (when === 'overdue') filter.dueDate = { $lt: dayStart };
      if (when === 'week') filter.dueDate = { $gte: dayStart, $lte: new Date(dayStart.getTime() + 7 * 864e5) };
      if (mine && user?.id) filter.assignedTo = user.id;
      const tasks = await Task.find(filter).populate('assignedTo', 'name').sort({ dueDate: 1 }).limit(50).lean();
      return {
         count: tasks.length,
         tasks: tasks.map((t) => ({ taskNo: t.taskNo, title: t.title, assignedTo: t.assignedTo?.name, due: iso(t.dueDate), priority: t.priority, status: t.status, about: t.leadName || null })),
      };
   },
});

/* ── WhatsApp and leads ───────────────────────────────────────────────────── */

tool({
   name: 'whatsapp_activity',
   description: 'WhatsApp for a day: how many people messaged us, how many were new, how many messages in and out, and who is still waiting for a reply. Day is "today", "yesterday" or YYYY-MM-DD (Dubai time).',
   parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: '"today", "yesterday" or YYYY-MM-DD' } },
      required: ['day'],
   },
   async run({ day }, { now }) {
      const key = day === 'yesterday' ? previousDay(dayKeyFor(now)) : day === 'today' ? dayKeyFor(now) : String(day);
      const { from, to } = dayRange(key);
      const msgs = await WhatsAppMessage.find({ occurredAt: { $gte: from, $lte: to }, deletedAt: null })
         .select('phoneNormalized direction occurredAt text').lean();

      const inbound = msgs.filter((m) => m.direction === 'inbound');
      const senders = [...new Set(inbound.map((m) => m.phoneNormalized))];

      // New = never wrote to us before that day.
      const earlier = await WhatsAppMessage.distinct('phoneNormalized', { phoneNormalized: { $in: senders }, direction: 'inbound', occurredAt: { $lt: from } });
      const newSenders = senders.filter((p) => !earlier.includes(p));

      // Waiting = their last message that day has had nothing back since.
      const lastByPhone = new Map();
      for (const m of msgs) {
         const held = lastByPhone.get(m.phoneNormalized);
         if (!held || m.occurredAt > held.occurredAt) lastByPhone.set(m.phoneNormalized, m);
      }
      const latestOut = await WhatsAppMessage.aggregate([
         { $match: { phoneNormalized: { $in: senders }, direction: 'outbound' } },
         { $group: { _id: '$phoneNormalized', at: { $max: '$occurredAt' } } },
      ]);
      const outAt = new Map(latestOut.map((r) => [r._id, r.at]));
      const waiting = senders.filter((p) => {
         const lastIn = inbound.filter((m) => m.phoneNormalized === p).sort((a, b) => b.occurredAt - a.occurredAt)[0];
         const o = outAt.get(p);
         return lastIn && (!o || o < lastIn.occurredAt);
      });

      const nameOf = await resolveNames(senders);
      const named = (p) => ({ phone: p, name: nameOf(p)?.displayName || `+${p}` });

      return {
         day: key,
         peopleWhoMessaged: senders.length,
         newPeople: newSenders.length,
         messagesIn: inbound.length,
         messagesOut: msgs.length - inbound.length,
         stillWaitingForReply: waiting.length,
         people: senders.slice(0, 40).map(named),
         waiting: waiting.slice(0, 40).map(named),
      };
   },
});

tool({
   name: 'leads_recent',
   description: 'Leads created in a date range, with a count by status and by source, and the newest ones. Use for "how many leads today / this week / this month".',
   parameters: {
      type: 'object',
      properties: {
         from: { type: 'string', description: 'YYYY-MM-DD' },
         to: { type: 'string', description: 'YYYY-MM-DD' },
         status: { type: 'string', description: 'Optional status filter: new, contact_attempted, contacted, site_visit_scheduled, follow_up_scheduled, quotation_sent, won, lost' },
      },
      required: ['from', 'to'],
   },
   async run({ from, to, status }) {
      const { from: f } = dayRange(from);
      const { to: t } = dayRange(to);
      const filter = { leadDateTime: { $gte: f, $lte: t } };
      if (status) filter.status = status;
      const leads = await Lead.find(filter).populate('owner', 'name').sort({ leadDateTime: -1 }).lean();
      const byStatus = {};
      const bySource = {};
      const byOwner = {};
      for (const l of leads) {
         byStatus[l.status] = (byStatus[l.status] || 0) + 1;
         bySource[l.source || 'unknown'] = (bySource[l.source || 'unknown'] || 0) + 1;
         const o = l.owner?.name || 'unassigned';
         byOwner[o] = (byOwner[o] || 0) + 1;
      }
      return {
         from, to, count: leads.length, byStatus, bySource, byOwner,
         newest: leads.slice(0, 25).map((l) => ({ name: l.fullName, status: l.status, owner: l.owner?.name || null, at: l.leadDateTime, sizeSqf: l.storageSizeValue || null })),
      };
   },
});

/* ── every report block, as a tool ────────────────────────────────────────── */

/* The report engine's figures — occupancy, expiring contracts, revenue,
 * outstanding money, lead funnel, rep performance — exposed as they are. They
 * are the numbers the reports page shows, so the assistant cannot say
 * something different from the screen. */
const PARAM_TYPES = { 'number?': 'number', 'date?': 'string', number: 'number', date: 'string', 'string?': 'string', string: 'string' };

for (const b of blockCatalogue()) {
   const properties = {};
   for (const [k, t] of Object.entries(b.params || {})) {
      properties[k] = { type: PARAM_TYPES[t] || 'string', description: /date/.test(t) ? 'YYYY-MM-DD' : t };
   }
   tool({
      name: `report_${b.name}`,
      description: `${b.summary}. Same figures as the reports page.`,
      parameters: { type: 'object', properties },
      async run(args, { scope }) {
         const out = await BLOCKS[b.name].run(args || {}, scope);
         if (Array.isArray(out?.rows) && out.rows.length > 60) {
            return { ...out, rows: out.rows.slice(0, 60), rowsTotal: out.rows.length, truncated: true };
         }
         return out;
      },
   });
}

/* ── the catalogue, in the shape OpenAI wants ─────────────────────────────── */

/** For the action module, which proposes rather than answers. */
export function registerTool(def) {
   return tool(def);
}

export function toolDefinitions() {
   return tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
   }));
}

export function toolByName(name) {
   return tools.find((t) => t.name === name) || null;
}

export function toolNames() {
   return tools.map((t) => t.name);
}
