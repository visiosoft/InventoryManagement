import { Router } from 'express';
import { Contract, Quote } from '../models/index.js';
import { requireCustomer, otpLimiter } from './customerAuth.js';
import { CARD_FEE_PCT, PAYING_HOLD_MINUTES, bookingState, listSizes, pricingFor, reserve, syncBookingPayment } from '../services/appBooking.js';
import { buildContractPdf } from '../services/contractDocument.js';
import { signContract } from '../services/contractSigning.js';
import { createCheckoutSession, stripeConfigured } from '../services/stripe.js';

/**
 * A signed-in customer booking a unit for themselves: pick a size, hold it, pay
 * by card, sign. Staff are not in the loop — see services/appBooking.js.
 */
const router = Router();

// Where Stripe sends the in-app browser after checkout. Public and static: it
// confirms nothing (the server learns of payment from Stripe itself), it only
// tells the customer to go back to the app.
router.get('/done', (req, res) => {
  const cancelled = req.query.cancelled === '1';
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PurpleBox</title><body style="margin:0;font-family:system-ui;background:#FBF8F2;color:#14081F;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">
<div><div style="font-size:56px">${cancelled ? '↩️' : '✅'}</div><h1 style="font-size:24px">${cancelled ? 'Payment cancelled' : 'Payment received'}</h1>
<p style="color:#4A4357">${cancelled ? 'Nothing was charged. Close this page to go back to the app.' : 'Close this page and return to the PurpleBox app to sign your agreement.'}</p></div>`);
});

router.use(requireCustomer);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.gaps ? { gaps: err.gaps } : {}) });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

async function ownedBooking(req) {
  const quote = await Quote.findOne({ _id: req.params.id, customer: req.customer.customerId, 'appBooking.active': true });
  if (!quote) throw fail(404, 'Booking not found');
  return quote;
}

const unitView = (quote) => {
  const u = quote.units[0];
  return { unitNumber: u.unitNumber, sizeSqf: u.sizeSqf, floor: u.floor, startDate: u.startDate, endDate: u.endDate, monthlyRate: u.rate, discountPct: u.discountPct };
};

async function view(quote) {
  return { ...(await bookingState(quote)), unit: unitView(quote), pricing: pricingFor(quote) };
}

router.get('/sizes', wrap(async (req, res) => {
  res.json(await listSizes({ startDate: req.query.startDate, months: req.query.months }));
}));

router.post('/reserve', otpLimiter, wrap(async (req, res) => {
  const { quote } = await reserve(req.customer.customerId, req.body || {});
  res.status(201).json(await view(quote));
}));

// The booking this customer should pick up where they left off, if any: still
// held, paid and being set up, or paid and waiting for their signature.
router.get('/current', wrap(async (req, res) => {
  const recent = await Quote.find({ customer: req.customer.customerId, 'appBooking.active': true })
    .sort({ createdAt: -1 }).limit(5);
  for (const found of recent) {
    const quote = await syncBookingPayment(found);
    const state = await bookingState(quote);
    if (['held', 'confirming', 'ready_to_sign', 'needs_review'].includes(state.state)) return res.json(await view(quote));
  }
  res.json(null);
}));

router.get('/:id', wrap(async (req, res) => {
  res.json(await view(await syncBookingPayment(await ownedBooking(req))));
}));

// Returns a hosted Stripe Checkout URL for the first invoice. Payment is
// confirmed to the server by Stripe's webhook (which also makes the contract) —
// the app never tells us it was paid.
router.post('/:id/pay', wrap(async (req, res) => {
  if (!stripeConfigured()) throw fail(503, 'Online payment is not available right now');
  const quote = await ownedBooking(req);
  if (quote.stripePaidAt) throw fail(409, 'This booking is already paid');
  if (quote.status !== 'sent' || quote.expiryDate <= new Date()) throw fail(410, 'Your reservation has expired. Please choose a unit again.');

  // A session lasts 30 minutes and the hold is stretched to 40 when it starts, so
  // while the hold still has 10+ minutes the existing session is still usable.
  if (quote.stripePaymentLinkUrl && quote.expiryDate.getTime() - Date.now() > 10 * 60_000 && quote.appBooking.checkoutStartedAt) {
    return res.json({ url: quote.stripePaymentLinkUrl, reused: true });
  }

  const pricing = pricingFor(quote);
  // Back to this API's own /done page, on whatever address the app reached us by.
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const done = `${proto}://${req.headers['x-forwarded-host'] || req.get('host')}${req.baseUrl}/done`;
  const session = await createCheckoutSession({
    amountAed: pricing.total,
    productName: `Storage unit ${quote.units[0].unitNumber} — first payment`,
    description: `${quote.quoteNo} · first period, refundable advance and VAT`,
    metadata: { storageQuoteId: String(quote._id), quoteNo: quote.quoteNo },
    successUrl: `${done}?booking=${quote.quoteNo}`,
    cancelUrl: `${done}?booking=${quote.quoteNo}&cancelled=1`,
    feePct: CARD_FEE_PCT,
    expiresInMinutes: 30,
  });
  quote.stripeCheckoutSessionId = session.id;
  quote.stripePaymentLinkUrl = session.url;
  quote.appBooking.checkoutStartedAt = new Date();
  quote.expiryDate = new Date(Date.now() + PAYING_HOLD_MINUTES * 60_000);
  await quote.save();
  res.json({ url: session.url, amount: pricing.total, cardFee: session.feeAmount, totalCharged: Math.round((pricing.total + session.feeAmount) * 100) / 100 });
}));

async function paidContract(req) {
  const quote = await ownedBooking(req);
  if (!quote.stripePaidAt || !quote.contract) throw fail(409, 'The agreement is not ready yet');
  const contract = await Contract.findOne({ _id: quote.contract, customer: req.customer.customerId })
    .populate('customer').populate('unit').populate('units');
  if (!contract) throw fail(404, 'Agreement not found');
  return { quote, contract };
}

router.get('/:id/contract.pdf', wrap(async (req, res) => {
  const { contract } = await paidContract(req);
  const pdf = await buildContractPdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractNo}.pdf"`);
  res.send(pdf);
}));

router.post('/:id/sign', wrap(async (req, res) => {
  const { quote, contract } = await paidContract(req);
  const result = await signContract({ contract, body: req.body, req });
  quote.timeline.push({ type: 'updated', text: `Agreement ${contract.contractNo} signed in the app by ${req.body.signerName}` });
  await quote.save();
  res.json({ ok: true, ...result });
}));

export default router;
