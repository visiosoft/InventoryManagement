import { Unit, Contract, Customer, Lead, Task, Document, WhatsAppMessage, CallLog } from '../../models/index.js';
import { DATASETS, buildDataset, exportPath } from './datasets.js';
import { BLOCKS, blockCatalogue } from '../reportBlocks.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { quoteLines, quoteTotals, termWeeks } from '../quoteLines.js';
import { dayKeyFor, dayRange, previousDay } from '../dailyDigest.js';
import { resolveNames } from '../inboxAsk.js';
import { claudeConfigured, claudeWebSearch } from '../claude.js';

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

/** A page in the app for a thing a tool returned. The widget shows these as
 *  buttons under the answer, so "which contract?" is one click, not a search. */
const link = (label, path) => ({ label, path });
const chatLink = (name, phoneNormalized) => link(`Chat with ${name}`, `/whatsapp?phone=${phoneNormalized}`);

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
         links: [link('Search units', '/units')],
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
         links: [link(`Book ${unit.unitNumber}`, `/quotes/new?unit=${encodeURIComponent(unit.unitNumber)}`)],
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
      const links = [];
      for (const c of customers) {
         const contracts = await Contract.find({ customer: c._id }).select('contractNo status startDate endDate rate leasedPrice unit').populate('unit', 'unitNumber sizeSqf').sort({ endDate: -1 }).lean();
         out.push({
            kind: 'customer', name: c.fullName, phone: c.phone, phones: c.phones, email: c.email,
            contracts: contracts.map((k) => ({ contractNo: k.contractNo, status: k.status, unit: k.unit?.unitNumber, sizeSqf: k.unit?.sizeSqf, start: iso(k.startDate), end: iso(k.endDate), monthly: money(k.leasedPrice || k.rate) })),
         });
         links.push(link(`${c.fullName} (tenant)`, `/customers/${c._id}`));
         const digits = String(c.phone || c.phones?.[0] || '').replace(/\D/g, '');
         if (digits) links.push(chatLink(c.fullName, digits));
         for (const k of contracts.slice(0, 3)) links.push(link(`Contract ${k.contractNo}`, `/contracts/${k._id}`));
      }
      for (const l of leads) {
         out.push({ kind: 'lead', name: l.fullName, phone: l.phone, email: l.email, status: l.status, owner: l.owner?.name || null, since: iso(l.leadDateTime), storageSizeSqf: l.storageSizeValue || null });
         links.push(link(`${l.fullName} (lead)`, `/leads/${l._id}`));
         if (l.phoneNormalized) links.push(chatLink(l.fullName, l.phoneNormalized));
      }
      return { matches: out.length, people: out, links };
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
         links: contracts.slice(0, 5).map((k) => link(`Contract ${k.contractNo} — ${k.customer?.fullName || ''}`.trim(), `/contracts/${k._id}`)),
      };
   },
});

/**
 * Who is coming up for renewal — and, separately, the audience the email
 * composer will open with.
 *
 * These are two tools rather than one because they answer to different people:
 * the first is a question, the second is a handoff to a screen. Splitting them
 * also means the model never has to carry a list of customer ids between turns,
 * which matters — a 24-character ObjectId is exactly the kind of thing a model
 * will helpfully "correct" into an id belonging to somebody else.
 */
const expiringWindow = (days) => {
   const n = Math.max(1, Math.min(365, Number(days) || 30));
   const from = new Date();
   const to = new Date(Date.now() + n * 86400000);
   return { n, from, to };
};

/** Same filter the contracts_expiring report block uses, so the assistant and
 *  the report cannot give different answers to the same question. */
async function expiringContracts(days, scope) {
   const { n, from, to } = expiringWindow(days);
   const rows = await Contract.find({
      ...(scope?.contractFilter || {}), status: 'active', endDate: { $gte: from, $lt: to },
   }).populate('customer', 'fullName email phone').populate('unit', 'unitNumber').sort({ endDate: 1 }).limit(500).lean();
   return { days: n, rows };
}

tool({
   name: 'contracts_expiring',
   description: 'Tenants whose contracts expire within the next N days: name, unit, end date, days left, and whether we hold an email address. Use for "whose contract is expiring", "who is up for renewal".',
   parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many days ahead to look. Defaults to 30.' } },
   },
   async run({ days }, { scope }) {
      const { days: n, rows } = await expiringContracts(days, scope);
      const today = new Date().setHours(0, 0, 0, 0);
      return {
         days: n,
         count: rows.length,
         /* Said explicitly because it decides whether emailing them is even
            possible, and the model would otherwise have to infer it from a
            missing field — which it reports as "no data" rather than "we have
            no address for four of them". */
         withEmail: rows.filter((r) => r.customer?.email).length,
         withoutEmail: rows.filter((r) => !r.customer?.email).length,
         contracts: rows.slice(0, 60).map((k) => ({
            contractNo: k.contractNo,
            tenant: k.customer?.fullName,
            email: k.customer?.email || null,
            unit: k.unit?.unitNumber,
            end: iso(k.endDate),
            daysLeft: Math.round((new Date(k.endDate).setHours(0, 0, 0, 0) - today) / 86400000),
            renewalIntent: k.renewalIntent || 'undecided',
         })),
         links: [link('Tenants', '/contracts')],
      };
   },
});

tool({
   name: 'compose_email',
   description: 'Open the email composer with a group already selected and a template chosen — for example everyone whose contract expires in 10 days. This SENDS NOTHING: it opens the composer so the user can review and press send themselves. Use whenever asked to email, message or contact a group of tenants by email.',
   parameters: {
      type: 'object',
      properties: {
         audience: {
            type: 'string',
            enum: ['expiring_contracts', 'active_tenants'],
            description: 'expiring_contracts for tenants coming up for renewal; active_tenants for everyone currently renting.',
         },
         days: { type: 'number', description: 'For expiring_contracts: how many days ahead. Defaults to 30.' },
         template: {
            type: 'string',
            description: 'Key of the email template to preselect, e.g. contract_expiring. Omit to let the user choose.',
         },
      },
      required: ['audience'],
   },
   async run({ audience, days, template }, { scope }) {
      /* The server works out who, from the audience the model named. The model
         never passes ids: it says "the people expiring in 10 days" and this
         re-runs that query, so the composer cannot open with somebody the
         question never covered. */
      let rows = [];
      let label = '';
      let window = null;
      if (audience === 'active_tenants') {
         rows = await Contract.find({ ...(scope?.contractFilter || {}), status: 'active' })
            .populate('customer', 'fullName email').limit(2000).lean();
         label = 'active tenants';
      } else {
         const out = await expiringContracts(days, scope);
         rows = out.rows;
         window = out.days;
         label = `tenants whose contract expires within ${out.days} days`;
      }

      // One entry per person: a tenant with two units must not be emailed twice.
      const byCustomer = new Map();
      for (const r of rows) {
         const c = r.customer;
         if (!c?._id) continue;
         if (!byCustomer.has(String(c._id))) byCustomer.set(String(c._id), c);
      }
      const people = [...byCustomer.values()];
      const mailable = people.filter((c) => c.email);

      return {
         audience, label, days: window,
         people: people.length,
         withEmail: mailable.length,
         withoutEmail: people.length - mailable.length,
         // Named so it is obvious in the answer who will silently be left out.
         noEmail: people.filter((c) => !c.email).map((c) => c.fullName).slice(0, 10),
         /* Lifted out of the tool result by the assistant service and handed to
            the widget, which opens the composer. Ids only travel server → UI,
            never through the model. */
         compose: {
            kind: 'email_customers',
            label,
            customerIds: mailable.map((c) => String(c._id)),
            template: template ? String(template) : '',
            // These templates are full of @contractNo and @endDate, which only
            // resolve when each person gets their own copy.
            personalise: true,
         },
      };
   },
});

/**
 * The WhatsApp equivalent of compose_email — with one real difference the
 * description says plainly, because it changes what this can and cannot do.
 *
 * WhatsApp has no bulk broadcast: every message is sent to one number, and
 * outside the 24-hour reply window it must be an approved template — there is
 * no "compose a body" step for the model to help with, only which template
 * and who. And it is scoped to CONTRACTS, not customers, because the
 * placeholders (@endDate, @renewLink, a specific unit) belong to one contract
 * — a tenant with two units gets two messages, one per contract, not one
 * message that cannot say which unit it means.
 */
tool({
   name: 'compose_whatsapp',
   description: 'Open the WhatsApp composer with a group already selected and a template chosen — for example everyone whose contract expires in 3 days. This SENDS NOTHING: it opens the composer so the user can review and press send themselves. WhatsApp has no bulk/broadcast send — this queues one templated message per contract, each personalised, which is the only way WhatsApp allows it. Use whenever asked to WhatsApp, message on WhatsApp, or contact a group of tenants by WhatsApp — do not say this is unsupported.',
   parameters: {
      type: 'object',
      properties: {
         audience: {
            type: 'string',
            enum: ['expiring_contracts'],
            description: 'expiring_contracts for tenants coming up for renewal.',
         },
         days: { type: 'number', description: 'How many days ahead to look. Defaults to 30.' },
         template: {
            type: 'string',
            description: 'Key of the message template to preselect, e.g. contract_expiring. Omit to let the user choose.',
         },
      },
      required: ['audience'],
   },
   async run({ days, template }, { scope }) {
      const { days: n, rows } = await expiringContracts(days, scope);
      const withPhone = rows.filter((r) => r.customer?.phone);
      const noPhone = rows.filter((r) => !r.customer?.phone);
      const label = `tenants whose contract expires within ${n} days`;

      return {
         audience: 'expiring_contracts', label, days: n,
         contracts: rows.length,
         withPhone: withPhone.length,
         withoutPhone: noPhone.length,
         // Named so it is obvious in the answer who will silently be left out.
         noPhone: noPhone.map((r) => r.customer?.fullName).filter(Boolean).slice(0, 10),
         /* Lifted out of the tool result by the assistant service and handed to
            the widget, which opens the composer. Ids only travel server → UI,
            never through the model — the same rule compose_email follows and
            for the same reason. */
         compose: {
            kind: 'whatsapp_contracts',
            label,
            template: template ? String(template) : '',
            contracts: withPhone.map((r) => ({
               contractId: String(r._id),
               contractNo: r.contractNo,
               customerName: r.customer?.fullName || '',
               phone: r.customer?.phone,
               unit: r.unit?.unitNumber || '',
               endDate: iso(r.endDate),
            })),
         },
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
         links: [link('Documents', '/documents')],
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
         links: [link('Task board', '/tasks')],
      };
   },
});

/* ── WhatsApp and leads ───────────────────────────────────────────────────── */

tool({
   name: 'whatsapp_activity',
   description: 'WhatsApp activity in a period: who messaged us, how many were new, messages in and out, and who is still waiting for a reply. Give EITHER a day ("today", "yesterday", YYYY-MM-DD) OR sinceMinutes for "the last 5 minutes" / "last 2 hours" (120) / "last 3 days" (4320). Dubai time.',
   parameters: {
      type: 'object',
      properties: {
         day: { type: 'string', description: '"today", "yesterday" or YYYY-MM-DD' },
         sinceMinutes: { type: 'number', description: 'Look back this many minutes from now, e.g. 5, 60, 1440' },
      },
   },
   async run({ day, sinceMinutes }, { now }) {
      let from;
      let to;
      let key;
      if (sinceMinutes) {
         to = new Date(now);
         from = new Date(to.getTime() - Number(sinceMinutes) * 60_000);
         key = `last ${Number(sinceMinutes)} minutes`;
      } else {
         key = day === 'yesterday' ? previousDay(dayKeyFor(now)) : (!day || day === 'today') ? dayKeyFor(now) : String(day);
         ({ from, to } = dayRange(key));
      }
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
         period: key,
         from: from.toISOString(),
         to: to.toISOString(),
         peopleWhoMessaged: senders.length,
         newPeople: newSenders.length,
         messagesIn: inbound.length,
         messagesOut: msgs.length - inbound.length,
         stillWaitingForReply: waiting.length,
         people: senders.slice(0, 40).map(named),
         waiting: waiting.slice(0, 40).map(named),
         links: [
            link('Open the WhatsApp inbox', '/whatsapp'),
            ...waiting.slice(0, 5).map((p) => chatLink(named(p).name, p)),
         ],
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
         links: [link('Leads', '/leads'), ...leads.slice(0, 4).map((l) => link(l.fullName, `/leads/${l._id}`))],
      };
   },
});

tool({
   name: 'whatsapp_messages',
   description: 'The actual WhatsApp messages — what people wrote and what we replied — in a period (sinceMinutes) or for one person (phone or name). Use when asked what the messages say, what someone asked, or to read a conversation. Returns the text of each message, newest first.',
   parameters: {
      type: 'object',
      properties: {
         sinceMinutes: { type: 'number', description: 'Look back this many minutes, e.g. 60, 360, 1440' },
         phone: { type: 'string', description: 'Or one person\'s phone number' },
         name: { type: 'string', description: 'Or one person\'s name' },
         limit: { type: 'number', description: 'Max messages, default 30' },
      },
   },
   async run({ sinceMinutes, phone, name, limit = 30 }, { now }) {
      const filter = { deletedAt: null, text: { $ne: '' } };
      let who = '';
      if (phone && suffix(phone).length >= 7) {
         filter.phoneNormalized = new RegExp(`${suffix(phone)}$`);
      } else if (name) {
         const rx = new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
         const [c, l] = await Promise.all([Customer.findOne({ fullName: rx }).lean(), Lead.findOne({ fullName: rx }).lean()]);
         const digits = c?.phone || c?.phones?.[0] || l?.phoneNormalized || '';
         if (!digits) return { error: `No customer or lead called ${name}` };
         filter.phoneNormalized = new RegExp(`${suffix(digits)}$`);
         who = c?.fullName || l?.fullName || '';
      }
      if (sinceMinutes) filter.occurredAt = { $gte: new Date(new Date(now).getTime() - Number(sinceMinutes) * 60_000) };
      if (!filter.phoneNormalized && !sinceMinutes) filter.occurredAt = { $gte: new Date(new Date(now).getTime() - 24 * 3600_000) };

      const msgs = await WhatsAppMessage.find(filter).sort({ occurredAt: -1 }).limit(Math.min(80, Number(limit) || 30)).lean();
      const phones = [...new Set(msgs.map((m) => m.phoneNormalized))];
      const nameOf = await resolveNames(phones);
      const label = (p) => nameOf(p)?.displayName || `+${p}`;

      return {
         count: msgs.length,
         person: who || null,
         messages: msgs.map((m) => ({
            at: m.occurredAt, from: m.direction === 'inbound' ? label(m.phoneNormalized) : 'us',
            to: m.direction === 'inbound' ? 'us' : label(m.phoneNormalized),
            direction: m.direction, type: m.type, text: String(m.text || '').slice(0, 400),
         })),
         links: phones.slice(0, 5).map((p) => chatLink(label(p), p)),
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
         const page = /^contracts_/.test(b.name) ? link('Tenants', '/contracts')
            : /^(occupancy|units_|unit_)/.test(b.name) ? link('Search units', '/units')
            : /^leads_/.test(b.name) ? link('Leads', '/leads')
            : /^rep_/.test(b.name) ? link('Leaderboard', '/leaderboard')
            : link('Ask for a report', '/reports/ask');
         if (Array.isArray(out?.rows) && out.rows.length > 60) {
            return { ...out, rows: out.rows.slice(0, 60), rowsTotal: out.rows.length, truncated: true, links: [page] };
         }
         return { ...out, links: [page] };
      },
   });
}

/* ── the catalogue, in the shape OpenAI wants ─────────────────────────────── */

/** For the action module, which proposes rather than answers. */
export function registerTool(def) {
   return tool(def);
}

/* ── files, and the parts of the system added since ─────────────────────── */

const ADMIN_ROLES = ['admin', 'accounts_admin'];
const FINANCE_ROLES = ['admin', 'accounts_admin', 'accounts'];

tool({
   name: 'export_file',
   description: 'Make a PDF or Excel file of a list and offer it to download: leads (a date range, optionally a status, source or owner), contracts_expiring (next N days), tasks (today, overdue, week or all_open; mine), units_available (optionally a size), calls (last N days). Use whenever someone asks for a PDF, Excel, spreadsheet, file, export, download or printout of any of these.',
   parameters: {
      type: 'object',
      properties: {
         dataset: { type: 'string', enum: DATASETS },
         format: { type: 'string', enum: ['pdf', 'excel'], description: 'pdf to print or send, excel to sort and total. Default pdf.' },
         from: { type: 'string', description: 'leads: first day YYYY-MM-DD' },
         to: { type: 'string', description: 'leads: last day YYYY-MM-DD' },
         status: { type: 'string', description: 'leads: optional status' },
         source: { type: 'string', description: 'leads: optional source, e.g. whatsapp, website, meta' },
         owner: { type: 'string', description: 'leads: optional owner name' },
         days: { type: 'number', description: 'contracts_expiring or calls: how many days' },
         when: { type: 'string', enum: ['today', 'overdue', 'week', 'all_open'], description: 'tasks: which' },
         mine: { type: 'boolean', description: 'tasks: only the asker\'s' },
         sizeSqf: { type: 'number', description: 'units_available: one size' },
      },
      required: ['dataset'],
   },
   async run({ dataset, format = 'pdf', ...args }, ctx) {
      const fmt = format === 'excel' ? 'excel' : 'pdf';
      const keep = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const table = await buildDataset(dataset, keep, ctx);
      return {
         dataset, format: fmt, rows: table.rows.length, title: table.title, subtitle: table.subtitle,
         file: { label: `${table.title} (${fmt === 'pdf' ? 'PDF' : 'Excel'})`, path: exportPath(dataset, fmt, keep), format: fmt },
         note: 'The file is attached under the answer as a download button.',
      };
   },
});

const FIELD_TYPES = ['text', 'phone', 'email', 'number', 'date', 'select', 'textarea'];

/** The form the model asked for, made safe to draw: known field types, short labels, at most 10 fields. */
export function cleanForm({ intro, title, fields, submitLabel } = {}) {
   const str = (v, n) => (v === undefined || v === null ? '' : String(v).trim().slice(0, n));
   const seen = new Set();
   const out = (Array.isArray(fields) ? fields : []).map((f) => {
      const key = str(f?.key, 40).replace(/[^a-zA-Z0-9_]/g, '_');
      const label = str(f?.label, 60);
      if (!key || !label || seen.has(key)) return null;
      seen.add(key);
      const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text';
      const options = type === 'select' ? (Array.isArray(f?.options) ? f.options : []).map((o) => str(o, 40)).filter(Boolean).slice(0, 12) : undefined;
      return { key, label, type: type === 'select' && !options?.length ? 'text' : type, ...(options?.length ? { options } : {}), value: str(f?.value, 300), required: f?.required !== false };
   }).filter(Boolean).slice(0, 10);
   if (!out.length) return null;
   return { intro: str(intro, 200) || 'A few details:', title: str(title, 60), fields: out, submitLabel: str(submitLabel, 30) || 'Continue' };
}

tool({
   name: 'ask_details',
   description: 'Show the person a short form to fill in, instead of asking for several details in text. Use it whenever a booking, quotation, contract, invoice or new lead still needs details. Look up what you can first, then put every value you already know (from the conversation or a tool: the customer\'s name and phone, the size they asked for, today\'s date as the start) in `value`, so they only fill the gaps and check the rest. For a size, a sending method or anything with set answers use type select with the options (offer only sizes that are free). After calling it, stop: their answers come back as the next message.',
   parameters: {
      type: 'object',
      properties: {
         intro: { type: 'string', description: 'One short line above the form, e.g. "A few details for the quotation:"' },
         title: { type: 'string', description: 'What the form is for, e.g. "Quotation"' },
         fields: {
            type: 'array',
            items: {
               type: 'object',
               properties: {
                  key: { type: 'string', description: 'Short id, e.g. customerName, phone, sizeSqf, startDate, months, discount, sendBy' },
                  label: { type: 'string', description: 'What the person sees, e.g. "Customer name"' },
                  type: { type: 'string', enum: FIELD_TYPES },
                  options: { type: 'array', items: { type: 'string' }, description: 'select only: the answers to choose from' },
                  value: { type: 'string', description: 'What you already know for this field, or empty. Dates YYYY-MM-DD.' },
                  required: { type: 'boolean', description: 'false for optional fields such as a discount or a note' },
               },
               required: ['key', 'label', 'type'],
            },
         },
         submitLabel: { type: 'string', description: 'The button, e.g. "Prepare quotation"' },
      },
      required: ['intro', 'fields'],
   },
   async run(args) {
      const form = cleanForm(args);
      if (!form) return { error: 'A form needs at least one field with a key and a label' };
      return { form, note: 'The form is on screen. Stop here; the answers come back as the next message.' };
   },
});

tool({
   name: 'web_search',
   description: 'Search the internet — competitors\' prices and offers, market news, a company or address, anything outside this system. Only offered when the person has switched the web on. Give one clear question; call it again for a different question. To compare companies, first search for the list, then call it once per company ("<company> Dubai storage prices 50 sq ft") so each one\'s own price page is read. Say where each fact came from.',
   parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The question, e.g. "self storage prices per month in Al Quoz Dubai 2026"' } },
      required: ['query'],
   },
   async run({ query }, ctx = {}) {
      if (!ctx.web) return { error: 'The web is switched off for this question' };
      if (!claudeConfigured()) return { error: 'Web search needs the Claude key set in Settings' };
      const out = await (ctx.webSearch || claudeWebSearch)(query);
      if (out.error) return out;
      return { ...out, links: [], web: (out.sources || []).map((s) => ({ label: s.title, url: s.url })) };
   },
});

tool({
   name: 'past_checkout',
   description: 'Contracts still active although their check-out date has passed: tenant, unit, check-out date, days over, phone. Each one is either a tenant who left (end the contract to free the unit) or one who stayed (extend and invoice). Use for "who is past check-out", "overdue move-outs", "units we cannot rent because a contract was never closed".',
   parameters: { type: 'object', properties: {} },
   async run(_args, { scope, now = new Date() }) {
      const today = new Date(new Date(now).setHours(0, 0, 0, 0));
      const rows = await Contract.find({ ...(scope?.contractFilter || {}), status: 'active', endDate: { $lt: today } })
         .populate('customer', 'fullName phone').populate('unit', 'unitNumber').sort({ endDate: 1 }).limit(200).lean();
      return {
         count: rows.length,
         contracts: rows.map((k) => ({
            contractNo: k.contractNo, tenant: k.customer?.fullName || '', phone: k.customer?.phone || '', unit: k.unit?.unitNumber || '',
            checkOut: iso(k.endDate), daysOver: Math.round((today - new Date(k.endDate).setHours(0, 0, 0, 0)) / 86400000),
         })),
         links: [link('Search units', '/units'), ...rows.slice(0, 4).map((k) => link(k.contractNo || 'Contract', `/contracts/${k._id}`))],
      };
   },
});

tool({
   name: 'conversion_review',
   description: 'Why leads do or do not become customers, over the last N days (default 30): leads and how many were won, by source; where the open ones are stuck by stage; why lost ones were lost (as recorded); how fast we first replied on WhatsApp (median minutes, share within 15 minutes and within an hour) and how many were never answered. Use for "why are we not converting", "where do we lose leads", "how is our follow-up".',
   parameters: { type: 'object', properties: { days: { type: 'number', description: 'How far back, default 30' } } },
   async run({ days = 30 } = {}, { now = new Date() } = {}) {
      const n = Math.min(180, Math.max(1, Number(days) || 30));
      const since = new Date(now.getTime() - n * 864e5);
      const leads = await Lead.find({ createdAt: { $gte: since } }).select('status source lostReason phoneNormalized createdAt').lean();
      const won = (l) => l.status === 'won';
      const closed = ['won', 'lost', 'already_customer'];
      const bySource = {};
      for (const l of leads) {
         const k = l.source || 'unknown';
         bySource[k] ||= { leads: 0, won: 0, lost: 0 };
         bySource[k].leads += 1;
         if (won(l)) bySource[k].won += 1;
         if (l.status === 'lost') bySource[k].lost += 1;
      }
      const stuck = {};
      for (const l of leads) if (!closed.includes(l.status)) stuck[l.status] = (stuck[l.status] || 0) + 1;
      const reasons = {};
      for (const l of leads) if (l.status === 'lost') { const r = String(l.lostReason || '').trim() || '(no reason recorded)'; reasons[r] = (reasons[r] || 0) + 1; }

      // First reply: our first outbound after their first inbound, per lead phone.
      const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
      const msgs = phones.length ? await WhatsAppMessage.find({ phoneNormalized: { $in: phones }, occurredAt: { $gte: since } })
         .select('phoneNormalized direction occurredAt').sort({ occurredAt: 1 }).lean() : [];
      const firstIn = new Map();
      const replyMin = new Map();
      for (const m of msgs) {
         if (m.direction === 'inbound' && !firstIn.has(m.phoneNormalized)) firstIn.set(m.phoneNormalized, m.occurredAt);
         else if (m.direction === 'outbound' && firstIn.has(m.phoneNormalized) && !replyMin.has(m.phoneNormalized)) {
            replyMin.set(m.phoneNormalized, (new Date(m.occurredAt) - new Date(firstIn.get(m.phoneNormalized))) / 60000);
         }
      }
      const times = [...replyMin.values()].sort((a, b) => a - b);
      const pct = (k) => (times.length ? Math.round((times.filter((t) => t <= k).length / firstIn.size) * 100) : 0);
      return {
         period: `last ${n} days`,
         leads: leads.length,
         won: leads.filter(won).length,
         winRatePct: leads.length ? Math.round((leads.filter(won).length / leads.length) * 1000) / 10 : 0,
         bySource: Object.entries(bySource).map(([source, v]) => ({ source, ...v, winRatePct: v.leads ? Math.round((v.won / v.leads) * 1000) / 10 : 0 })).sort((a, b) => b.leads - a.leads),
         openByStage: stuck,
         lostReasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 15),
         whatsapp: {
            leadsWhoWrote: firstIn.size,
            answered: replyMin.size,
            neverAnswered: firstIn.size - replyMin.size,
            medianFirstReplyMinutes: times.length ? Math.round(times[Math.floor(times.length / 2)]) : null,
            answeredWithin15MinPct: pct(15),
            answeredWithin1HourPct: pct(60),
         },
         links: [link('Leads', '/leads')],
      };
   },
});

tool({
   name: 'rep_scorecard',
   description: 'Each sales rep over the last N days (default 7): leads given, contacted, quotations, site visits, won, lost, win rate; median minutes to the first WhatsApp reply and the share answered within 15 minutes; leads never answered; chats waiting on them right now; follow-ups overdue. Admins only. Use for "how is the sales team doing", "rep performance", "who is slow to reply". For calls use calls_summary; for contracts and deal value use the rep performance report.',
   parameters: { type: 'object', properties: { days: { type: 'number', description: 'How far back, default 7' } } },
   async run({ days = 7 } = {}, { user, now = new Date() } = {}) {
      if (!ADMIN_ROLES.includes(user?.role)) return { error: 'The team scorecard is for admins' };
      const { scorecard } = await import('../repScorecard.js');
      const n = Math.min(90, Math.max(1, Number(days) || 7));
      const since = new Date(now.getTime() - n * 864e5);
      const fields = 'status phoneNormalized followUpAt owner createdAt';
      const [periodLeads, openLeads] = await Promise.all([
         Lead.find({ createdAt: { $gte: since } }).select(fields).populate('owner', 'name').lean(),
         Lead.find({ status: { $nin: ['won', 'lost', 'already_customer'] }, createdAt: { $gte: new Date(now.getTime() - 60 * 864e5) } }).select(fields).populate('owner', 'name').lean(),
      ]);
      const phones = [...new Set([...periodLeads, ...openLeads].map((l) => l.phoneNormalized).filter(Boolean))];
      const msgs = phones.length ? await WhatsAppMessage.find({ phoneNormalized: { $in: phones }, occurredAt: { $gte: new Date(now.getTime() - 60 * 864e5) } })
         .select('phoneNormalized direction type text occurredAt').sort({ occurredAt: 1 }).lean() : [];
      const byPhone = new Map();
      for (const m of msgs) { if (!byPhone.has(m.phoneNormalized)) byPhone.set(m.phoneNormalized, []); byPhone.get(m.phoneNormalized).push(m); }
      return { period: `last ${n} days`, reps: scorecard({ periodLeads, openLeads, messagesByPhone: byPhone, now }), links: [link('Leads', '/leads')] };
   },
});

tool({
   name: 'leads_list',
   description: 'Every lead in a date range with name, phone, status, source, owner and size — optionally only one status, source or owner. Use to list or look through leads ("all leads from yesterday", "Randa\'s leads this week", "leads still new"). For a PDF or Excel of them use export_file.',
   parameters: {
      type: 'object',
      properties: {
         from: { type: 'string', description: 'YYYY-MM-DD' },
         to: { type: 'string', description: 'YYYY-MM-DD' },
         status: { type: 'string' }, source: { type: 'string' }, owner: { type: 'string', description: 'Owner name, or "unassigned"' },
      },
      required: ['from', 'to'],
   },
   async run(args, ctx) {
      const table = await buildDataset('leads', args, ctx);
      return {
         count: table.rows.length,
         leads: table.rows.slice(0, 80).map(({ id, ...r }) => r),
         truncated: table.rows.length > 80,
         links: [link('Leads', '/leads'), ...table.rows.slice(0, 4).map((r) => link(r.name || 'Lead', `/leads/${r.id}`))],
      };
   },
});

tool({
   name: 'sales_summary',
   description: 'Sales invoiced in Zoho Books: today, the last 7, 31 and 90 days, each with the change on the period before, plus 90-day invoices and money collected. Use for "how much did we sell", "sales this week", "revenue". Admins and accounts only.',
   parameters: { type: 'object', properties: {} },
   async run(_args, { user }) {
      if (!FINANCE_ROLES.includes(user?.role)) return { error: 'Sales figures are for admins and accounts.' };
      const { zohoSales } = await import('../zohoBooks.js');
      const s = await zohoSales();
      if (!s?.configured) return { error: 'Zoho Books is not connected.' };
      return {
         periods: s.periods.map((p) => ({ days: p.days, sales: p.value, previousPeriod: p.before, changePct: p.change })),
         sales90: s.sales90, invoices90: s.invoices90, collected90: s.collected90, currency: 'AED',
         links: [link('Dashboard', '/')],
      };
   },
});

tool({
   name: 'receivables',
   description: 'Money customers owe us in Zoho Books: total unpaid, how much is overdue and how much is not due yet, and how many invoices. Use for "how much is outstanding", "unpaid invoices", "receivables". Admins and accounts only.',
   parameters: { type: 'object', properties: {} },
   async run(_args, { user }) {
      if (!FINANCE_ROLES.includes(user?.role)) return { error: 'Receivables are for admins and accounts.' };
      const { zohoReceivables } = await import('../zohoBooks.js');
      const r = await zohoReceivables();
      if (!r?.configured) return { error: 'Zoho Books is not connected.' };
      if (r.error) return { error: r.error };
      return { ...r.receivables, currency: 'AED', links: [link('Finance', '/?tab=finance')] };
   },
});

tool({
   name: 'calls_summary',
   description: 'Phone calls the reps made and took (synced from their Android phones) over the last N days: per rep calls made, answered, talk time in seconds, leads called, incoming and missed. A rep sees only their own. Use for "how many calls did Randa make", "call activity this week".',
   parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days back, default 7' } } },
   async run({ days = 7 }, { user }) {
      const { summariseCalls } = await import('../callLog.js');
      const n = Math.min(90, Math.max(1, Number(days) || 7));
      const filter = { startedAt: { $gte: new Date(Date.now() - n * 86400000) } };
      if (!ADMIN_ROLES.includes(user?.role) && user?.id) filter.user = user.id;
      const rows = await CallLog.find(filter).populate('user', 'name').lean();
      return { days: n, totalCalls: rows.length, reps: summariseCalls(rows), links: [link('Calls', '/calls')] };
   },
});

tool({
   name: 'follow_ups_due',
   description: 'Leads whose follow-up is due today or overdue, still open, grouped by owner, with the oldest first. Use for "who do we need to follow up", "overdue follow-ups", "Randa\'s follow-ups today".',
   parameters: { type: 'object', properties: { owner: { type: 'string', description: 'Optional owner name' } } },
   async run({ owner }, { now }) {
      const { to: dayEnd } = dayRange(dayKeyFor(now));
      let rows = await Lead.find({ followUpAt: { $ne: null, $lte: dayEnd }, status: { $nin: ['won', 'lost', 'already_customer'] } })
         .populate('owner', 'name').sort({ followUpAt: 1 }).limit(500).lean();
      if (owner) rows = rows.filter((l) => String(l.owner?.name || 'unassigned').toLowerCase().includes(String(owner).toLowerCase()));
      const { from: dayStart } = dayRange(dayKeyFor(now));
      const byOwner = {};
      for (const l of rows) { const o = l.owner?.name || 'unassigned'; byOwner[o] = (byOwner[o] || 0) + 1; }
      return {
         count: rows.length,
         overdue: rows.filter((l) => new Date(l.followUpAt) < dayStart).length,
         byOwner,
         leads: rows.slice(0, 40).map((l) => ({ name: l.fullName, owner: l.owner?.name || null, due: iso(l.followUpAt), status: l.status })),
         links: [link('Follow-Ups', '/follow-ups'), ...rows.slice(0, 3).map((l) => link(l.fullName, `/leads/${l._id}`))],
      };
   },
});

tool({
   name: 'door_activity',
   description: 'The door terminal\'s access log: face, card and fingerprint checks and door events over the last N days, with who came in (linked customer when known) and counts by kind. Use for "who came in today", "door access", "when did X last visit". Admins only.',
   parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Default 1 (today)' }, name: { type: 'string', description: 'Optional person or customer name' } },
   },
   async run({ days = 1, name }, { user }) {
      if (!ADMIN_ROLES.includes(user?.role)) return { error: 'The door log is for admins.' };
      const { DoorEvent } = await import('../../models/index.js');
      const n = Math.min(90, Math.max(1, Number(days) || 1));
      let rows = await DoorEvent.find({ at: { $gte: new Date(Date.now() - n * 86400000) } }).sort({ at: -1 }).limit(1000).populate('customer', 'fullName').select('-raw').lean();
      if (name) {
         const q = String(name).toLowerCase();
         rows = rows.filter((e) => String(e.customer?.fullName || '').toLowerCase().includes(q) || String(e.personName || '').toLowerCase().includes(q));
      }
      const byKind = {};
      for (const e of rows) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      return {
         days: n, count: rows.length, byKind,
         events: rows.slice(0, 40).map((e) => ({ at: e.at, who: e.customer?.fullName || e.personName || null, what: e.label, method: e.method || null })),
         links: [link('Door Access', '/door-access')],
      };
   },
});

tool({
   name: 'roster_now',
   description: 'Who takes new leads right now by the roster, until when, who comes on next, and today\'s handovers. Use for "who is on now", "who is taking leads", "who is on shift".',
   parameters: { type: 'object', properties: {} },
   async run(_args, { now }) {
      const { LeadRoutingRule, LeadRoutingConfig } = await import('../../models/index.js');
      const { coverageNow, countsForToday, outOfHoursIds } = await import('../leadRouting.js');
      const [config, rules, counts] = await Promise.all([
         LeadRoutingConfig.findOne().lean(),
         LeadRoutingRule.find({}).populate('user', 'name isActive').lean(),
         countsForToday({ at: now }),
      ]);
      const live = rules.filter((r) => r.user && r.user.isActive !== false);
      const c = coverageNow({ rules: live, counts, at: now, timeZone: config?.timeZone || 'Asia/Dubai' });
      return {
         distributionOn: Boolean(config?.enabled),
         onNow: c.reps.filter((r) => r.on).map((r) => ({ name: r.name, until: r.until, leadsToday: r.leadsToday })),
         offNow: c.reps.filter((r) => !r.on).map((r) => ({ name: r.name, nextOn: r.nextOn })),
         nobodyOn: c.nobodyOn,
         outOfHoursPeople: outOfHoursIds(config || {}).length,
         links: [link('Lead Distribution', '/settings/lead-distribution')],
      };
   },
});

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
