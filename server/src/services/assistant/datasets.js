import { CallLog, Contract, Lead, Task } from '../../models/index.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { dayKeyFor, dayRange } from '../dailyDigest.js';

/**
 * The tables the assistant can hand over as a file (PDF or Excel), built
 * once here and used both by the tool that offers the file and by the route
 * that downloads it — so the file holds exactly the rows the answer counted.
 *
 * Each returns { title, subtitle, columns, rows }. Rows are plain objects
 * keyed by column; the export service lays them out.
 */

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');
const isAdmin = (user) => ['admin', 'accounts_admin'].includes(user?.role);
const STATUS = (s) => String(s || '').replace(/_/g, ' ');

export const DATASETS = ['leads', 'contracts_expiring', 'tasks', 'units_available', 'calls'];

/** Leads in a date range, with optional status, source and owner (by name). */
async function leads({ from, to, status, source, owner }) {
   const f = dayRange(from || to).from;
   const t = dayRange(to || from).to;
   const filter = { leadDateTime: { $gte: f, $lte: t } };
   if (status) filter.status = status;
   if (source) filter.source = new RegExp(String(source), 'i');
   let rows = await Lead.find(filter).populate('owner', 'name').sort({ leadDateTime: -1 }).limit(2000).lean();
   if (owner) rows = rows.filter((l) => String(l.owner?.name || 'unassigned').toLowerCase().includes(String(owner).toLowerCase()));
   return {
      title: 'Leads',
      subtitle: `${from === to ? from : `${from} to ${to}`}${status ? ` · ${STATUS(status)}` : ''}${source ? ` · ${source}` : ''}${owner ? ` · ${owner}` : ''} · ${rows.length} leads`,
      columns: [
         { key: 'date', label: 'Date' }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' },
         { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' }, { key: 'owner', label: 'Owner' }, { key: 'size', label: 'Size (sq ft)' },
      ],
      rows: rows.map((l) => ({
         id: String(l._id), date: when(l.leadDateTime), name: l.fullName || '', phone: l.phone || l.phoneNormalized || '',
         status: STATUS(l.status), source: l.source || '', owner: l.owner?.name || 'Unassigned', size: l.storageSizeValue || '',
      })),
   };
}

/** Active contracts ending within `days`. */
async function contractsExpiring({ days = 30 }, { scope } = {}) {
   const n = Math.min(365, Math.max(1, Number(days) || 30));
   const from = new Date(new Date().setHours(0, 0, 0, 0));
   const to = new Date(from.getTime() + (n + 1) * 86400000);
   const rows = await Contract.find({ ...(scope?.contractFilter || {}), status: 'active', endDate: { $gte: from, $lt: to } })
      .populate('customer', 'fullName email phone').populate('unit', 'unitNumber').sort({ endDate: 1 }).limit(1000).lean();
   return {
      title: 'Contracts expiring',
      subtitle: `Next ${n} days · ${rows.length} contracts`,
      columns: [
         { key: 'end', label: 'Ends' }, { key: 'daysLeft', label: 'Days left', numeric: false }, { key: 'contractNo', label: 'Contract' },
         { key: 'tenant', label: 'Tenant' }, { key: 'phone', label: 'Phone' }, { key: 'unit', label: 'Unit' }, { key: 'renewal', label: 'Renewal' },
      ],
      rows: rows.map((k) => ({
         end: iso(k.endDate), daysLeft: Math.round((new Date(k.endDate).setHours(0, 0, 0, 0) - from.getTime()) / 86400000),
         contractNo: k.contractNo || '', tenant: k.customer?.fullName || '', phone: k.customer?.phone || '', unit: k.unit?.unitNumber || '', renewal: STATUS(k.renewalIntent || 'undecided'),
      })),
   };
}

/** Open tasks: today, overdue, this week or all, optionally only the asker's. */
async function tasks({ when: w = 'all_open', mine = false }, { user, now = new Date() } = {}) {
   const { from: dayStart, to: dayEnd } = dayRange(dayKeyFor(now));
   const filter = { status: { $ne: 'done' } };
   if (w === 'today') filter.dueDate = { $gte: dayStart, $lte: dayEnd };
   if (w === 'overdue') filter.dueDate = { $lt: dayStart };
   if (w === 'week') filter.dueDate = { $gte: dayStart, $lte: new Date(dayStart.getTime() + 7 * 864e5) };
   if ((mine === true || mine === 'true') && user?.id) filter.assignedTo = user.id;
   const rows = await Task.find(filter).populate('assignedTo', 'name').sort({ dueDate: 1 }).limit(1000).lean();
   const label = { today: 'due today', overdue: 'overdue', week: 'due this week', all_open: 'open' }[w] || 'open';
   return {
      title: 'Tasks',
      subtitle: `${rows.length} ${label}${mine === true || mine === 'true' ? ' · mine' : ''}`,
      columns: [
         { key: 'due', label: 'Due' }, { key: 'title', label: 'Task' }, { key: 'about', label: 'About' },
         { key: 'assignedTo', label: 'Assigned to' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
      ],
      rows: rows.map((t) => ({ due: iso(t.dueDate), title: t.title, about: t.leadName || '', assignedTo: t.assignedTo?.name || '', priority: t.priority || '', status: STATUS(t.status) })),
   };
}

/** Free units now, optionally of one size. */
async function unitsAvailable({ sizeSqf }, { scope } = {}) {
   const { allUnits, bookedUnitIds } = await computeUnitAvailability({});
   const site = scope?.unitFilter?.site ? String(scope.unitFilter.site) : null;
   let units = allUnits.filter((u) => !bookedUnitIds.has(String(u._id)) && u.status !== 'maintenance');
   if (site) units = units.filter((u) => String(u.site) === site);
   if (sizeSqf) units = units.filter((u) => Number(u.sizeSqf) === Number(sizeSqf));
   units.sort((a, b) => (a.sizeSqf - b.sizeSqf) || String(a.unitNumber).localeCompare(String(b.unitNumber)));
   return {
      title: 'Available units',
      subtitle: `${sizeSqf ? `${sizeSqf} sq ft · ` : ''}${units.length} free`,
      columns: [{ key: 'unit', label: 'Unit' }, { key: 'floor', label: 'Floor' }, { key: 'size', label: 'Size (sq ft)' }, { key: 'price', label: 'Monthly price (AED)', numeric: true }],
      rows: units.map((u) => ({ unit: u.unitNumber, floor: u.floor || '', size: u.sizeSqf, price: Number(u.price) || 0 })),
   };
}

/** Phone calls synced from the reps' phones. A rep sees their own. */
async function calls({ days = 7 }, { user } = {}) {
   const n = Math.min(90, Math.max(1, Number(days) || 7));
   const filter = { startedAt: { $gte: new Date(Date.now() - n * 86400000) } };
   if (!isAdmin(user) && user?.id) filter.user = user.id;
   const rows = await CallLog.find(filter).sort({ startedAt: -1 }).limit(2000).populate('user', 'name').populate('lead', 'fullName').lean();
   return {
      title: 'Calls',
      subtitle: `Last ${n} days · ${rows.length} calls`,
      columns: [
         { key: 'at', label: 'When' }, { key: 'rep', label: 'Rep' }, { key: 'direction', label: 'Direction' },
         { key: 'who', label: 'Lead / customer' }, { key: 'phone', label: 'Phone' }, { key: 'seconds', label: 'Seconds' }, { key: 'note', label: 'Note' },
      ],
      rows: rows.map((c) => ({
         at: when(c.startedAt), rep: c.user?.name || '', direction: c.direction, who: c.lead?.fullName || (c.isCustomer ? 'Customer' : ''),
         phone: c.phoneNormalized || '', seconds: c.durationSec || 0, note: c.note || '',
      })),
   };
}

const BUILDERS = { leads, contracts_expiring: contractsExpiring, tasks, units_available: unitsAvailable, calls };

/** One table. `ctx` carries the asking user and site scope, as for the tools. */
export async function buildDataset(name, args = {}, ctx = {}) {
   const b = BUILDERS[name];
   if (!b) throw new Error(`Nothing called ${name} can be exported`);
   return b(args, ctx);
}

/** The download address for a table: the same arguments, as a query string. */
export function exportPath(dataset, format, args = {}) {
   const q = new URLSearchParams({ dataset, format });
   for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
   return `/assistant/export?${q.toString()}`;
}
