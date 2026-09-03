import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Customer, Contract, Document, Payment, Invoice, Unit, Quote } from '../models/index.js';
import { stageCounts, stageFilter } from '../services/customerStage.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { requireAdmin } from '../middleware/auth.js';
import { phoneClauses } from '../utils/phoneSearch.js';
import { mailConfigured, mailFromAddress, sendMail } from '../services/mail.js';
import { fillPlaceholders, leftoverPlaceholders } from '../services/emailPlaceholders.js';
import { zohoBooksConfigured, findZohoContactsFor, fetchZohoInvoicesForContacts, fetchZohoInvoicePdf, zohoOutstandingByCustomer } from '../services/zohoBooks.js';

const router = Router();


async function deleteCustomerCascade(customerId) {
  const contracts = await Contract.find({ customer: customerId });
  for (const contract of contracts) {
    const allUnitIds = contract.units?.length ? contract.units : [contract.unit];
    await Payment.deleteMany({ contract: contract._id });
    await Document.deleteMany({ contract: contract._id });
    await Invoice.deleteMany({ orderNumber: contract.contractNo });
    await contract.deleteOne();
    await Promise.all(allUnitIds.map((uid) => syncUnitStatus(uid)));
  }
  await Invoice.deleteMany({ customer: customerId });
  await Document.deleteMany({ customer: customerId });
  await Quote.deleteMany({ customer: customerId });
  await Customer.findByIdAndDelete(customerId);
}

function escRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RENEWAL_INTENTS = new Set(['undecided', 'renewing', 'not_renewing']);

router.get('/', async (req, res) => {
  const filter = {};

  /* Tenants, or people we have only quoted.
   *
   * Absent on purpose means everybody. Every quote, booking and invoice screen
   * searches this endpoint to find somebody to raise a document for, and a
   * prospect is exactly who those are raised for — filtering by default would
   * hide the people the feature exists to serve. The tenant list asks for
   * `stage=customer`; the pickers ask for nothing. */
  Object.assign(filter, stageFilter(String(req.query.stage || '').trim()));

  // Renewal intent lives on the contract, not the tenant, so narrow to the
  // customers whose *active* contract carries it. An ended contract's intent is
  // history and must not put someone back on the calling list.
  const renewal = String(req.query.renewal || '').trim();
  if (RENEWAL_INTENTS.has(renewal)) {
    const contracts = await Contract.find({
      status: 'active',
      // Older contracts predate the field, and an absent value means undecided.
      ...(renewal === 'undecided'
        ? { $or: [{ renewalIntent: 'undecided' }, { renewalIntent: { $exists: false } }, { renewalIntent: '' }] }
        : { renewalIntent: renewal }),
    }).select('customer').lean();
    filter._id = { $in: [...new Set(contracts.map((c) => String(c.customer)))] };
  }

  if (req.query.search) {
    const re = new RegExp(escRegex(req.query.search), 'i');
    filter.$or = [
      { fullName: re },
      { clientId: re },
      { email: re },
      { phone: re },
      { phones: re },
      { emergencyNumber: re },
      { nationality: re },
      { address: re },
      { company: re },
      { emiratesId: re },
      { passportNumber: re },
      { notes: re },
      { tenantType: re },
      // Digits-only match so a local number finds an international one
      ...phoneClauses(req.query.search),
    ];
  }

  const sortKey = String(req.query.sort || 'date_added_desc');
  let sort = { createdAt: -1, _id: -1 };
  if (sortKey === 'name_asc') sort = { fullName: 1, _id: -1 };
  else if (sortKey === 'name_desc') sort = { fullName: -1, _id: -1 };
  else if (sortKey === 'date_added_asc') sort = { createdAt: 1, _id: 1 };

  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 9999);
  const skip  = (page - 1) * limit;

  // Who owes money, from Zoho. This has to be resolved before paging, because
  // the balance lives in Zoho and cannot be sorted or sliced by Mongo.
  const owingOnly = req.query.owing === 'true';
  let owed = null;
  let unmatchedOwing = 0;
  if (owingOnly && zohoBooksConfigured()) {
    const candidates = await Customer.find(filter).select('email phone phones').lean();
    const zoho = await zohoOutstandingByCustomer(candidates);
    owed = zoho.byCustomer;
    unmatchedOwing = zoho.unmatchedOwing;
    filter._id = {
      $in: [...owed.entries()].filter(([, v]) => v.outstanding > 0).map(([id]) => id),
    };
  }

  // .lean() skips Mongoose document hydration, which dominates this endpoint:
  // 274 customers took ~2.5s hydrated vs ~950ms lean. The response is read-only.
  const [customers, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);

  // The balance for whoever is on this page, so the amount can be shown next to
  // the name. Only for the page, so an unfiltered list costs nothing extra.
  let data = customers;
  if (zohoBooksConfigured() && customers.length) {
    const balances = owed ?? (await zohoOutstandingByCustomer(customers)).byCustomer;
    data = customers.map((c) => {
      const hit = balances.get(String(c._id));
      return hit ? { ...c, outstanding: hit.outstanding, zohoName: hit.zohoName } : c;
    });
  }

  res.json({
    data,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    // How many of each there are, so the tabs are counted over everybody
    // rather than over the page that happens to be loaded.
    stageCounts: await stageCounts(),
    // Balances Zoho holds that no tenant here could be matched to. Surfaced so
    // a short list is never mistaken for a complete one.
    ...(owingOnly ? { unmatchedOwing } : {}),
  });
});

router.get('/:id', async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const contracts = await Contract.find({ customer: customer._id })
    .populate('unit')
    .sort({ createdAt: -1 });
  const documents = await Document.find({ customer: customer._id }).sort({ createdAt: -1 });

  // All invoices across every contract this customer has ever had
  const contractNos = contracts.map(c => c.contractNo);
  const invoices = await Invoice.find({ orderNumber: { $in: contractNos } })
    .select('invoiceNo orderNumber status dueDate invoiceDate total paymentMade')
    .sort({ dueDate: -1 });

  // Payment summary per contract
  const contractIds = contracts.map(c => c._id);
  const allPayments = await Payment.find({ contract: { $in: contractIds } })
    .select('contract amount status paidDate method notes dueDate')
    .sort({ dueDate: -1 });

  const paymentSummary = contracts.map(c => {
    const cPayments = allPayments.filter(p => String(p.contract) === String(c._id));
    const totalPaid   = Math.round(cPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const totalUnpaid = Math.round(cPayments.filter(p => p.status !== 'paid').reduce((s, p) => s + p.amount, 0) * 100) / 100;
    return { contractId: c._id, contractNo: c.contractNo, totalPaid, totalUnpaid };
  });

  res.json({ customer, contracts, documents, invoices, paymentSummary });
});

// Zoho Books invoices for this person, matched on email/phone only — the two
// systems hold different names for the same customer.
router.get('/:id/zoho-invoices', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('email phone phones').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!zohoBooksConfigured()) return res.status(501).json({ error: 'Zoho Books is not configured' });

    const emails = [customer.email].filter(Boolean);
    const phones = [...(Array.isArray(customer.phones) ? customer.phones : []), customer.phone].filter(Boolean);

    const { contacts } = await findZohoContactsFor({ emails, phones });
    const { invoices } = await fetchZohoInvoicesForContacts(contacts.map((c) => c.id));

    const totals = invoices.reduce(
      (acc, inv) => ({
        count: acc.count + 1,
        total: Math.round((acc.total + inv.total) * 100) / 100,
        balance: Math.round((acc.balance + inv.balance) * 100) / 100,
      }),
      { count: 0, total: 0, balance: 0 },
    );

    // Deep link into Zoho Books' own invoice composer, pre-selecting the
    // matched contact when there is exactly one obvious candidate. The app
    // domain differs per data centre, hence the env override.
    const appBase = process.env.ZOHO_BOOKS_APP_BASE || 'https://books.zoho.com';
    const orgId = process.env.ZOHO_BOOKS_ORG_ID;
    const soleContactId = contacts.length === 1 ? contacts[0].id : null;
    const newInvoiceUrl = `${appBase}/app/${orgId}#/invoices/new`
      + (soleContactId ? `?customer_id=${encodeURIComponent(soleContactId)}` : '');

    res.json({
      configured: true,
      matchedContacts: contacts.map((c) => ({
        id: c.id, name: c.name, email: c.email, phone: c.phone || c.mobile || '', matchedBy: c.matchedBy,
      })),
      invoices,
      totals,
      newInvoiceUrl,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The PDF for one of this tenant's Zoho invoices. The invoice must belong to a
// Zoho contact that matches this customer — otherwise any authenticated user
// could pull an arbitrary invoice out of the accounting system by guessing ids.
router.get('/:id/zoho-invoices/:invoiceId/pdf', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('email phone phones').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!zohoBooksConfigured()) return res.status(501).json({ error: 'Zoho Books is not configured' });

    const emails = [customer.email].filter(Boolean);
    const phones = [...(Array.isArray(customer.phones) ? customer.phones : []), customer.phone].filter(Boolean);
    const { contacts } = await findZohoContactsFor({ emails, phones });
    const { invoices } = await fetchZohoInvoicesForContacts(contacts.map((c) => c.id));

    const invoice = invoices.find((i) => String(i.id) === String(req.params.invoiceId));
    if (!invoice) return res.status(404).json({ error: 'That invoice does not belong to this customer' });

    const { pdf } = await fetchZohoInvoicePdf(invoice.id);
    if (!pdf) return res.status(502).json({ error: 'Zoho Books returned no PDF' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(invoice.number || 'invoice').replace(/[^\w.-]/g, '_')}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  const customer = await Customer.create(req.body);
  res.status(201).json(customer);
});

router.put('/:id', async (req, res) => {
  /* Nobody who has signed can be turned back into a prospect.
   *
   * A contract is a fact about them, and a tenant whose contract ended is a
   * past tenant rather than somebody to prospect again. Ignored rather than
   * refused, so an edit form that happens to post the whole record back does
   * not fail on a field the person editing never touched. */
  if (req.body?.stage === 'prospect') {
    const signed = await Contract.exists({ customer: req.params.id });
    if (signed) delete req.body.stage;
  }
  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  await deleteCustomerCascade(req.params.id);
  res.json({ ok: true });
});

// Merge sourceId into targetId: move all invoices, then delete source
router.post('/:id/merge-into/:targetId', async (req, res) => {
  const { id, targetId } = req.params;
  if (id === targetId) return res.status(400).json({ error: 'Cannot merge a customer into itself' });
  const [source, target] = await Promise.all([
    Customer.findById(id),
    Customer.findById(targetId),
  ]);
  if (!source) return res.status(404).json({ error: 'Source customer not found' });
  if (!target) return res.status(404).json({ error: 'Target customer not found' });

  const result = await Invoice.updateMany({ customer: id }, { $set: { customer: targetId } });
  await Customer.findByIdAndDelete(id);
  res.json({ ok: true, invoicesMoved: result.modifiedCount, deletedCustomer: source.fullName, intoCustomer: target.fullName });
});

// Gmail rejects messages with too many recipients on one send; keep each
// batch comfortably under the ~100 cap.
const BCC_BATCH_SIZE = 90;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// One email to many customers, everyone in BCC so recipients can't see each
// other. Batched, and honest about partial failure — a later batch can fail
// after earlier ones already went out.
router.post('/send-email', requireAdmin, async (req, res) => {
  if (!mailConfigured()) return res.status(501).json({ error: 'Email is not configured — connect Gmail in Settings' });

  const ids = Array.isArray(req.body?.customerIds) ? req.body.customerIds.filter((id) => isValidObjectId(id)) : [];
  const subject = String(req.body?.subject || '').trim();
  const html = String(req.body?.html || '').trim();
  if (!ids.length) return res.status(400).json({ error: 'No recipients selected' });
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!html || !html.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'Email body is required' });

  // The server decides who is actually mailable, not the client.
  const recipients = await Customer.find({ _id: { $in: ids }, email: { $nin: ['', null] } })
    .select('email fullName company')
    .lean();
  if (!recipients.length) return res.status(400).json({ error: 'None of the selected customers have an email address' });

  const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').trim();
  const from = mailFromAddress();
  const sentBy = req.user?.name || req.user?.email || 'user';

  const okIds = [];
  let failed = 0;
  let firstError = '';

  // Personalised sending is one message each, which is what makes placeholders
  // possible: a blind-copied send shares one body between everybody, so nothing
  // per-tenant can be filled in.
  const personalise = req.body?.personalise === true;

  // Anything still looking like @word after filling has no value behind it, and
  // an email reading "expires on @endDate" is worse than no email. A shared BCC
  // body can never fill one, so that combination is refused outright.

  if (!personalise) {
    const leftover = leftoverPlaceholders(`${subject} ${html}`);
    if (leftover.length) {
      return res.status(400).json({
        error: `This message uses ${leftover.join(', ')}, which cannot be filled in when one email is blind-copied to everyone. Tick "Send individually", or remove them.`,
      });
    }
  }

  const skipped = [];
  // The subject each recipient actually received, and the contract it was
  // filled from. Logging the template instead put "@contractNo" on a tenant's
  // timeline, which reads as a bug to anyone looking at the record.
  const sentPerCustomer = new Map();

  if (personalise) {
    // A tenant's contract supplies the unit, dates and rate. An active one is
    // the obvious source, but insisting on it would make several templates
    // unusable: "contract ended" goes to someone whose contract is *not*
    // active, and a welcome email goes out while it is still pending. So the
    // most relevant contract wins, and only a tenant with none at all is
    // skipped.
    const RELEVANCE = { active: 0, pending_signature: 1, draft: 2, ended: 3, cancelled: 4 };
    const contracts = await Contract.find({ customer: { $in: recipients.map((c) => c._id) } })
      .populate('unit', 'unitNumber').populate('units', 'unitNumber').lean();

    const byCustomer = new Map();
    for (const c of contracts) {
      const key = String(c.customer);
      const held = byCustomer.get(key);
      if (!held) { byCustomer.set(key, c); continue; }
      // Prefer a live contract; between two of the same standing, the one
      // running latest, since that is the one the tenant is thinking about.
      const better = (RELEVANCE[c.status] ?? 9) - (RELEVANCE[held.status] ?? 9)
        || (Boolean(held.archived) - Boolean(c.archived))
        || (new Date(c.endDate || 0) - new Date(held.endDate || 0));
      if (better < 0) byCustomer.set(key, c);
    }

    for (const customer of recipients) {
      const contract = byCustomer.get(String(customer._id)) || null;
      const filledSubject = fillPlaceholders(subject, customer, contract);
      const filledHtml = fillPlaceholders(html, customer, contract);

      const leftover = leftoverPlaceholders(`${filledSubject} ${filledHtml}`);
      if (leftover.length) {
        skipped.push({
          name: customer.fullName,
          email: customer.email,
          reason: contract
            ? `${leftover.join(', ')} had no value on contract ${contract.contractNo}`
            : 'no contract on record, so the contract details could not be filled in',
        });
        continue;
      }

      try {
        await sendMail({
          to: customer.email,
          subject: filledSubject,
          text: fillPlaceholders(text, customer, contract),
          html: filledHtml,
          context: { kind: 'bulk', label: 'Email customers', sentBy, customer: customer._id, contract: contract?._id || null },
        });
        okIds.push(customer._id);
        sentPerCustomer.set(String(customer._id), { subject: filledSubject, contractId: contract?._id || null });
      } catch (err) {
        failed += 1;
        if (!firstError) firstError = err.message || 'Send failed';
      }
    }
  } else {
    for (const batch of chunk(recipients, BCC_BATCH_SIZE)) {
      try {
        // `To` is the sender: a message with an empty To and only BCC is widely
        // treated as spam.
        await sendMail({
        to: from, bcc: batch.map((c) => c.email).join(', '), subject, text, html,
        context: { kind: 'bulk', label: 'Email customers (blind copied)', sentBy },
      });
        okIds.push(...batch.map((c) => c._id));
      } catch (err) {
        failed += batch.length;
        if (!firstError) firstError = err.message || 'Send failed';
      }
    }
  }

  if (okIds.length) {
    const at = new Date();

    if (sentPerCustomer.size) {
      // Personalised: each person got their own subject, and it is logged
      // against the contract it was actually filled from rather than every
      // active one they happen to hold.
      for (const [customerId, sent] of sentPerCustomer) {
        await Customer.updateOne(
          { _id: customerId },
          { $push: { emailLog: { subject: sent.subject, at, sentBy } } },
        );
        if (sent.contractId) {
          await Contract.updateOne(
            { _id: sent.contractId },
            { $push: { timeline: { at, text: `Email "${sent.subject}" sent`, author: sentBy } } },
          );
        }
      }
    } else {
      // Blind-copied: one subject for everyone, and it cannot contain a
      // placeholder because that send is refused outright.
      await Customer.updateMany(
        { _id: { $in: okIds } },
        { $push: { emailLog: { subject, at, sentBy } } },
      );
      // Active only: an ended contract should not collect new correspondence.
      await Contract.updateMany(
        { customer: { $in: okIds }, status: 'active' },
        { $push: { timeline: { at, text: `Email "${subject}" sent`, author: sentBy } } },
      );
    }
  }

  if (!okIds.length) {
    // Nothing sent because nothing could be filled in is a different problem
    // from nothing sent because the mail server refused, and the caller needs
    // to be told which.
    if (skipped.length && !failed) {
      return res.status(400).json({
        error: `Nothing was sent. ${skipped.length} ${skipped.length === 1 ? 'recipient' : 'recipients'} could not be filled in — ${skipped[0].reason}.`,
        skipped,
      });
    }
    return res.status(500).json({ error: firstError || 'Failed to send email' });
  }
  res.json({
    sent: okIds.length,
    failed,
    total: recipients.length,
    // Named, not just counted: "3 skipped" leaves someone guessing who.
    skipped,
    ...(firstError ? { error: firstError } : {}),
  });
});

router.post('/bulk-delete', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
  for (const id of ids) {
    await deleteCustomerCascade(id);
  }
  res.json({ ok: true, deleted: ids.length, skipped: 0 });
});

export default router;
