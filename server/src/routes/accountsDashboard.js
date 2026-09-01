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
import { zohoBooksConfigured, zohoOutstandingByCustomer } from '../services/zohoBooks.js';

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

export default router;
