/**
 * The dashboard for the person who does the invoicing.
 *
 * The company dashboard answers a manager's questions — occupancy, revenue,
 * how the month is going. Accounts have a different day: what have I been
 * asked to raise, which contracts have just been signed and need an invoice,
 * and who owes us money in Zoho. None of that was on one page.
 *
 * Zoho is fetched alongside the rest but never allowed to sink the page: its
 * contact list is a paged remote call, and if it fails or is not configured
 * the rest still renders with the Zoho panel saying so.
 */

import { Router } from 'express';
import { Contract, Customer, Task } from '../models/index.js';
import { zohoBooksConfigured, zohoOutstandingByCustomer, zohoBooksDashboard, zohoReceivables, zohoSales, listAllZohoContacts } from '../services/zohoBooks.js';
import { compareWithZoho, COMPARE_STATUS } from '../services/zohoCompare.js';
import { tableWorkbook } from '../services/tableExport.js';

const router = Router();

router.use((req, res, next) => (
   ['admin', 'accounts'].includes(req.user?.role)
      ? next()
      : res.status(403).json({ error: 'Not allowed' })
));

const startOfMonth = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return d; };
const endOfMonth = () => { const d = startOfMonth(); d.setMonth(d.getMonth() + 1); return d; };

/** Zoho, or a reason why not. Never throws — see the note at the top. */
async function zohoPanel() {
   if (!zohoBooksConfigured()) return { configured: false, reason: 'Zoho Books is not connected' };
   try {
      const customers = await Customer.find({}).select('fullName email phone phones').lean();
      const { byCustomer, unmatchedOwing } = await zohoOutstandingByCustomer(customers);

      const owing = [];
      for (const c of customers) {
         const bal = byCustomer.get(String(c._id));
         const amount = Number(bal?.outstanding ?? bal ?? 0);
         if (amount > 0) owing.push({ _id: c._id, name: c.fullName, amount: Math.round(amount) });
      }
      owing.sort((a, b) => b.amount - a.amount);

      return {
         configured: true,
         total: owing.reduce((s, o) => s + o.amount, 0),
         // Money owed by somebody Zoho has and we do not, so it is not in the
         // list below and would otherwise silently vanish from the total.
         unmatched: Math.round(unmatchedOwing || 0),
         customersOwing: owing.length,
         top: owing.slice(0, 8),
      };
   } catch (e) {
      return { configured: true, error: e.message };
   }
}

router.get('/', async (req, res) => {
   try {
      const me = req.user.id;
      const now = new Date();

      const [myTasks, openTasks, overdueTasks, awaiting, activeCount, endingSoon] = await Promise.all([
         // Newest first: the thing you were just given is the thing you want.
         Task.find({ assignedTo: me, status: { $ne: 'done' } })
            .select('taskNo title status priority dueDate createdAt leadId leadType leadName')
            .sort({ createdAt: -1 }).limit(10).lean(),
         Task.countDocuments({ assignedTo: me, status: { $ne: 'done' } }),
         Task.countDocuments({ assignedTo: me, status: { $ne: 'done' }, dueDate: { $lt: now } }),
         /* Signed but not yet invoiced is the queue this role works from.
            Draft and pending_signature are the two states before a contract is
            live, which is when the first invoice is raised. */
         Contract.find({ status: { $in: ['draft', 'pending_signature'] }, archived: { $ne: true } })
            .select('contractNo status customer unit units totalQuotation createdAt startDate')
            .populate('customer', 'fullName phone')
            .populate('unit', 'unitNumber').populate('units', 'unitNumber')
            .sort({ createdAt: -1 }).limit(10).lean(),
         Contract.countDocuments({ status: 'active', archived: { $ne: true } }),
         Contract.find({ status: 'active', archived: { $ne: true }, endDate: { $gte: startOfMonth(), $lt: endOfMonth() } })
            .select('contractNo customer endDate').populate('customer', 'fullName')
            .sort({ endDate: 1 }).limit(10).lean(),
      ]);

      res.json({
         tasks: { open: openTasks, overdue: overdueTasks, list: myTasks },
         contracts: {
            awaitingInvoice: awaiting.map((c) => ({
               _id: c._id,
               contractNo: c.contractNo,
               status: c.status,
               customerName: c.customer?.fullName || '—',
               units: (c.units?.length ? c.units : c.unit ? [c.unit] : []).map((u) => u?.unitNumber).filter(Boolean).join(', '),
               total: Math.round(Number(c.totalQuotation || 0)),
               createdAt: c.createdAt,
               startDate: c.startDate,
            })),
            activeCount,
            endingThisMonth: endingSoon.map((c) => ({
               _id: c._id, contractNo: c.contractNo,
               customerName: c.customer?.fullName || '—', endDate: c.endDate,
            })),
         },
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/* Zoho on its own request.
 *
 * Its contact list is a paged remote call and took 8.4 of the 8.5 seconds this
 * page used to spend loading — everything else is a handful of indexed reads.
 * Split out, the page is up immediately and the money panel fills in behind
 * it, rather than eleven tasks waiting on somebody else's API. */
router.get('/zoho', async (_req, res) => {
   res.json(await zohoPanel());
});

/* GET /api/accounts-dashboard/zoho-books — Zoho Books' own home-dashboard
   figures: receivables and payables (current / overdue), bank balances,
   money in and out by month, income vs expense, top expenses. Cached ten
   minutes; ?refresh=1 to fetch now. */
// GET /api/accounts-dashboard/zoho-receivables — the Receivables card alone, for the Overview tab.
router.get('/zoho-receivables', async (req, res) => {
   try {
      res.json(await zohoReceivables({ force: req.query.refresh === '1' }));
   } catch (e) {
      res.json({ configured: true, error: e.response?.data?.message || e.message });
   }
});

/* GET /api/accounts-dashboard/zoho-compare — every customer with a contract
   beside Zoho Books' contacts, matched the way invoices are (email or phone),
   and the reason for each one that does not match. ?format=excel to download. */
router.get('/zoho-compare', async (req, res) => {
   try {
      if (!zohoBooksConfigured()) return res.json({ configured: false });
      const withContracts = await Contract.distinct('customer');
      const [customers, { contacts }] = await Promise.all([
         Customer.find({ _id: { $in: withContracts } }).select('fullName email phone phones').lean(),
         listAllZohoContacts({ force: req.query.refresh === '1' }),
      ]);
      const out = compareWithZoho(customers, contacts);
      if (req.query.format === 'excel') {
         const columns = [
            { key: 'status', label: 'Result' }, { key: 'crmName', label: 'CRM name' }, { key: 'crmEmail', label: 'CRM email' }, { key: 'crmPhone', label: 'CRM phone' },
            { key: 'zohoName', label: 'Zoho name' }, { key: 'zohoEmail', label: 'Zoho email' }, { key: 'zohoPhone', label: 'Zoho phone' },
            { key: 'outstanding', label: 'Zoho owed (AED)', numeric: true }, { key: 'note', label: 'What to do' },
         ];
         const rows = out.rows.map((r) => ({ ...r, status: COMPARE_STATUS[r.status] }));
         const buf = await tableWorkbook({ title: 'CRM and Zoho Books — contact check', subtitle: `${customers.length} CRM customers with contracts · ${contacts.length} Zoho contacts`, columns, rows });
         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
         res.setHeader('Content-Disposition', `attachment; filename="crm-zoho-check-${new Date().toISOString().slice(0, 10)}.xlsx"`);
         return res.send(Buffer.from(buf));
      }
      res.json({ configured: true, crmCount: customers.length, zohoCount: contacts.length, labels: COMPARE_STATUS, ...out });
   } catch (e) {
      res.status(502).json({ configured: true, error: e.response?.data?.message || e.message });
   }
});

// GET /api/accounts-dashboard/zoho-sales — invoiced per day and by period, for the admin dashboard.
router.get('/zoho-sales', async (req, res) => {
   try {
      res.json(await zohoSales({ force: req.query.refresh === '1' }));
   } catch (e) {
      res.json({ configured: true, error: e.response?.data?.message || e.message });
   }
});

router.get('/zoho-books', async (req, res) => {
   try {
      res.json(await zohoBooksDashboard({ force: req.query.refresh === '1' }));
   } catch (e) {
      res.json({ configured: true, error: e.message });
   }
});

export default router;
