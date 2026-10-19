import { Router } from 'express';
import { Contract, Customer, CustomerRequest, Invoice, Payment } from '../models/index.js';
import { requireCustomer, otpLimiter, signCustomerToken, customerPayload } from './customerAuth.js';
import { nextPaymentDueDate } from '../services/billingCycle.js';
import { buildContractPdf } from '../services/contractDocument.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';
import { renderReceiptPdf } from '../services/receiptPdf.js';
import { checkOtp, issueOtp, normalizePhone } from '../services/customerOtp.js';
import { createCheckoutSession, stripeConfigured } from '../services/stripe.js';

/**
 * What a storage tenant can see of their own account.
 *
 * Every query starts from req.customer.customerId, and every response is built
 * by an explicit view function below. Nothing here returns a document as-is:
 * contracts carry internal notes, approval state and imported raw data, and
 * invoices carry sync fields, none of which a tenant should receive.
 */
const router = Router();
router.use(requireCustomer);

const VISIBLE_CONTRACT_STATUSES = ['active', 'pending_signature', 'ended'];
const VISIBLE_INVOICE_STATUSES = ['sent', 'partial', 'overdue', 'paid'];

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

function unitView(u) {
  if (!u || !u._id) return null;
  return { id: u._id, unitNumber: u.unitNumber, floor: u.floor, sizeSqf: u.sizeSqf, lengthFt: u.lengthFt, widthFt: u.widthFt, shared: !!u.shared };
}

function contractView(c) {
  const units = (c.units?.length ? c.units : [c.unit]).map(unitView).filter(Boolean);
  const next = c.status === 'active' ? nextPaymentDueDate({ startDate: c.startDate, endDate: c.endDate }) : null;
  return {
    id: c._id,
    contractNo: c.contractNo,
    status: c.status,
    billingPeriod: c.billingPeriod,
    rate: c.rate,
    leasedPrice: c.leasedPrice,
    deposit: c.deposit,
    startDate: c.startDate,
    endDate: c.endDate,
    nextPaymentDate: next,
    renewalIntent: c.renewalIntent,
    accessType: c.accessType,
    signed: !!(c.signedDocUrl || c.signingRecord),
    units,
    authorizedPersons: (c.authorizedPersons || []).map((p) => ({ name: p.name, phone: p.phone, relation: p.relation })),
  };
}

function invoiceView(inv, { detail = false } = {}) {
  const balanceDue = Math.max(0, money(inv.total) - money(inv.paymentMade));
  const overdue = balanceDue > 0 && new Date(inv.dueDate) < new Date();
  const view = {
    id: inv._id,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    subject: inv.subject,
    total: money(inv.total),
    paymentMade: money(inv.paymentMade),
    balanceDue: money(balanceDue),
    status: balanceDue <= 0 ? 'paid' : overdue ? 'overdue' : inv.status,
  };
  if (detail) {
    Object.assign(view, {
      subTotal: money(inv.subTotal),
      cardFeePct: inv.cardFeeEnabled ? inv.cardFeePct : 0,
      items: (inv.items || []).map((it) => ({ itemDetails: it.itemDetails, quantity: it.quantity, rate: it.rate, amount: it.amount })),
      payments: (inv.paymentHistory || []).map((p) => ({ date: p.date, amount: p.amount, method: p.method })),
    });
  }
  return view;
}

const myContracts = (customerId, extra = {}) =>
  Contract.find({ customer: customerId, archived: { $ne: true }, status: { $in: VISIBLE_CONTRACT_STATUSES }, ...extra })
    .populate('unit').populate('units').sort({ startDate: -1 });

async function ownedContract(req, id) {
  const contract = await Contract.findOne({ _id: id, customer: req.customer.customerId, status: { $in: VISIBLE_CONTRACT_STATUSES } })
    .populate('unit').populate('units');
  if (!contract) throw notFound('Contract');
  return contract;
}

async function ownedInvoice(req, id) {
  const invoice = await Invoice.findOne({ _id: id, customer: req.customer.customerId, status: { $in: VISIBLE_INVOICE_STATUSES } });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

// ── Home ────────────────────────────────────────────────────────────────────
router.get('/home', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const [customer, contracts, invoices] = await Promise.all([
    Customer.findById(customerId).lean(),
    myContracts(customerId),
    Invoice.find({ customer: customerId, status: { $in: ['sent', 'partial', 'overdue'] } }).sort({ dueDate: 1 }),
  ]);
  const views = contracts.map(contractView);
  const open = invoices.map((i) => invoiceView(i)).filter((i) => i.balanceDue > 0);
  res.json({
    customer: customer ? customerPayload(customer) : null,
    primaryContract: views.find((c) => c.status === 'active') || views[0] || null,
    contracts: views,
    outstanding: { total: money(open.reduce((s, i) => s + i.balanceDue, 0)), invoices: open },
  });
}));

// ── Units & contracts ───────────────────────────────────────────────────────
router.get('/contracts', wrap(async (req, res) => {
  res.json((await myContracts(req.customer.customerId)).map(contractView));
}));

router.get('/contracts/:id', wrap(async (req, res) => {
  res.json(contractView(await ownedContract(req, req.params.id)));
}));

router.get('/contracts/:id/pdf', wrap(async (req, res) => {
  const contract = await ownedContract(req, req.params.id);
  await contract.populate('customer');
  const pdf = await buildContractPdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
}));

// Asking to change the check-out date is a request, not an edit: it changes
// what the tenant owes and when a unit frees up, so staff decide.
router.post('/contracts/:id/checkout-change', wrap(async (req, res) => {
  const contract = await ownedContract(req, req.params.id);
  if (contract.status !== 'active') throw badRequest('Only an active agreement can be changed');
  const { action, months, date } = req.body || {};

  let payload; let summary;
  if (action === 'extend') {
    if (![6, 12].includes(Number(months))) throw badRequest('Choose 6 or 12 months');
    const requestedEndDate = new Date(contract.endDate);
    requestedEndDate.setMonth(requestedEndDate.getMonth() + Number(months));
    payload = { action, months: Number(months), requestedEndDate };
    summary = `extend by ${months} months (to ${requestedEndDate.toISOString().slice(0, 10)})`;
  } else if (action === 'move_out_early') {
    const when = new Date(date);
    if (Number.isNaN(when.getTime())) throw badRequest('Choose a move-out date');
    if (when < new Date(new Date().toDateString()) || when > new Date(contract.endDate)) {
      throw badRequest('The move-out date must be between today and your current check-out date');
    }
    payload = { action, requestedEndDate: when };
    summary = `move out early on ${when.toISOString().slice(0, 10)}`;
  } else {
    throw badRequest('Unknown action');
  }

  const dup = await CustomerRequest.findOne({ contract: contract._id, type: 'checkout_change', status: 'pending' });
  if (dup) throw Object.assign(new Error('You already have a change request waiting for approval'), { status: 409 });

  const request = await CustomerRequest.create({ customer: req.customer.customerId, contract: contract._id, type: 'checkout_change', payload });
  contract.timeline.push({ text: `Tenant requested via app: ${summary}`, author: 'customer app' });
  await contract.save();
  res.status(201).json({ id: request._id, status: request.status, payload });
}));

// ── Link a unit ─────────────────────────────────────────────────────────────
// The signed-in phone is already proven by OTP, but an agreement may be filed
// under a different number. The code goes to the number *on the agreement*, so
// only someone holding that phone can attach it to this login.
router.post('/link-unit/request', otpLimiter, wrap(async (req, res) => {
  const contractNo = String(req.body?.contractNo || '').trim();
  if (!contractNo) throw badRequest('Enter your agreement number');
  const contract = await Contract.findOne({ contractNo, status: { $in: VISIBLE_CONTRACT_STATUSES } }).populate('customer', 'phone');
  const phone = contract?.customer?.phone;
  if (!contract || !phone) throw notFound('Agreement');
  if (String(contract.customer._id) === String(req.customer.customerId)) {
    throw Object.assign(new Error('That agreement is already on your account'), { status: 409 });
  }
  const sent = await issueOtp({ key: `link:${req.customer.customerId}:${contractNo}`, phone });
  const digits = normalizePhone(phone);
  res.json({ maskedPhone: `••• ${digits.slice(-3)}`, ...(sent.devCode ? { code: sent.devCode } : {}) });
}));

router.post('/link-unit/confirm', otpLimiter, wrap(async (req, res) => {
  const contractNo = String(req.body?.contractNo || '').trim();
  await checkOtp({ key: `link:${req.customer.customerId}:${contractNo}`, code: req.body?.code });

  const contract = await Contract.findOne({ contractNo, status: { $in: VISIBLE_CONTRACT_STATUSES } });
  if (!contract) throw notFound('Agreement');
  const tenantId = contract.customer;
  const visitor = await Customer.findById(req.customer.customerId);
  const e164 = visitor?.phone ? `+${normalizePhone(visitor.phone)}` : '';

  // One phone must resolve to one customer, or the next login picks at random.
  // The tenant record takes the number; the throwaway prospect gives it up
  // (its data stays, only the login handle moves).
  if (e164) {
    await Customer.updateOne({ _id: tenantId }, { $addToSet: { phones: e164 } });
    await Customer.updateOne({ _id: visitor._id }, { $set: { phone: '', phones: [] } });
  }
  const tenant = await Customer.findById(tenantId);
  res.json({ token: signCustomerToken(tenant), customer: customerPayload(tenant) });
}));

// ── Invoices, payments, documents ───────────────────────────────────────────
router.get('/invoices', wrap(async (req, res) => {
  const invoices = await Invoice.find({ customer: req.customer.customerId, status: { $in: VISIBLE_INVOICE_STATUSES } })
    .sort({ invoiceDate: -1 }).limit(200);
  res.json(invoices.map((i) => invoiceView(i)));
}));

router.get('/invoices/:id', wrap(async (req, res) => {
  res.json(invoiceView(await ownedInvoice(req, req.params.id), { detail: true }));
}));

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
  const invoice = await ownedInvoice(req, req.params.id);
  await invoice.populate('customer', 'fullName email phone address');
  const pdf = await renderInvoicePdf({ invoice });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
  res.send(pdf);
}));

// Returns a hosted Stripe Checkout URL; the app opens it in an in-app browser.
// The existing webhook (metadata.storageInvoiceId) marks the invoice paid and is
// idempotent, so nothing is applied here — paying is confirmed by Stripe, not by
// the app saying so.
router.post('/invoices/:id/pay', wrap(async (req, res) => {
  if (!stripeConfigured()) throw Object.assign(new Error('Online payment is not available right now'), { status: 503 });
  const invoice = await ownedInvoice(req, req.params.id);
  const balanceDue = Math.max(0, money(invoice.total) - money(invoice.paymentMade));
  if (balanceDue <= 0) throw badRequest('This invoice is already paid');

  const customer = await Customer.findById(req.customer.customerId).select('email').lean();
  const clientOrigin = process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae';
  const session = await createCheckoutSession({
    amountAed: balanceDue,
    productName: `Invoice ${invoice.invoiceNo}`,
    description: 'Storage invoice balance due — PurpleBox',
    metadata: { storageInvoiceId: String(invoice._id), invoiceNo: invoice.invoiceNo },
    customerEmail: customer?.email || undefined,
    successUrl: `${clientOrigin}/pay/success?invoice=${invoice.invoiceNo}`,
    cancelUrl: `${clientOrigin}/pay/success?invoice=${invoice.invoiceNo}&cancelled=1`,
    feePct: invoice.cardFeeEnabled ? invoice.cardFeePct : 0,
  });
  res.json({ url: session.url, sessionId: session.id, balanceDue: money(balanceDue) });
}));

async function paidPayments(customerId) {
  const contracts = await Contract.find({ customer: customerId }).select('_id contractNo').lean();
  const byId = new Map(contracts.map((c) => [String(c._id), c.contractNo]));
  const payments = await Payment.find({ contract: { $in: [...byId.keys()] }, status: 'paid' }).sort({ paidDate: -1 }).limit(200);
  return { payments, byId };
}

router.get('/payments', wrap(async (req, res) => {
  const { payments, byId } = await paidPayments(req.customer.customerId);
  res.json(payments.map((p) => ({
    id: p._id, amount: money(p.amount), paidDate: p.paidDate, dueDate: p.dueDate, method: p.method,
    contractNo: byId.get(String(p.contract)),
  })));
}));

router.get('/payments/:id/receipt', wrap(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, status: 'paid' });
  if (!payment) throw notFound('Receipt');
  const contract = await Contract.findOne({ _id: payment.contract, customer: req.customer.customerId })
    .populate('customer').populate('unit');
  if (!contract) throw notFound('Receipt');

  // Same numbering as the staff receipt: position among this contract's paid payments.
  const allPaid = await Payment.find({ contract: contract._id, status: 'paid' }).sort({ paidDate: 1 }).select('_id');
  const idx = allPaid.findIndex((p) => String(p._id) === String(payment._id));
  const receiptNo = `RCP-${contract.contractNo}-${String(idx + 1).padStart(3, '0')}`;

  const pdf = await renderReceiptPdf({ payment, contract, customer: contract.customer, unit: contract.unit, receiptNo });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receiptNo}.pdf"`);
  res.send(pdf);
}));

// One list for the Documents tab. Files are fetched through the authenticated
// pdf endpoints named in `href`, so no storage URL is ever handed out.
router.get('/documents', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const base = '/customer-portal/storage';
  const [contracts, invoices, paid] = await Promise.all([
    myContracts(customerId),
    Invoice.find({ customer: customerId, status: { $in: VISIBLE_INVOICE_STATUSES } }).sort({ invoiceDate: -1 }).limit(100),
    paidPayments(customerId),
  ]);
  const receiptNo = new Map();
  const perContract = new Map();
  for (const p of [...paid.payments].sort((a, b) => new Date(a.paidDate) - new Date(b.paidDate))) {
    const k = String(p.contract);
    const n = (perContract.get(k) || 0) + 1;
    perContract.set(k, n);
    receiptNo.set(String(p._id), `RCP-${paid.byId.get(k)}-${String(n).padStart(3, '0')}`);
  }
  res.json({
    agreements: contracts.map((c) => ({
      id: c._id, kind: 'agreement', title: c.contractNo, status: (c.signedDocUrl || c.signingRecord) ? 'signed' : c.status, date: c.startDate, href: `${base}/contracts/${c._id}/pdf`,
    })),
    invoices: invoices.map((i) => ({
      id: i._id, kind: 'invoice', title: i.invoiceNo, status: invoiceView(i).status, date: i.invoiceDate, amount: money(i.total), href: `${base}/invoices/${i._id}/pdf`,
    })),
    receipts: paid.payments.map((p) => ({
      id: p._id, kind: 'receipt', title: receiptNo.get(String(p._id)), date: p.paidDate, amount: money(p.amount), href: `${base}/payments/${p._id}/receipt`,
    })),
  });
}));

export default router;
