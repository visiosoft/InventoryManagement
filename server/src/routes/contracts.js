import { Router } from 'express';
import crypto from 'crypto';
import { isValidObjectId, Types } from 'mongoose';
import { stampSignature } from '../services/stampSignature.js';
import { Contract, Customer, Unit, Payment, Document, Invoice, Quote, AgreementTemplate, nextContractNo, nextInvoiceNo, MessageTemplate } from '../models/index.js';
import { creditFor, markLeadWon } from '../services/dealCredit.js';
import { zohoBooksConfigured, zohoOutstandingByCustomer } from '../services/zohoBooks.js';
import { requireAdmin } from '../middleware/auth.js';
import { renewLink, moveOutLink } from '../services/renewalLink.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { sendForSignature, downloadSignedPdf, zohoConfigured } from '../services/zoho.js';
import { uploadFile } from '../services/drive.js';
import { mergeAgreementText, renderAgreementTextPdf, renderAgreementHtmlPdf, looksLikeHtml } from '../services/agreementText.js';
import { sendWhatsAppTemplate, whatsappSendConfigured } from '../services/whatsapp.js';
import { AutomationLog } from '../models/index.js';
import { buildContractPdf } from '../services/contractDocument.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { siteScope } from '../utils/siteScope.js';
import { phoneClauses } from '../utils/phoneSearch.js';

const router = Router();

router.param('id', (req, res, next, id) => {
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid contract id' });
  }
  next();
});

const populateAll = (q) => q.populate('customer').populate('unit').populate('units').populate('quote', 'quoteNo status');

const OPEN_STATUSES = ['draft', 'pending_signature', 'active'];

function hasDateOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function findOverlappingUnitContract({ unit, startDate, endDate, excludeId }) {
  const openContracts = await Contract.find({
    unit,
    status: { $in: OPEN_STATUSES },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('contractNo startDate endDate status');

  return openContracts.find((c) =>
    hasDateOverlap(new Date(startDate), new Date(endDate), new Date(c.startDate), new Date(c.endDate))
  );
}


async function deleteContractRecord(contract) {
  if (contract.status === 'active') {
    throw new Error('Cannot delete an active contract. End or cancel it first.');
  }

  const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Payment.deleteMany({ contract: contract._id });
  await Document.deleteMany({ contract: contract._id });
  await Invoice.deleteMany({ orderNumber: contract.contractNo });
  await contract.deleteOne();
  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.archived === 'true') filter.archived = true;
  else if (req.query.archived !== 'all') filter.archived = { $ne: true };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.customer) filter.customer = req.query.customer;
  if (req.query.billing) filter.billingPeriod = req.query.billing;
  if (req.query.from || req.query.to) {
    filter.startDate = {};
    if (req.query.from) filter.startDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.startDate.$lte = new Date(req.query.to + 'T23:59:59');
  }
  if (req.query.search) {
    const re = new RegExp(req.query.search.trim(), 'i');
    const [matchedUnits, matchedCustomers] = await Promise.all([
      Unit.find({ unitNumber: re }).select('_id'),
      Customer.find({ $or: [{ fullName: re }, { clientId: re }, { email: re }, ...phoneClauses(req.query.search)] }).select('_id'),
    ]);
    const or = [{ contractNo: re }];
    if (matchedUnits.length) or.push({ unit: { $in: matchedUnits.map((u) => u._id) } });
    if (matchedCustomers.length) or.push({ customer: { $in: matchedCustomers.map((c) => c._id) } });
    filter.$or = or;
  }
  const scope = await siteScope(req.query.site);
  if (scope) {
    filter.$and = [...(filter.$and || []), { $or: [{ unit: { $in: scope.unitIds } }, { units: { $in: scope.unitIds } }] }];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  // Cap allows a full fetch: the booking screen needs every open contract to
  // detect unit conflicts, and a truncated page would show booked units free.
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 2000);
  const skip = (page - 1) * limit;

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    start_asc: { startDate: 1 },
    start_desc: { startDate: -1 },
    end_asc: { endDate: 1 },
    end_desc: { endDate: -1 },
    rate_desc: { rate: -1 },
    rate_asc: { rate: 1 },
  };
  const sort = sortMap[req.query.sort] || sortMap.newest;

  // Owed money lives in Zoho, not Mongo, so it cannot be part of the database
  // sort. Sorting by it means resolving the whole filtered set first and paging
  // in memory — the alternative, reordering just the current page, would put the
  // largest debtor at the top of page three and look like a bug.
  const sortByOwed = req.query.sort === 'owes_desc' || req.query.sort === 'owes_asc';

  // Renewal is sorted by how much attention it needs, not alphabetically.
  // Alphabetical puts not_renewing first and undecided last, which buries the
  // 117 contracts nobody has called yet under the handful already settled.
  // Contracts predating the field count as undecided, matching the model default.
  const RENEWAL_ORDER = { undecided: 0, not_renewing: 1, renewing: 2 };
  const sortByRenewal = req.query.sort === 'renewal_asc' || req.query.sort === 'renewal_desc';
  const inMemorySort = sortByOwed || sortByRenewal;

  const [contracts, total] = await Promise.all([
    inMemorySort
      ? Contract.find(filter)
        .populate('customer', 'fullName email phone phones')
        .populate('unit', 'unitNumber floor')
        .populate('units', 'unitNumber floor')
        .sort({ endDate: 1 }).limit(2000).lean()
      : Contract.find(filter)
        .populate('customer', 'fullName email phone phones')
        .populate('unit', 'unitNumber floor')
        .populate('units', 'unitNumber floor')
        .sort(sort).skip(skip).limit(limit).lean(),
    Contract.countDocuments(filter),
  ]);

  // Attach document counts and payment status so the list can flag gaps
  const ids = contracts.map((c) => c._id);
  const [docCounts, payAgg] = ids.length
    ? await Promise.all([
      Document.aggregate([
        { $match: { contract: { $in: ids } } },
        { $group: { _id: '$contract', count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { contract: { $in: ids } } },
        {
          $group: {
            _id: '$contract',
            total: { $sum: '$amount' },
            paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
            overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
          }
        },
      ]),
    ])
    : [[], []];
  const docMap = new Map(docCounts.map((d) => [String(d._id), d.count]));
  const payMap = new Map(payAgg.map((p) => [String(p._id), p]));
  const rows = contracts.map((c) => {
    const pay = payMap.get(String(c._id));
    const paymentStatus = !pay ? 'no_invoice'
      : pay.paid >= pay.total ? 'paid'
        : pay.paid > 0 ? 'partial'
          : 'unpaid';
    // Full contract value: the larger of the saved quotation and what's
    // actually billed on the payment records (rent + advance + deposit) — a
    // stale totalQuotation must not understate an invoiced contract.
    let contractAmount = Number(c.totalQuotation || 0);
    if (pay) contractAmount = Math.max(contractAmount, Math.round(pay.total * 100) / 100);
    if (!contractAmount && c.startDate && c.endDate) {
      const days = Math.max(0, (new Date(c.endDate) - new Date(c.startDate)) / 86400000);
      const weeks = Math.ceil(days / 7);
      contractAmount = Math.round(weeks * ((c.rate || 0) / 4) * 100) / 100;
    }
    return {
      ...c,
      documentCount: docMap.get(String(c._id)) ?? 0,
      paymentStatus,
      paidAmount: pay ? Math.round(pay.paid * 100) / 100 : 0,
      totalAmount: pay ? Math.round(pay.total * 100) / 100 : 0,
      contractAmount,
      overdueCount: pay?.overdue ?? 0,
    };
  });

  // What the tenant owes, from Zoho Books. Shown here as well as on the Tenants
  // list because this is the screen the team actually works from — chasing a
  // renewal without knowing there is money outstanding is the wrong call to make.
  let data = rows;
  if (zohoBooksConfigured() && rows.length) {
    const customers = rows.map((r) => r.customer).filter(Boolean);
    const { byCustomer } = await zohoOutstandingByCustomer(customers);
    data = rows.map((r) => {
      const hit = r.customer ? byCustomer.get(String(r.customer._id)) : null;
      return hit ? { ...r, outstanding: hit.outstanding } : r;
    });
  }

  // Only now can the owed sort happen, because only now is the figure known.
  // Both of these already carry a soonest-expiry-first order from the query, so
  // ties inside a group stay in a useful sequence.
  if (inMemorySort) {
    if (sortByOwed) {
      const dir = req.query.sort === 'owes_asc' ? 1 : -1;
      data = [...data].sort((a, b) => dir * (Number(a.outstanding || 0) - Number(b.outstanding || 0)));
    } else {
      const dir = req.query.sort === 'renewal_desc' ? -1 : 1;
      const rank = (c) => RENEWAL_ORDER[c.renewalIntent || 'undecided'] ?? 0;
      data = [...data].sort((a, b) => dir * (rank(a) - rank(b)));
    }
    data = data.slice(skip, skip + limit);
  }

  res.json({ data, total, page, pages: Math.ceil(total / limit), limit });
});

// Latest notes across all contracts (for dashboard)
router.get('/latest-notes', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const notes = await Contract.aggregate([
    { $match: { 'timeline.0': { $exists: true } } },
    { $unwind: '$timeline' },
    { $sort: { 'timeline.at': -1 } },
    { $limit: limit },
    { $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: '_cust' } },
    {
      $project: {
        contractNo: 1,
        note: '$timeline',
        customer: { $arrayElemAt: ['$_cust', 0] },
      },
    },
  ]);
  res.json(notes.map((n) => ({
    contractId: n._id,
    contractNo: n.contractNo,
    customerName: n.customer?.fullName || '',
    at: n.note.at,
    text: n.note.text,
    author: n.note.author,
  })));
});

// Contracts expiring within the next N days (default 7) — feeds the sales
// team's renewal-calling queue. Any authenticated user can see this (incl.
// sales reps), since renewal follow-up isn't restricted to whoever closed
// the original deal. Declared before '/:id' so the path isn't swallowed.
router.get('/expiring-soon', async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 86400000);
  const contracts = await Contract.find({ status: 'active', endDate: { $gte: now, $lte: cutoff } })
    .populate('customer', 'fullName phone email')
    .populate('unit', 'unitNumber floor')
    .sort({ endDate: 1 })
    .lean();
  res.json(contracts.map((c) => ({
    _id: c._id,
    contractNo: c.contractNo,
    customer: c.customer,
    unit: c.unit,
    endDate: c.endDate,
    rate: c.rate,
    renewalIntent: c.renewalIntent || 'undecided',
    daysLeft: Math.ceil((new Date(c.endDate) - now) / 86400000),
  })));
});

// List contracts pending admin approval.
// Typeahead for the global search box: match a contract number, tenant name or
// unit number and return just enough to render a result row. Declared before
// '/:id' so the path isn't swallowed by it.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 8), 25);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  // Tenants are matched on name, contact details and client ID — a phone number
  // needs its own digits-only match because of the mixed stored formats.
  const customerOr = [{ fullName: re }, { clientId: re }, { email: re }, ...phoneClauses(q)];

  const [units, customers] = await Promise.all([
    Unit.find({ unitNumber: re }).select('_id').limit(100).lean(),
    Customer.find({ $or: customerOr }).select('_id').limit(100).lean(),
  ]);

  const or = [{ contractNo: re }];
  if (units.length) or.push({ unit: { $in: units.map((u) => u._id) } });
  if (customers.length) or.push({ customer: { $in: customers.map((c) => c._id) } });

  const contracts = await Contract.find({
    $or: or,
    archived: { $ne: true },
    status: { $nin: ['ended', 'cancelled'] },
  })
    .select('contractNo status startDate endDate')
    .populate('customer', 'fullName')
    .populate('unit', 'unitNumber')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json(contracts);
});

router.get('/pending-approvals', async (req, res) => {
  const contracts = await Contract.find({ approvalStatus: 'pending' })
    .populate('customer', 'fullName phone email')
    .populate('unit', 'unitNumber')
    .sort({ updatedAt: -1 })
    .lean();
  res.json(contracts);
});

// The next contract booked on each of this contract's units, so the Units tab
// can warn that a unit is already spoken for after this one ends. Units with
// nothing upcoming are simply absent from the map.
router.get('/:id/unit-bookings', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).select('units unit endDate').lean();
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const unitIds = (contract.units?.length ? contract.units : [contract.unit]).filter(Boolean);

    const results = await Promise.all(unitIds.map((unitId) =>
      Contract.findOne({
        _id: { $ne: contract._id },
        status: { $in: ['active', 'pending_signature', 'draft'] },
        archived: { $ne: true },
        $or: [{ unit: unitId }, { units: unitId }],
        startDate: { $gte: contract.endDate },
      }).sort({ startDate: 1 }).populate('customer', 'fullName').lean()
    ));

    const bookings = {};
    unitIds.forEach((unitId, i) => {
      const next = results[i];
      if (!next) return;
      bookings[String(unitId)] = {
        contractId: String(next._id),
        contractNo: next.contractNo || '',
        startDate: next.startDate,
        customerName: next.customer?.fullName || '',
        status: next.status || '',
      };
    });

    res.json({ bookings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const [linkedQuote, paidInvoiceIds, documents, invoices, payments] = await Promise.all([
    // null = never set → fill from the quote; an explicit 0 must stick
    contract.quote && contract.totalQuotation == null
      ? Quote.findById(contract.quote).select('total').lean()
      : null,
    Invoice.find({ orderNumber: contract.contractNo, status: 'paid' }).distinct('_id'),
    /* The contract's own files, plus the tenant's.
     *
     * An Emirates ID belongs to a person, not to one contract, and the booking
     * wizard attaches it to the customer — so 105 documents across 65
     * contracts existed and could not be seen from the page that asks for
     * them. Uploading again was the only apparent fix, which is how the same
     * passport ends up on file three times. */
    Document.find(
      contract.customer
        ? { $or: [{ contract: contract._id }, { customer: contract.customer._id || contract.customer }] }
        : { contract: contract._id },
    ).sort({ createdAt: -1 }).lean(),
    Invoice.find({ orderNumber: contract.contractNo })
      .select('invoiceNo status dueDate invoiceDate total paymentMade items subject createdAt paymentHistory attachments')
      .sort({ dueDate: 1 })
      .lean(),
    Payment.find({ contract: contract._id })
      .populate('invoice', 'invoiceNo status dueDate total paymentHistory')
      .sort({ dueDate: 1 })
      .lean(),
  ]);

  // Sync totalQuotation from the linked quote only when never set (null)
  if (linkedQuote && Number(linkedQuote.total || 0) > 0) {
    contract.totalQuotation = Number(linkedQuote.total);
    Contract.updateOne({ _id: contract._id }, { totalQuotation: linkedQuote.total }).exec();
  }

  // Mark payment records as paid if their invoice is already paid
  if (paidInvoiceIds.length > 0) {
    Payment.updateMany(
      { contract: contract._id, invoice: { $in: paidInvoiceIds }, status: { $in: ['pending', 'overdue'] } },
      { $set: { status: 'paid' } }
    ).exec();
  }

  // Reconcile: if an invoice's total exceeds the sum of its linked payment records
  // (e.g. a Lock or extra item was added manually), create/update an adjustment record.
  const unitNo = contract.unit?.unitNumber || '-';
  const paymentsArr = [...payments];
  // Collected and written once at the end — a write per invoice would cost a
  // full network round-trip each on every page load.
  const paymentOps = [];
  const invoiceOps = [];
  for (const inv of invoices) {
    const invId = String(inv._id);
    const linked = paymentsArr.filter(p => {
      const pid = p.invoice?._id ? String(p.invoice._id) : String(p.invoice);
      return pid === invId;
    });
    const linkedSum = Math.round(linked.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const diff = Math.round((inv.total - linkedSum) * 100) / 100;
    const adjRecord = linked.find(p => /^Invoice adjustment/i.test(p.notes || ''));

    if (diff > 0.01) {
      if (adjRecord) {
        if (Math.abs(adjRecord.amount - diff) > 0.01) {
          paymentOps.push({
            updateOne: {
              filter: { _id: adjRecord._id },
              update: { $set: { amount: diff, status: inv.status === 'paid' ? 'paid' : 'pending' } },
            },
          });
          adjRecord.amount = diff;
        }
      } else {
        // Build the record locally so the response can include it without a
        // second round-trip to read back what we just wrote. bulkWrite skips
        // schema defaults and timestamps, so set them explicitly.
        const now = new Date();
        const doc = {
          _id: new Types.ObjectId(),
          contract: contract._id,
          invoice: inv._id,
          amount: diff,
          dueDate: linked[0]?.dueDate || inv.dueDate,
          status: inv.status === 'paid' ? 'paid' : 'pending',
          notes: `Invoice adjustment · Unit ${unitNo}`,
          method: '',
          recordedBy: '',
          createdAt: now,
          updatedAt: now,
        };
        paymentOps.push({ insertOne: { document: doc } });
        paymentsArr.push({
          ...doc,
          invoice: { _id: inv._id, invoiceNo: inv.invoiceNo, status: inv.status, dueDate: inv.dueDate, total: inv.total },
        });
      }
    } else if (diff < -0.01 && adjRecord) {
      // Invoice total dropped — remove the stale adjustment
      paymentOps.push({ deleteOne: { filter: { _id: adjRecord._id } } });
      const idx = paymentsArr.findIndex(p => String(p._id) === String(adjRecord._id));
      if (idx !== -1) paymentsArr.splice(idx, 1);
    }
  }

  // Reconcile each invoice's paid figure against its payment history and linked
  // payment records — the same rule the invoice detail endpoint applies — so the
  // billing plan shows the true outstanding balance instead of a stale total.
  for (const inv of invoices) {
    const historySum = Math.round(
      (inv.paymentHistory || []).reduce((s, p) => s + Number(p.amount || 0), 0) * 100
    ) / 100;
    const linkedPaid = Math.round(
      paymentsArr
        .filter((p) => {
          const pid = p.invoice?._id ? String(p.invoice._id) : String(p.invoice);
          return pid === String(inv._id) && p.status === 'paid';
        })
        .reduce((s, p) => s + Number(p.amount || 0), 0) * 100
    ) / 100;
    const invTotal = Number(inv.total || 0);
    const correctPaid = Math.round(Math.min(Math.max(historySum, linkedPaid), invTotal) * 100) / 100;

    const updates = {};
    if (Math.abs(correctPaid - Number(inv.paymentMade || 0)) > 0.01) updates.paymentMade = correctPaid;
    if (correctPaid >= invTotal && invTotal > 0 && inv.status !== 'paid') updates.status = 'paid';
    else if (correctPaid > 0 && correctPaid < invTotal && inv.status === 'paid') updates.status = 'partial';

    if (Object.keys(updates).length) {
      invoiceOps.push({ updateOne: { filter: { _id: inv._id }, update: { $set: updates } } });
      Object.assign(inv, updates);
    }
  }

  // One round-trip each, and only when something actually drifted.
  // Fire-and-forget so the response isn't blocked by writes.
  if (paymentOps.length || invoiceOps.length) {
    Promise.all([
      paymentOps.length ? Payment.bulkWrite(paymentOps) : null,
      invoiceOps.length ? Invoice.bulkWrite(invoiceOps) : null,
    ]).catch(() => { });
  }

  res.json({ contract, payments: paymentsArr, documents, invoices });
});

// Create a contract (draft). Generates the payment schedule and reserves the unit(s).
router.post('/', async (req, res) => {
  const { customer, unit, units: extraUnits, billingPeriod, rate, deposit, startDate, endDate, notes, firstMonthDiscountPct } = req.body;

  // Determine all unit IDs covered by this contract.
  // `extraUnits` (array) is supplied when creating a single contract for multiple units.
  const allUnitIds = (Array.isArray(extraUnits) && extraUnits.length > 1)
    ? extraUnits
    : [unit];

  const primaryUnitDoc = await Unit.findById(allUnitIds[0]);
  if (!primaryUnitDoc) return res.status(404).json({ error: 'Unit not found' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid contract dates' });
  }
  if (end <= start) {
    return res.status(400).json({ error: 'End date must be after start date' });
  }

  // Units can be booked for multiple customers simultaneously — no overlap check needed.

  // Auto-calculate totalQuotation = full contract value for the entire term
  const totalDaysAll = Math.round((end - start) / 86400000);
  const totalWeeksAll = Math.ceil(totalDaysAll / 7);
  const weeklyRateAll = Math.round((Number(rate || 0) / 4) * 100) / 100;
  const discPct = Number(req.body.firstMonthDiscountPct || 0);
  let totalQuotation = 0;
  for (let i = 0; i < totalWeeksAll; i++) {
    totalQuotation += (discPct > 0 && i < 4)
      ? Math.round(weeklyRateAll * (1 - discPct / 100) * 100) / 100
      : weeklyRateAll;
  }
  totalQuotation = Math.round(totalQuotation * 100) / 100;

  /* Which lead this came from, and who gets the credit. Recorded here rather
     than left to be worked out later - see services/dealCredit.js. */
  const credit = await creditFor({
    customer: await Customer.findById(customer).select('phone phones').lean(),
    fallbackUserId: req.body.salesRep || req.user.id,
  });

  const contract = await Contract.create({
    contractNo: await nextContractNo(),
    customer,
    unit: allUnitIds[0],
    units: allUnitIds.length > 1 ? allUnitIds : [],
    billingPeriod, rate, deposit, startDate, endDate, notes,
    firstMonthDiscountPct: Number(req.body.firstMonthDiscountPct || 0),
    totalQuotation,
    lead: credit.leadId,
    salesRep: req.body.salesRep || credit.ownerId || req.user.id,
    status: 'draft',
  });

  // A lead that has signed is won, whoever ends up credited for it.
  await markLeadWon({ leadId: credit.leadId, contractNo: contract.contractNo, userId: req.user.id });

  await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));

  // Auto-generate first invoice if requested (covers first billing period only)
  if (req.body.generateInvoice) {
    const unitNo = primaryUnitDoc.unitNumber || '-';
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthlyRate = Number(rate || 0);
    const weeklyRate = Math.round((monthlyRate / 4) * 100) / 100;
    // First billing period = 4 weeks (28 days) or remainder if contract is shorter
    const periodEnd = new Date(start); periodEnd.setDate(periodEnd.getDate() + 28);
    const actualEnd = periodEnd > end ? end : periodEnd;
    const periodDays = Math.round((actualEnd - start) / 86400000);
    const periodWeeks = Math.max(1, Math.ceil(periodDays / 7));
    const discountPct = Number(req.body.firstMonthDiscountPct || 0);
    const weekAmounts = [];
    for (let i = 0; i < periodWeeks; i++) {
      weekAmounts.push(discountPct > 0 && i < 4
        ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
        : weeklyRate);
    }
    const periodTotal = Math.round(weekAmounts.reduce((s, a) => s + a, 0) * 100) / 100;
    const displayEnd = fmt(new Date(actualEnd - 86400000));
    const items = [{
      sortOrder: 0,
      itemDetails: `Storage rental — Unit ${unitNo}, ${fmt(start)} – ${displayEnd}`,
      quantity: periodWeeks,
      rate: weeklyRate,
      discountPct: discountPct > 0 ? discountPct : 0,
      amount: periodTotal,
    }];
    const subTotal = periodTotal;
    const invoice = await Invoice.create({
      invoiceNo: await nextInvoiceNo(unitNo, contract._id),
      customer,
      invoiceDate: new Date(),
      dueDate: start,
      orderNumber: contract.contractNo,
      terms: 'Due on receipt',
      subject: `Storage rental — Unit ${unitNo}, ${fmt(start)} – ${displayEnd}`,
      items,
      customerNotes: '',
      subTotal, total: subTotal, paymentMade: 0, status: 'sent',
    });
    await Payment.create({
      contract: contract._id,
      invoice: invoice._id,
      amount: periodTotal,
      dueDate: start,
      status: 'pending',
      notes: `Storage rental — Unit ${unitNo}, ${fmt(start)} – ${displayEnd}`,
    });
  }

  const populated = await populateAll(Contract.findById(contract._id));
  res.status(201).json(populated);
});

// Generate a unique signing link for the customer.
// Draft / pending_signature → any authenticated user.
// Active (re-sign) → admin only.
router.post('/:id/create-signing-link', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const allowedStatuses = ['draft', 'pending_signature', 'active'];
  if (!allowedStatuses.includes(contract.status)) {
    return res.status(409).json({ error: `Cannot generate a signing link for a ${contract.status} contract` });
  }

  // Re-signing an already-active contract requires admin
  if (contract.status === 'active' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can generate a signing link for an already-signed contract' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  contract.signingToken = token;
  contract.signingTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  // Move unsigned contracts to pending_signature; keep active contracts active
  if (contract.status === 'draft') contract.status = 'pending_signature';
  await contract.save();

  const baseUrl = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  res.json({
    signingUrl: `${baseUrl}/sign/${token}`,
    expiresAt: contract.signingTokenExpiry,
    reSign: contract.status === 'active',
  });
});

// Send the contract for e-signature via Zoho Sign (or mock).
router.post('/:id/send-signature', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!['draft'].includes(contract.status)) {
    return res.status(409).json({ error: `Cannot send a ${contract.status} contract for signature` });
  }
  if (!contract.customer.email) {
    return res.status(400).json({ error: 'Customer has no email address for the signature request' });
  }

  const pdfBuffer = await buildContractPdf(contract);

  try {
    const result = await sendForSignature({
      contract,
      pdfBuffer,
      signer: { name: contract.customer.fullName, email: contract.customer.email },
    });
    contract.zohoRequestId = result.requestId;
    contract.status = 'pending_signature';
    await contract.save();
    res.json({ contract, mock: result.mock });
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    res.status(502).json({ error: `Zoho Sign request failed: ${detail}` });
  }
});

// Marks the contract signed → active. Called by the Zoho webhook, or manually
// ("simulate signed" in mock mode / paper signature).
async function markSigned(contractId, recordedBy = '') {
  const contract = await populateAll(Contract.findById(contractId));
  if (!contract) throw new Error('Contract not found');
  if (!['pending_signature', 'draft'].includes(contract.status)) {
    throw new Error(`Contract is ${contract.status}`);
  }
  const approvalError = approvalBlocksBooking(contract);
  if (approvalError) throw new Error(approvalError);

  // Archive the signed PDF (real Zoho download, or regenerate locally in mock mode).
  let pdfBuffer = null;
  if (zohoConfigured() && contract.zohoRequestId && !contract.zohoRequestId.startsWith('MOCK-')) {
    pdfBuffer = await downloadSignedPdf(contract.zohoRequestId);
  }
  const signedAt = new Date();
  if (!pdfBuffer) {
    // No e-signature exists on this path — it is the paper or in-person route.
    // The archived copy says so, rather than carrying a blank signature line
    // that looks like the signature went missing.
    const on = signedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    pdfBuffer = await buildContractPdf(contract, signedAt, {
      offline: true,
      offlineNote: `Signed outside the system${recordedBy ? `, recorded by ${recordedBy}` : ''} on ${on}`,
    });
  }
  const stored = await uploadFile({
    buffer: pdfBuffer,
    filename: `${contract.contractNo}-signed.pdf`,
    mimeType: 'application/pdf',
    customerName: contract.customer?.fullName,
  });
  await Document.create({
    contract: contract._id,
    customer: contract.customer._id,
    name: `${contract.contractNo} — signed contract`,
    type: 'contract',
    ...stored,
  });

  contract.status = 'active';
  contract.signedDocUrl = stored.url;
  // Recorded here too: the contract said signedDocUrl was set while signedAt
  // stayed empty, so nothing in the data said when it had been signed.
  if (!contract.signedAt) contract.signedAt = signedAt;
  contract.timeline.push({
    type: 'signed',
    text: `Marked signed${recordedBy ? ` by ${recordedBy}` : ''}`,
    author: recordedBy || 'system',
  });
  await contract.save();
  const signedUnitIds = contract.units?.length ? contract.units.map((u) => u._id ?? u) : [contract.unit._id];
  await Promise.all(signedUnitIds.map((uid) => syncUnitStatus(uid)));
  return contract;
}

router.post('/:id/mark-signed', async (req, res) => {
  try {
    res.json(await markSigned(req.params.id, req.user?.name || req.user?.email || ''));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Zoho Sign webhook — configure this URL in Zoho. Matches by request id.
router.post('/zoho-webhook', async (req, res) => {
  const requestId = req.body?.requests?.request_id;
  const status = req.body?.requests?.request_status;
  if (requestId && status === 'completed') {
    const contract = await Contract.findOne({ zohoRequestId: requestId });
    if (contract) await markSigned(contract._id).catch(() => { });
  }
  res.json({ ok: true });
});

// Admin approval gate — blocks booking (activation) until an admin approves.
function approvalBlocksBooking(contract) {
  if (contract.approvalStatus === 'pending') {
    return 'This contract requires admin approval before it can be booked';
  }
  if (contract.approvalStatus === 'rejected') {
    return `This contract was rejected by admin${contract.approvalNote ? `: ${contract.approvalNote}` : ''}`;
  }
  return null;
}

// Send a contract for admin approval.
router.post('/:id/send-for-approval', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.approvalStatus === 'approved') {
    return res.status(409).json({ error: 'Contract is already approved' });
  }
  const actor = req.user.name || req.user.email || 'user';
  contract.approvalStatus = 'pending';
  contract.approvalNote = '';
  contract.approvedBy = '';
  contract.approvedAt = undefined;
  contract.timeline.push({ at: new Date(), text: `Sent for admin approval by ${actor}`, author: actor });
  await contract.save();
  res.json(await populateAll(Contract.findById(contract._id)));
});

// Approve or reject a contract for booking (admin only).
router.post('/:id/approve', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can approve a contract' });
  }
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const actor = req.user.name || req.user.email || 'admin';
  contract.approvalStatus = 'approved';
  contract.approvalNote = String(req.body?.note || '');
  contract.approvedBy = actor;
  contract.approvedAt = new Date();
  contract.status = 'active';
  contract.timeline.push({ at: new Date(), text: `Contract approved and activated by ${actor}${req.body?.note ? `: ${req.body.note}` : ''}`, author: actor });
  await contract.save();

  const activateUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(activateUnitIds.map((uid) => syncUnitStatus(uid)));

  res.json(await populateAll(Contract.findById(contract._id)));
});

router.post('/:id/reject', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can reject a contract' });
  }
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'active') {
    return res.status(409).json({ error: 'Cannot reject an already active contract' });
  }

  const actor = req.user.name || req.user.email || 'admin';
  contract.approvalStatus = 'rejected';
  contract.approvalNote = String(req.body?.note || '');
  contract.approvedBy = actor;
  contract.approvedAt = new Date();
  contract.timeline.push({ at: new Date(), text: `Contract rejected${req.body?.note ? `: ${req.body.note}` : ''}`, author: actor });
  await contract.save();
  res.json(await populateAll(Contract.findById(contract._id)));
});

// Activate without signature (e.g. signed on paper, skip e-sign).
router.post('/:id/activate', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!['draft', 'pending_signature'].includes(contract.status)) {
    return res.status(409).json({ error: `Cannot activate a ${contract.status} contract` });
  }
  const approvalError = approvalBlocksBooking(contract);
  if (approvalError) return res.status(403).json({ error: approvalError });

  contract.status = 'active';
  await contract.save();

  const activateUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(activateUnitIds.map((uid) => syncUnitStatus(uid)));
  res.json(await populateAll(Contract.findById(contract._id)));
});

// End or cancel a contract — frees the unit and removes unpaid future payments.
async function closeContract(req, res, status) {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (['ended', 'cancelled'].includes(contract.status)) {
    return res.status(409).json({ error: `Contract is already ${contract.status}` });
  }

  const { endDate, reason } = req.body ?? {};
  const effectiveEnd = endDate ? new Date(endDate) : new Date();

  contract.status = status;
  // Closed contracts move to the archive: hidden from search and the default
  // list, still reachable under "Show archived"
  contract.archived = true;
  // If an early end date was provided, update the stored end date
  if (endDate && new Date(endDate) < new Date(contract.endDate)) {
    contract.endDate = effectiveEnd;
  }
  // Record reason as a timeline note
  if (reason) {
    if (!contract.timeline) contract.timeline = [];
    const actor = req.user?.name || req.user?.email || '';
    contract.timeline.push({ at: new Date(), text: `Contract ${status}: ${reason}`, author: actor });
  }
  await contract.save();

  // Invoices and payments are intentionally left untouched — they remain as
  // unpaid/overdue records until staff explicitly cancel or write them off.

  const nextContract = await Contract.findOne({
    unit: contract.unit,
    status: { $in: ['draft', 'pending_signature'] },
  })
    .sort({ startDate: 1, createdAt: 1 })
    .select('_id startDate status');

  if (nextContract && new Date(nextContract.startDate) <= new Date()) {
    nextContract.status = 'active';
    await nextContract.save();
  }

  const closeUnitIds = contract.units?.length ? contract.units : [contract.unit];
  await Promise.all(closeUnitIds.map((uid) => syncUnitStatus(uid)));
  res.json(await populateAll(Contract.findById(contract._id)));
}

router.post('/:id/end', (req, res) => closeContract(req, res, 'ended'));
router.post('/:id/cancel', (req, res) => closeContract(req, res, 'cancelled'));

// Reactivate an ended or cancelled contract — sets status back to active and updates unit.
router.post('/:id/reactivate', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!['ended', 'cancelled'].includes(contract.status)) {
      return res.status(409).json({ error: `Only ended or cancelled contracts can be reactivated` });
    }

    contract.status = 'active';
    contract.archived = false;
    // If the end date is in the past, optionally extend it (caller can edit after)
    if (!contract.timeline) contract.timeline = [];
    const actor = req.user?.name || req.user?.email || '';
    contract.timeline.push({ at: new Date(), text: `Contract reactivated`, author: actor });
    await contract.save();

    const unitIds = contract.units?.length ? contract.units : [contract.unit];
    await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));

    res.json(await populateAll(Contract.findById(contract._id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sign a contract in person — capture a drawn or typed signature, stamp it on the PDF,
// archive the signed copy, and activate the contract.
router.post('/:id/sign-inperson', async (req, res) => {
  try {
    const { signerName, signatureDataUrl, signMode } = req.body;
    if (!signerName?.trim()) return res.status(400).json({ error: 'Signer name is required' });

    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!['draft', 'pending_signature'].includes(contract.status)) {
      return res.status(409).json({ error: `Cannot sign a ${contract.status} contract` });
    }
    const approvalError = approvalBlocksBooking(contract);
    if (approvalError) return res.status(403).json({ error: approvalError });

    const now = new Date();
    let pdfBuffer = await buildContractPdf(contract, now);
    pdfBuffer = await stampSignature(pdfBuffer, { signerName, signatureDataUrl, signMode, signedAt: now });

    const stored = await uploadFile({
      buffer: pdfBuffer,
      filename: `${contract.contractNo}-signed.pdf`,
      mimeType: 'application/pdf',
    });

    await Document.create({
      contract: contract._id,
      customer: contract.customer._id,
      name: `${contract.contractNo} — signed contract`,
      type: 'contract',
      ...stored,
    });

    contract.status = 'active';
    contract.signedDocUrl = stored.url;
    await contract.save();

    const signedUnitIds = contract.units?.length
      ? contract.units.map((u) => u._id ?? u)
      : [contract.unit._id];
    await Promise.all(signedUnitIds.map((uid) => syncUnitStatus(uid)));

    res.json(await populateAll(Contract.findById(contract._id)));
  } catch (err) {
    console.error('sign-inperson error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update editable fields on a contract (rate, deposit, dates, notes, payment method).
// Primary unit cannot be changed, but the additional units[] array can be updated here.
router.put('/:id', async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Once booked (active), only an admin may edit the contract terms — except
    // renewalIntent alone, which sales reps update from the renewal-calling
    // queue on contracts that are, by definition, always active.
    const isRenewalIntentOnly = Object.keys(req.body).length > 0 && Object.keys(req.body).every((k) => k === 'renewalIntent');
    if (contract.status === 'active' && req.user.role !== 'admin' && !isRenewalIntentOnly) {
      return res.status(403).json({ error: 'Only an admin can edit a booked contract' });
    }

    // Use $set to avoid VersionError from concurrent background writes on this document
    const $set = {};
    const numericFields = ['rate', 'deposit', 'totalQuotation', 'firstMonthDiscountPct', 'leasedPrice', 'manualReceived'];
    const allowed = ['rate', 'deposit', 'startDate', 'endDate', 'billingPeriod', 'paymentMethod', 'firstPaymentDate', 'notes', 'totalQuotation', 'firstMonthDiscountPct', 'leasedPrice', 'manualReceived', 'agreementText', 'renewalIntent'];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (key.endsWith('Date')) {
        if (!req.body[key]) { $set[key] = null; continue; }
        const d = new Date(req.body[key]);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `${key} is not a valid date` });
        $set[key] = d;
      } else if (numericFields.includes(key)) {
        // null clears the manual Received override back to payments-derived
        if (key === 'manualReceived' && req.body[key] === null) { $set[key] = null; continue; }
        const n = Number(req.body[key]);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${key} must be a number of 0 or more` });
        $set[key] = key === 'firstMonthDiscountPct' ? Math.min(100, n) : n;
      } else {
        $set[key] = req.body[key];
      }
    }

    if ($set.startDate && $set.endDate && $set.endDate <= $set.startDate) {
      return res.status(400).json({ error: 'Check out must be after check in' });
    }
    const effectiveStart = $set.startDate || contract.startDate;
    const effectiveEnd = $set.endDate || contract.endDate;
    if (effectiveStart && effectiveEnd && effectiveEnd <= effectiveStart) {
      return res.status(400).json({ error: 'Check out must be after check in' });
    }

    // Allow updating the full units array (primary unit stays in contract.unit, array holds all).
    if (Array.isArray(req.body.units)) {
      const before = (contract.units || []).map((u) => String(u));
      const after = [...new Set(req.body.units.filter(Boolean).map((u) => String(u)))];
      const bad = after.find((u) => !isValidObjectId(u));
      if (bad) return res.status(400).json({ error: `Invalid unit id: ${bad}` });
      if (!after.length) return res.status(400).json({ error: 'A contract needs at least one unit' });

      const claimed = after.filter((u) => !before.includes(u));
      const released = before.filter((u) => !after.includes(u));

      // Any unit can be shared, so an existing tenancy no longer blocks a
      // second contract on the same unit. Overlaps are recorded on the
      // timeline instead of refused, so a genuine mistake is still traceable.
      if (claimed.length) {
        const clash = await Contract.findOne({
          _id: { $ne: contract._id },
          status: 'active',
          units: { $in: claimed },
        }).populate('units', 'unitNumber shared').lean();
        if (clash) {
          const taken = (clash.units || []).find((u) => claimed.includes(String(u._id)));
          if (taken) {
            contract.timeline.push({
              at: new Date(),
              type: 'edit',
              text: `Unit ${taken.unitNumber} is also on contract ${clash.contractNo} — booked as a shared unit`,
              user: req.user?.name || req.user?.email || 'user',
            });
          }
        }
      }

      $set.units = after;
      $set.unit = after[0];

      if (contract.status === 'active') {
        for (const unitId of released) {
          const stillHeld = await Contract.countDocuments({
            _id: { $ne: contract._id }, status: 'active', units: unitId,
          });
          if (!stillHeld) await Unit.updateOne({ _id: unitId }, { $set: { status: 'available' } });
        }
        if (claimed.length) {
          await Unit.updateMany({ _id: { $in: claimed } }, { $set: { status: 'occupied' } });
        }
      }
    }

    if (req.body.unitSizes && typeof req.body.unitSizes === 'object') {
      const onContract = new Set(($set.units || contract.units || []).map((u) => String(u)));
      for (const [unitId, sqf] of Object.entries(req.body.unitSizes)) {
        if (!isValidObjectId(unitId) || !onContract.has(String(unitId))) continue;
        const n = Number(sqf);
        if (Number.isFinite(n) && n > 0) await Unit.updateOne({ _id: unitId }, { $set: { sizeSqf: n } });
      }
    }

    // Per-unit ledger rows from the Units tab. Only units actually on this
    // contract get a line; every money/date field is optional and null means
    // "inherit the contract value", so a partially filled row is legal.
    if (Array.isArray(req.body.unitLines)) {
      const onContractLines = new Set(($set.units || contract.units || []).map((u) => String(u)));
      const lines = [];
      for (const raw of req.body.unitLines) {
        const unitId = String(raw?.unit || '');
        if (!isValidObjectId(unitId) || !onContractLines.has(unitId)) continue;
        const line = { unit: unitId };
        for (const key of ['checkIn', 'checkOut']) {
          if (raw[key] === undefined || raw[key] === null || raw[key] === '') { line[key] = null; continue; }
          const d = new Date(raw[key]);
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `unitLines.${key} is not a valid date` });
          line[key] = d;
        }
        if (line.checkIn && line.checkOut && line.checkOut <= line.checkIn) {
          return res.status(400).json({ error: 'Check out must be after check in' });
        }
        for (const key of ['leaseRate', 'received', 'pending']) {
          if (raw[key] === undefined || raw[key] === null || raw[key] === '') { line[key] = null; continue; }
          const n = Number(raw[key]);
          if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `unitLines.${key} must be a number of 0 or more` });
          line[key] = n;
        }
        lines.push(line);
      }
      $set.unitLines = lines;
    }

    if (req.body.accessType !== undefined) {
      const v = String(req.body.accessType || '').toLowerCase();
      if (!['', 'private', 'shared'].includes(v)) return res.status(400).json({ error: 'accessType must be private or shared' });
      $set.accessType = v;
    }

    if (req.body.renewalIntent !== undefined) {
      const v = String(req.body.renewalIntent || 'undecided');
      if (!['undecided', 'renewing', 'not_renewing'].includes(v)) {
        return res.status(400).json({ error: 'renewalIntent must be undecided, renewing, or not_renewing' });
      }
      $set.renewalIntent = v;
    }

    // Per-contract reminder settings (Reminders tab)
    if (req.body.remindersMuted !== undefined) $set.remindersMuted = !!req.body.remindersMuted;
    if (Array.isArray(req.body.reminderOverrides)) {
      $set.reminderOverrides = req.body.reminderOverrides
        .filter((o) => o && isValidObjectId(String(o.rule)))
        .map((o) => ({ rule: String(o.rule), enabled: !!o.enabled }));
    }

    if (Array.isArray(req.body.authorizedPersons)) {
      $set.authorizedPersons = req.body.authorizedPersons
        .map((p) => ({
          name: String(p.name || '').trim(),
          phone: String(p.phone || '').trim(),
          relation: String(p.relation || '').trim(),
          idType: String(p.idType || '').trim(),
          idNumber: String(p.idNumber || '').trim(),
        }))
        .filter((p) => p.name);
    }

    // Log what was changed to the contract timeline with values
    const fieldLabels = { rate: 'Asking Price', deposit: 'Deposit', totalQuotation: 'Total Quotation', leasedPrice: 'Leased Price', manualReceived: 'Received', startDate: 'Check In', endDate: 'Check Out', billingPeriod: 'Billing Period', paymentMethod: 'Payment Method', firstPaymentDate: 'First Payment Date', firstMonthDiscountPct: 'First Month Discount', remindersMuted: 'Reminders muted', renewalIntent: 'Renewal intent' };
    const renewalIntentLabels = { undecided: 'Undecided', renewing: 'Renewing', not_renewing: 'Not renewing' };
    const changedKeys = Object.keys($set).filter(k => !['authorizedPersons', 'reminderOverrides', 'agreementText'].includes(k));
    if (changedKeys.length) {
      const who = req.user?.name || req.user?.email || 'System';
      const details = changedKeys.map(k => `${fieldLabels[k] || k}: ${k === 'renewalIntent' ? (renewalIntentLabels[$set[k]] || $set[k]) : $set[k] instanceof Date ? $set[k].toISOString().slice(0, 10) : $set[k]}`).join(', ');
      const $push = { timeline: { text: `Updated ${details}`, author: who, at: new Date() } };
      // Every Check Out change on an existing contract is a renewal/extension
      // worth its own trackable record, separate from the general timeline.
      if ($set.endDate && contract.endDate && $set.endDate.getTime() !== new Date(contract.endDate).getTime()) {
        $push.renewalHistory = { at: new Date(), previousEndDate: contract.endDate, newEndDate: $set.endDate, author: who };
      }
      await Contract.findByIdAndUpdate(contract._id, { $set, $push });
    } else {
      await Contract.findByIdAndUpdate(contract._id, { $set });
    }
    const populated = await populateAll(Contract.findById(contract._id));
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extend an active contract to a new end date and generate invoices for the new period.
// Optionally creates a fresh signing token so the customer can re-sign the extended agreement.
router.post('/:id/extend', async (req, res) => {
  try {
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (['ended', 'cancelled'].includes(contract.status)) {
      return res.status(409).json({ error: 'Cannot extend an ended or cancelled contract' });
    }

    const { newEndDate, allowReSign = false } = req.body;
    if (!newEndDate) return res.status(400).json({ error: 'newEndDate is required' });

    const newEnd = new Date(newEndDate);
    if (contract.endDate && newEnd <= new Date(contract.endDate)) {
      return res.status(400).json({ error: 'New end date must be after the current end date' });
    }

    contract.endDate = newEnd;

    let signingUrl = null;
    let signingTokenExpiry = null;
    if (allowReSign) {
      const token = crypto.randomBytes(32).toString('hex');
      contract.signingToken = token;
      contract.signingTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      signingTokenExpiry = contract.signingTokenExpiry;
      const baseUrl = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
      signingUrl = `${baseUrl}/sign/${token}`;
    }

    await contract.save();

    res.json({ extended: true, generated: 0, signingUrl, signingTokenExpiry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-delete', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  const uniqueIds = Array.from(new Set(ids));
  const contracts = await Contract.find({ _id: { $in: uniqueIds } });

  if (!contracts.length) {
    return res.status(404).json({ error: 'No contracts found' });
  }

  const activeContract = contracts.find((contract) => contract.status === 'active');
  if (activeContract) {
    return res.status(409).json({ error: `Cannot delete active contract ${activeContract.contractNo}. End or cancel it first.` });
  }

  for (const contract of contracts) {
    await deleteContractRecord(contract);
  }

  res.json({ ok: true, deleted: contracts.length, requested: uniqueIds.length });
});

// Delete a contract and all its payments / documents.
// Active contracts cannot be deleted — end or cancel them first.
router.delete('/:id', requireAdmin, async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  try {
    await deleteContractRecord(contract);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }

  res.json({ ok: true });
});

// Archive/unarchive a contract. Hides it from the default contracts list without
// deleting its payment/document history — used when deletion is blocked because
// paid payments must be retained.
router.patch('/:id/archive', async (req, res) => {
  const archived = req.body?.archived !== false;
  const contract = await Contract.findByIdAndUpdate(
    req.params.id,
    { archived },
    { new: true }
  );
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json({ ok: true, contract });
});

// Flexible invoice generator — called from the UI modal.
// Body: { startDate, endDate, dueDate, notes, discountPct } for a period invoice
//       { isDeposit: true, dueDate, notes }                 for a security deposit invoice
// After creating the invoice, Payment entries are inserted for each week (linked via invoice field).
router.post('/:id/generate-custom-invoice', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!contract.customer?._id) return res.status(400).json({ error: 'Contract has no customer' });

  const { startDate, endDate, dueDate, notes, isDeposit, discountPct: rawDiscount, extraItems: rawExtras, items: rawItems } = req.body;
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const unitNo = contract.unit?.unitNumber || '-';

  // ── Security deposit invoice ──────────────────────────────────────────────
  if (isDeposit) {
    const amount = Number(contract.deposit || 0);
    if (!amount) return res.status(400).json({ error: 'No deposit amount set on this contract' });
    const invoice = await Invoice.create({
      invoiceNo: await nextInvoiceNo(unitNo, contract._id),
      customer: contract.customer._id,
      invoiceDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      orderNumber: contract.contractNo,
      terms: 'Due on receipt',
      subject: `Security Deposit — ${contract.contractNo} · Unit ${unitNo}`,
      items: [{ sortOrder: 0, itemDetails: `Security deposit · Unit ${unitNo}`, quantity: 1, rate: amount, discountPct: 0, amount }],
      customerNotes: notes || '',
      subTotal: amount, total: amount, paymentMade: 0, status: 'sent',
    });
    // Create a single pending payment entry linked to this invoice
    await Payment.create({
      contract: contract._id,
      invoice: invoice._id,
      amount,
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      status: 'pending',
      notes: notes || 'Security deposit',
    });
    return res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
  }

  // ── Period invoice (weekly breakdown) ────────────────────────────────────
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.round((end - start) / 86400000);
  if (totalDays <= 0) return res.status(400).json({ error: 'End date must be after start date' });

  // rate is monthly price; weekly payment = rate / 4. Ceiling: any leftover day = full week.
  const monthlyRate = Number(contract.rate || 0);
  const weeklyRate = Math.round((monthlyRate / 4) * 100) / 100;
  const totalWeeks = Math.ceil(totalDays / 7);
  const discountPct = Math.max(0, Math.min(100, Number(rawDiscount || 0)));

  // Global week offset from contract start → discount only applies to first 4 weeks of entire contract.
  const contractStart = new Date(contract.startDate);
  const daysSinceStart = Math.round((start - contractStart) / 86400000);
  const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7));

  // Build per-week payment amounts (discount only on first 4 weeks of contract)
  const weekAmounts = [];
  for (let i = 0; i < totalWeeks; i++) {
    const discounted = discountPct > 0 && (globalWeekOffset + i) < 4;
    weekAmounts.push(discounted
      ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
      : weeklyRate);
  }
  const periodSubTotal = Math.round(weekAmounts.reduce((s, a) => s + a, 0) * 100) / 100;
  const hasDiscount = discountPct > 0 && globalWeekOffset < 4;
  const displayEnd = fmt(new Date(end - 86400000));

  // One invoice line item for the whole month period — quantity = weeks, rate = weekly rate
  const items = [{
    sortOrder: 0,
    itemDetails: `Storage rental — Unit ${unitNo}, ${fmt(start)} – ${displayEnd}`,
    quantity: totalWeeks,
    rate: weeklyRate,
    discountPct: hasDiscount ? discountPct : 0,
    amount: periodSubTotal,
  }];

  // First invoice for this contract: prepend security deposit (= 1 month rent, no discount)
  const priorInvoiceIds = await Payment.distinct('invoice', { contract: contract._id, invoice: { $ne: null } });
  if (priorInvoiceIds.filter(Boolean).length === 0) {
    items.push({
      sortOrder: 1,
      itemDetails: `Security Deposit · Unit ${unitNo}`,
      quantity: 1,
      rate: monthlyRate,
      discountPct: 0,
      amount: monthlyRate,
    });
  }

  // Append any extra charges / credits (locks, cleaning fees, credits, etc.)
  const extras = Array.isArray(rawExtras) ? rawExtras : [];
  extras.forEach((x, xi) => {
    if (!x.description || !Number(x.amount)) return;
    const amt = Math.round(Number(x.amount) * 100) / 100;
    const signed = x.type === 'credit' ? -amt : amt;
    items.push({
      sortOrder: 2 + xi,
      itemDetails: x.description,
      quantity: 1,
      rate: signed,
      discountPct: 0,
      amount: signed,
    });
  });

  // Line items typed into the invoice form win over the date-derived rent
  // line — otherwise the amounts entered there are silently replaced.
  const explicitItems = (Array.isArray(rawItems) ? rawItems : [])
    .map((it, i) => ({
      sortOrder: i,
      itemDetails: String(it.description ?? it.itemDetails ?? '').trim(),
      quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
      rate: Number(it.rate ?? 0),
      discountPct: Number(it.discountPct || 0),
      amount: Math.round(Number(it.amount ?? 0) * 100) / 100,
    }))
    .filter((it) => it.itemDetails && it.amount !== 0);

  const finalItems = explicitItems.length ? explicitItems : items;
  const subTotal = Math.round(finalItems.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  const invoice = await Invoice.create({
    invoiceNo: await nextInvoiceNo(unitNo, contract._id),
    customer: contract.customer._id,
    invoiceDate: new Date(),
    dueDate: dueDate ? new Date(dueDate) : end,
    orderNumber: contract.contractNo,
    terms: 'Due on receipt',
    subject: explicitItems.length
      ? `${finalItems[0].itemDetails} · ${contract.contractNo}`
      : `Storage Rent ${fmt(start)} – ${displayEnd} · ${contract.contractNo}`,
    items: finalItems,
    customerNotes: notes || '',
    subTotal, total: subTotal, paymentMade: 0, status: 'sent',
  });

  // One payment record covering what was actually invoiced. The billed period
  // is always recorded, since the due date can be any day (typically today)
  // and the billing plan needs to know which month this invoice belongs to.
  const periodTag = `${fmt(start)} – ${displayEnd}`;
  await Payment.create({
    contract: contract._id,
    invoice: invoice._id,
    amount: explicitItems.length ? subTotal : periodSubTotal,
    dueDate: dueDate ? new Date(dueDate) : start,
    status: 'pending',
    notes: explicitItems.length
      ? `${finalItems[0].itemDetails} · ${periodTag} · Unit ${unitNo}`
      : `Storage Rent ${periodTag} · Unit ${unitNo}`,
  });

  // If first invoice, also add the deposit payment record. Skipped for custom
  // invoices — those bill exactly the lines the user entered.
  const isFirstInvoice = priorInvoiceIds.filter(Boolean).length === 0 && !explicitItems.length;
  if (isFirstInvoice) {
    await Payment.create({
      contract: contract._id,
      invoice: invoice._id,
      amount: monthlyRate,
      dueDate: dueDate ? new Date(dueDate) : start,
      status: 'pending',
      notes: `Security deposit · Unit ${unitNo}`,
    });
  }

  res.status(201).json(await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'));
});

// Add a timeline note to a contract
router.post('/:id/notes', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Note text is required' });
  const contract = await Contract.findByIdAndUpdate(
    req.params.id,
    { $push: { timeline: { text, author: String(req.body?.author || '') } } },
    { new: true }
  );
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(contract.timeline);
});

// Edit a timeline note by index
router.put('/:id/notes/:idx', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Note text is required' });
  const idx = Number(req.params.idx);
  const contract = await Contract.findByIdAndUpdate(
    req.params.id,
    { $set: { [`timeline.${idx}.text`]: text } },
    { new: true }
  );
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  res.json(contract.timeline);
});

// Pin or unpin a timeline note by index
router.put('/:id/notes/:idx/pin', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  contract.timeline[idx].pinned = Boolean(req.body?.pinned);
  await contract.save({ timestamps: false, versionKey: false });
  res.json(contract.timeline);
});

// Correct a timeline entry's wording.
//
// The timeline is otherwise append-only with a delete but no edit, so a record
// written wrongly could only be removed, taking the fact that it happened with
// it. Used to repair entries that logged a template's placeholders instead of
// the text a tenant actually received.
router.patch('/:id/notes/:idx', requireAdmin, async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text is required' });
  contract.timeline[idx].text = text;
  await contract.save({ timestamps: false, versionKey: false });
  res.json(contract.timeline[idx]);
});

// Delete a timeline note by index
router.delete('/:id/notes/:idx', async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.timeline.length) {
    return res.status(400).json({ error: 'Invalid note index' });
  }
  contract.timeline.splice(idx, 1);
  await contract.save({ timestamps: false, versionKey: false });
  res.json(contract.timeline);
});

// Download the (unsigned) contract PDF.
// A notice template merged with this contract's details, ready to edit/send
router.get('/:id/notice/:templateId', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.templateId)) return res.status(400).json({ error: 'Invalid template id' });
    const [contract, tpl] = await Promise.all([
      populateAll(Contract.findById(req.params.id)),
      AgreementTemplate.findById(req.params.templateId).lean(),
    ]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json({ name: tpl.name, text: mergeAgreementText(tpl.body, contract) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PDF of (possibly edited) notice content for this contract
router.post('/:id/notice-pdf', async (req, res) => {
  try {
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const html = String(req.body?.html || '');
    if (!html.trim()) return res.status(400).json({ error: 'Notice content is empty' });
    const title = String(req.body?.title || 'Notice').toUpperCase();
    const pdf = looksLikeHtml(html)
      ? await renderAgreementHtmlPdf({ html, contract, title, header: false, signature: false })
      : await renderAgreementTextPdf({ text: html, contract, header: false, signature: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email the notice (PDF attached) to the tenant and log it on the timeline
// Merge a message template against this contract. Returns the filled subject
// and bodies so the composer can show exactly what will go out, and be edited
// before it does.
// Templates use @name placeholders, matching the automation engine.
function interpolateVars(text, vars) {
  return String(text || '').replace(/@(\w+)/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
}

function findUnfilled(text, vars) {
  const seen = new Set();
  for (const m of String(text || '').matchAll(/@(\w+)/g)) {
    if (vars[m[1]] === undefined) seen.add(m[1]);
  }
  return [...seen];
}

async function contractTemplateVars(contract) {
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const units = contract.units?.length > 1
    ? contract.units.map((u) => u.unitNumber).join(', ')
    : (contract.unit?.unitNumber ?? '');

  const payments = await Payment.find({ contract: contract._id }).lean();
  const now = Date.now();
  const unpaid = payments.filter((p) => p.status !== 'paid');
  const overdue = unpaid.filter((p) => new Date(p.dueDate).getTime() < now);
  const nextDue = unpaid
    .filter((p) => new Date(p.dueDate).getTime() >= now)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    name: contract.customer?.fullName || '',
    email: contract.customer?.email || '',
    phone: contract.customer?.phone || '',
    unit: units,
    contractNo: contract.contractNo || '',
    startDate: fmt(contract.startDate),
    endDate: fmt(contract.endDate),
    daysLeft: contract.endDate
      ? String(Math.ceil((new Date(contract.endDate).getTime() - now) / 86400000))
      : '',
    rate: String(round2(Number(contract.rate || 0))),
    // The one-click answers, and the late fee. Absent here, so the expiry
    // template's buttons went out as the literal words @renewLink and
    // @moveOutLink.
    renewLink: renewLink(contract._id),
    moveOutLink: moveOutLink(contract._id),
    lateFee: process.env.LATE_FEE_AMOUNT || 'AED 100',
    amountOverdue: String(round2(overdue.reduce((sum, p) => sum + Number(p.amount || 0), 0))),
    nextDueDate: nextDue ? fmt(nextDue.dueDate) : '',
    nextDueAmount: nextDue ? String(round2(Number(nextDue.amount || 0))) : '',
  };
}

router.get('/:id/message-template/:templateId', async (req, res) => {
  try {
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const template = await MessageTemplate.findById(req.params.templateId).lean();
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const vars = await contractTemplateVars(contract);
    res.json({
      to: contract.customer?.email || '',
      label: template.label || '',
      subject: interpolateVars(template.subject, vars),
      // The designed version when the template has one. This was reading
      // emailBody — the plain-text alternative — so a template with a full
      // HTML design went out as a wall of unformatted text.
      html: interpolateVars(template.emailHtml || template.emailBody, vars),
      whatsapp: interpolateVars(template.whatsappBody, vars),
      // Named so the composer can flag placeholders this contract cannot fill.
      unfilled: findUnfilled([template.subject, template.emailHtml || template.emailBody].join(' '), vars),
      // So the composer can tell a designed email from a plain one, and not
      // present raw HTML in a plain-text box.
      isHtml: Boolean(template.emailHtml),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send a composed template email. The body IS the email here — unlike
// notice-email, which attaches a rendered PDF and sends fixed covering text.
router.post('/:id/template-email', async (req, res) => {
  try {
    if (!mailConfigured()) return res.status(501).json({ error: 'Email is not configured' });
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const to = String(req.body?.to || contract.customer?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Tenant has no email address' });
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    const html = String(req.body?.html || '').trim();
    if (!html) return res.status(400).json({ error: 'Message body is required' });

    await sendMail({
      to,
      subject,
      html,
      text: html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
    });

    const actor = req.user?.name || req.user?.email || '';
    // Log the subject the tenant actually received, not the template's name.
    await Contract.findByIdAndUpdate(contract._id, {
      $push: { timeline: { at: new Date(), text: `Email "${subject}" sent to ${to}`, author: actor } },
    });

    res.json({ ok: true, to });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/notice-email', async (req, res) => {
  try {
    if (!mailConfigured()) return res.status(501).json({ error: 'SMTP is not configured' });
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const to = String(req.body?.to || contract.customer?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Tenant has no email address' });

    const html = String(req.body?.html || '');
    if (!html.trim()) return res.status(400).json({ error: 'Notice content is empty' });
    const title = String(req.body?.title || 'Notice');
    const pdf = looksLikeHtml(html)
      ? await renderAgreementHtmlPdf({ html, contract, title: title.toUpperCase(), header: false, signature: false })
      : await renderAgreementTextPdf({ text: html, contract, header: false, signature: false });

    await sendMail({
      to,
      subject: `${title} — ${contract.contractNo} · PurpleBox Storage`,
      text: `Dear ${contract.customer?.fullName || ''},

Please find the attached ${title.toLowerCase()} regarding your storage contract ${contract.contractNo}.

PurpleBox Storage`,
      html: `Dear ${contract.customer?.fullName || ''},<br/><br/>Please find the attached ${title.toLowerCase()} regarding your storage contract ${contract.contractNo}.<br/><br/>PurpleBox Storage`,
      attachments: [{ filename: `${title}-${contract.contractNo}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    const actor = req.user?.name || req.user?.email || '';
    await Contract.findByIdAndUpdate(contract._id, {
      $push: { timeline: { at: new Date(), text: `Notice "${title}" emailed to ${to}`, author: actor } },
    });
    res.json({ sent: true, to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The agreement wording for this contract, ready to edit: the saved
// per-contract text, else the app template with placeholders resolved.
router.get('/:id/agreement', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const own = String(contract.agreementText || '').trim();
  if (own) return res.json({ text: own, source: 'contract' });
  const tpl = await AgreementTemplate.findOne({ $or: [{ isDefault: true }, { key: 'default' }] })
    .sort({ isDefault: -1 }).lean();
  if (tpl?.body?.trim()) {
    return res.json({ text: mergeAgreementText(tpl.body, contract), source: 'template' });
  }
  res.json({ text: '', source: 'none' });
});

router.get('/:id/pdf', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const pdf = await buildContractPdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
});

// Send contract PDF via email
/**
 * Send one approved WhatsApp template to this contract's tenant, now.
 *
 * The same thing the reminder engine sends on a schedule, aimed at one person
 * by somebody who decided to. That is the point: the scheduled version is off
 * until it is trusted, and until then this is how a renewal notice actually
 * goes out — with a human choosing the moment.
 *
 * It fills the template from the contract, so nobody retypes a contract number
 * into a message and gets it wrong.
 */
router.post('/:id/whatsapp-template', async (req, res) => {
  try {
    const contract = await populateAll(Contract.findById(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!whatsappSendConfigured()) return res.status(400).json({ error: 'WhatsApp is not configured' });

    const phone = contract.customer?.phone || contract.customer?.phones?.[0];
    if (!phone) return res.status(400).json({ error: 'This tenant has no phone number' });

    const tpl = await MessageTemplate.findById(req.body?.templateId).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!String(tpl.whatsappTemplate || '').trim()) {
      return res.status(400).json({ error: `"${tpl.label}" has no approved WhatsApp template. Add one in Settings → Message Templates.` });
    }

    // The same names the reminder engine uses, so a template written for the
    // scheduled version works here unchanged.
    const units = (contract.units?.length ? contract.units : contract.unit ? [contract.unit] : [])
      .map((u) => u?.unitNumber).filter(Boolean);
    const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
    const vars = {
      name: contract.customer?.fullName || '',
      contractNo: contract.contractNo || '',
      unit: units.join(', '),
      endDate: fmt(contract.endDate),
      startDate: fmt(contract.startDate),
      dueDate: fmt(contract.endDate),
      rate: contract.rate != null ? Number(contract.rate).toFixed(2) : '',
      renewLink: renewLink(contract._id),
      moveOutLink: moveOutLink(contract._id),
    };

    const variables = (tpl.whatsappTemplateVars || []).map((k) => String(vars[k] ?? ''));
    const name = String(tpl.whatsappTemplate).trim();

    await sendWhatsAppTemplate({
      to: phone,
      name,
      language: String(tpl.whatsappTemplateLang || 'en').trim() || 'en',
      variables,
    });

    // Everything sent to a tenant belongs on the activity feed, the same as
    // the email above.
    await Contract.findByIdAndUpdate(contract._id, {
      $push: {
        timeline: {
          at: new Date(),
          text: `WhatsApp "${tpl.label}" sent to ${phone}`,
          author: req.user?.name || req.user?.email || '',
        },
      },
    });
    await AutomationLog.create({
      ruleName: 'Sent by hand', channel: 'whatsapp', contract: contract._id,
      customer: contract.customer?._id, event: `manual:${name}:${contract._id}:${Date.now()}`,
      message: `${name}(${variables.join(', ')})`, status: 'sent',
    });

    res.json({ ok: true, to: phone, template: name, variables });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/:id/send-email', async (req, res) => {
  const contract = await populateAll(Contract.findById(req.params.id));
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!mailConfigured()) return res.status(400).json({ error: 'SMTP not configured' });
  const email = contract.customer?.email;
  if (!email) return res.status(400).json({ error: 'Customer has no email address' });
  const pdf = await buildContractPdf(contract);
  await sendMail({
    to: email,
    subject: `Your Storage Contract ${contract.contractNo} — PurpleBox`,
    text: `Dear ${contract.customer.fullName},\n\nPlease find your storage contract ${contract.contractNo} attached.\n\nThank you,\nPurpleBox`,
    html: `<p>Dear ${contract.customer.fullName},</p><p>Please find your storage contract <strong>${contract.contractNo}</strong> attached.</p><p>Thank you,<br/>PurpleBox</p>`,
    attachments: [{ filename: `${contract.contractNo}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  // Everything sent to a tenant belongs on the activity feed.
  await Contract.findByIdAndUpdate(contract._id, {
    $push: {
      timeline: {
        at: new Date(),
        text: `Email "Your Storage Contract ${contract.contractNo} — PurpleBox" sent to ${email}`,
        author: req.user?.name || req.user?.email || '',
      },
    },
  });

  res.json({ ok: true });
});

export default router;
