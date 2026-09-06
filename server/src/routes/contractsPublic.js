import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Contract, ContractRenewal, Unit, Task, User, AiBotConfig } from '../models/index.js';
import { verifyRenewalToken, renewalToken } from '../services/renewalLink.js';
import {
    renewalMonthlyRate,
    priceRenewal,
    renewalChoices,
    validateNewEndDate,
} from '../services/renewalPricing.js';
import { createCheckoutSession, stripePublishableKey, stripeEmbeddedConfigured } from '../services/stripe.js';
import { bankTransferDetails } from '../services/bankDetails.js';

/**
 * The tenant's answer to "are you staying?", clicked from the expiry email.
 *
 * Unauthenticated by necessity — a tenant has no account. The token authorises
 * it and only ever touches the one contract it names.
 *
 * Recorded on the contract's own timeline as well as in renewalIntent, so the
 * team can see the customer said it themselves rather than someone guessing on
 * a call.
 */
const router = Router();

const INTENTS = {
    renewing: {
        title: 'Renewal confirmed',
        heading: "Thank you, we'll keep your unit",
        body: 'We have recorded that you would like to continue storing with us. A member of the team will be in touch to confirm the details and your next invoice.',
        accent: '#047857',
    },
    not_renewing: {
        title: 'Move-out noted',
        heading: "Thank you, we've noted you're moving out",
        body: 'We have recorded that you will be vacating your unit. A member of the team will contact you to arrange the move-out date and the return of your key or access device.',
        accent: '#5B2BC9',
        other: 'renewing',
        otherLabel: 'Actually, I want to renew',
        // Someone clearing a unit has to move its contents somewhere, and this
        // is the one moment we know that for certain. Offered as help with the
        // thing they now have to do, not as a pitch — they have just told us
        // they are leaving.
        promo: {
            heading: 'Need a hand moving your things?',
            body: 'We pack and move across Dubai, with trained crews, padded trucks and a fixed price agreed before anything is lifted.',
            href: 'https://purplebox.ae/packing-moving.html',
            cta: 'See packing & moving',
        },
    },
};

function page({ title, heading, body, accent, footer = '', promo = null }) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | PurpleBox Storage</title>
<style>
  body { margin:0; background:#EDE3CF; color:#14081F;
         font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 560px; margin: 10vh auto; padding: 0 20px; }
  .card { background:#FBF8F2; border-radius:18px; padding:36px; }
  .brand { font-family: Georgia, 'Times New Roman', serif; font-size:22px; font-weight:700;
           letter-spacing:-.5px; margin:0 0 24px; }
  .brand span { color:#5B2BC9; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-size:24px; line-height:1.25; margin:0 0 14px; color:${accent}; }
  p { font-size:15px; line-height:1.65; color:#4A4357; margin:0 0 14px; }
  form { margin-top:22px; }
  button { background:none; border:1px solid rgba(20,8,31,.16); border-radius:999px;
           padding:11px 22px; font-size:14px; font-weight:700; color:#14081F; cursor:pointer; }
  .muted { font-size:12.5px; color:#756E80; margin-top:26px; }
  .promo { margin-top:26px; padding:20px; background:#F7F3FF; border:1px solid #EDE5FF; border-radius:14px; }
  .promo-h { font-size:15px; font-weight:700; color:#2D1259; margin:0 0 6px; }
  .promo-b { font-size:13.5px; line-height:1.6; color:#4A4357; margin:0 0 14px; }
  .promo-cta { display:inline-block; background:#5B2BC9; color:#fff; text-decoration:none;
               border-radius:999px; padding:10px 20px; font-size:13.5px; font-weight:700; }
  a { color:#5B2BC9; }
</style></head>
<body><div class="wrap"><div class="card">
  <p class="brand">PurpleBox<span>.</span></p>
  <h1>${heading}</h1>
  <p>${body}</p>
  ${footer}
  ${promo ? `<div class="promo">
    <p class="promo-h">${promo.heading}</p>
    <p class="promo-b">${promo.body}</p>
    <a class="promo-cta" href="${promo.href}">${promo.cta}</a>
  </div>` : ''}
  <p class="muted">
    Questions? Call <a href="tel:+97143293924">04 329 3924</a> or message us on
    <a href="https://wa.me/971542249946">WhatsApp</a>.
  </p>
</div></div></body></html>`;
}

/**
 * Raise a task so somebody actually acts on the tenant's answer.
 *
 * The move-out page tells the tenant a colleague will be in touch to arrange
 * the date and the key; without a task that is an empty promise. A renewal
 * needs the next invoice raising.
 *
 * Assigned to whoever receives hand-overs — the same person the WhatsApp
 * assistant escalates to, so there is one place to change it rather than two
 * that drift apart. Falls back to an admin if that is unset.
 */
async function raiseTask(contract, intent) {
    const renewing = intent === 'renewing';

    // Clicking twice, or a mail scanner prefetching the link, must not produce
    // a second task. One open task per contract per decision is enough.
    const already = await Task.findOne({
        leadId: contract._id,
        status: { $ne: 'done' },
        title: new RegExp(`^${renewing ? 'Renewal confirmed' : 'Move-out confirmed'}`),
    }).select('_id').lean();
    if (already) return;

    const config = await AiBotConfig.findOne().select('escalateTo').lean();
    let assignee = config?.escalateTo
        ? await User.findById(config.escalateTo).select('_id name email isActive').lean()
        : null;
    if (!assignee || assignee.isActive === false) {
        assignee = await User.findOne({ role: 'admin', isActive: { $ne: false } })
            .select('_id name email').sort({ createdAt: 1 }).lean();
    }
    if (!assignee) return;

    const customer = await Contract.findById(contract._id).populate('customer', 'fullName phone email').lean();
    const who = customer?.customer?.fullName || 'Tenant';
    const ends = contract.endDate ? new Date(contract.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    await Task.create({
        title: `${renewing ? 'Renewal confirmed' : 'Move-out confirmed'} — ${who}`,
        description: [
            `${who} answered the expiry email: ${renewing ? 'renewing' : 'moving out'}.`,
            '',
            `Contract: ${contract.contractNo || ''}`,
            ends ? `Ends: ${ends}` : '',
            customer?.customer?.phone ? `Phone: ${customer.customer.phone}` : '',
            customer?.customer?.email ? `Email: ${customer.customer.email}` : '',
            '',
            renewing
                ? 'Confirm the new term and raise the next invoice.'
                : 'Arrange the move-out date and the return of the key or access device.',
        ].filter(Boolean).join('\n'),
        assignedTo: assignee._id,
        createdByName: 'Tenant (expiry email)',
        leadId: contract._id,
        leadType: 'contract',
        leadName: who,
        // A move-out has a date attached and a unit to free up; a renewal can
        // wait a day.
        priority: renewing ? 'medium' : 'high',
        dueDate: contract.endDate || null,
        assignmentHistory: [{
            fromId: null, fromName: '',
            toId: assignee._id, toName: assignee.name || assignee.email,
            byId: null, byName: 'Tenant (expiry email)',
            reason: 'Tenant answered the expiry email',
        }],
    });
}

router.get('/renewal/:contractId/:token', async (req, res) => {
    const { contractId, token } = req.params;
    const intent = String(req.query.intent || '');

    if (!isValidObjectId(contractId) || !verifyRenewalToken(contractId, token) || !INTENTS[intent]) {
        return res.status(400).send(page({
            title: 'Link not recognised',
            heading: 'This link is not valid',
            body: 'It may have been altered in transit, or copied incompletely. Please reply to our email or call us and we will sort it out.',
            accent: '#B91C1C',
        }));
    }

    const contract = await Contract.findById(contractId);
    if (!contract) {
        return res.status(404).send(page({
            title: 'Not found',
            heading: 'We could not find that contract',
            body: 'Please reply to our email or give us a call and we will help.',
            accent: '#B91C1C',
        }));
    }

    const before = contract.renewalIntent || 'undecided';
    const changed = before !== intent;
    contract.renewalIntent = intent;

    /* Somebody saying they want to stay is sent to the page where they can
     * actually do it — pick a date, see the price, pay — rather than being told
     * a colleague will ring them.
     *
     * Done as a redirect from this same URL on purpose: every expiry email
     * already sitting in a tenant's inbox points here, and this makes all of
     * them lead to the new flow without a single message being re-sent. The
     * intent is still recorded first, so the CRM knows even if they abandon the
     * page. A closed contract has nothing to renew, so it keeps the old
     * acknowledgement. */
    if (intent === 'renewing' && !['ended', 'cancelled'].includes(contract.status)) {
        contract.timeline.push({
            type: 'renewal_intent',
            text: 'Tenant opened the renewal page from the expiry message',
        });
        await contract.save();
        if (changed) await raiseTask(contract, intent);
        const origin = String(process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae').replace(/\/+$/, '');
        return res.redirect(302, `${origin}/renew/${contractId}/${renewalToken(contractId)}`);
    }
    // Recorded on the timeline so it is clear the tenant said this themselves,
    // rather than a colleague setting it after a call.
    contract.timeline.push({
        type: 'renewal_intent',
        text: `Tenant answered the expiry email: ${intent === 'renewing' ? 'Renewing' : 'Not renewing'}${before !== 'undecided' && before !== intent ? ` (was ${before})` : ''}`,
    });
    await contract.save();

    if (changed) await raiseTask(contract, intent);

    const cfg = INTENTS[intent];
    res.send(page({
        title: cfg.title,
        heading: cfg.heading,
        body: cfg.body,
        accent: cfg.accent,
        promo: cfg.promo || null,
        // Only the move-out page offers the opposite answer. Someone who has
        // just chosen to stay does not need a button that undoes it.
        footer: cfg.other
            ? `<form method="GET" action="/api/contracts/public/renewal/${contractId}/${renewalToken(contractId)}?intent=${cfg.other}">
      <input type="hidden" name="intent" value="${cfg.other}">
      <button type="submit">${cfg.otherLabel}</button>
    </form>`
            : '',
    }));
});

/* ── The renewal booking flow ───────────────────────────────────────────────
 *
 * A tenant with no account picks a new end date, sees what it costs, and pays.
 * Everything below is authorised by the same HMAC token as the pages above and
 * only ever touches the one contract that token names.
 *
 * Deliberately narrow in what it returns: a first name, the unit numbers, the
 * dates and the money. A token that leaked would show somebody a storage unit's
 * renewal price, not a customer record.
 */

// Renewals are quoted at 3% for a card, nothing for a transfer. Kept as an
// override rather than a hard constant so the rate can change without a deploy.
const RENEWAL_CARD_FEE_PCT = Number(process.env.RENEWAL_CARD_FEE_PCT ?? 3) || 0;
const VAT_PCT = 5;

/** Shared gate: valid token, live contract, and the rate it renews at. */
async function loadRenewable(contractId, token) {
    if (!isValidObjectId(contractId) || !verifyRenewalToken(contractId, token)) {
        return { error: 'This link is not valid', code: 400 };
    }
    const contract = await Contract.findById(contractId).populate('customer', 'fullName email phone');
    if (!contract) return { error: 'We could not find that contract', code: 404 };
    if (['ended', 'cancelled'].includes(contract.status)) {
        return { error: 'This contract has already closed. Please contact us and we will help.', code: 409 };
    }
    if (!contract.endDate) {
        return { error: 'This contract has no end date to renew from. Please contact us.', code: 409 };
    }

    const unitIds = (contract.units?.length ? contract.units : [contract.unit]).filter(Boolean);
    const units = await Unit.find({ _id: { $in: unitIds } }).select('unitNumber price sizeSqf').lean();
    const rate = renewalMonthlyRate(contract, units);
    return { contract, units, rate };
}

/** What the page needs to draw itself. */
router.get('/renewal/:contractId/:token/options', async (req, res) => {
    const loaded = await loadRenewable(req.params.contractId, req.params.token);
    if (loaded.error) return res.status(loaded.code).json({ error: loaded.error });
    const { contract, units, rate } = loaded;

    res.json({
        contractNo: contract.contractNo,
        // A first name only — enough to feel addressed, nothing worth leaking.
        firstName: String(contract.customer?.fullName || '').trim().split(/\s+/)[0] || '',
        units: units.map((u) => ({ unitNumber: u.unitNumber, sizeSqf: u.sizeSqf ?? null })),
        currentEndDate: contract.endDate,
        monthlyRate: rate.monthlyRate,
        weeklyRate: Number((rate.monthlyRate / 4).toFixed(2)),
        /* Shown only when today's price differs from the one they signed at, so
         * the page can say why the figure moved instead of leaving them to
         * notice it themselves and distrust the rest of it. */
        previousMonthlyRate: rate.contractRate,
        rateSource: rate.source,
        vatPct: VAT_PCT,
        cardFeePct: RENEWAL_CARD_FEE_PCT,
        choices: renewalChoices({
            monthlyRate: rate.monthlyRate,
            from: contract.endDate,
            vatPct: VAT_PCT,
            cardFeePct: RENEWAL_CARD_FEE_PCT,
        }),
        // Publishable key only — it identifies the account and can do nothing
        // on its own. The secret key never leaves this server.
        stripePublishableKey: stripePublishableKey(),
        cardAvailable: stripeEmbeddedConfigured(),
        bank: bankTransferDetails(),
    });
});

/** Price a date. Writes nothing — this runs on every change of the picker. */
router.post('/renewal/:contractId/:token/quote', async (req, res) => {
    const loaded = await loadRenewable(req.params.contractId, req.params.token);
    if (loaded.error) return res.status(loaded.code).json({ error: loaded.error });
    const { contract, rate } = loaded;

    const check = validateNewEndDate({
        currentEndDate: contract.endDate,
        newEndDate: req.body?.newEndDate,
    });
    if (!check.ok) return res.status(400).json({ error: check.error });

    res.json(priceRenewal({
        monthlyRate: rate.monthlyRate,
        from: contract.endDate,
        to: req.body.newEndDate,
        vatPct: VAT_PCT,
        cardFeePct: RENEWAL_CARD_FEE_PCT,
    }));
});

/**
 * Commit to a date and start paying for it.
 *
 * The contract is NOT extended here — only when the money is real. What this
 * writes is the agreement, with every figure frozen, so a price change between
 * now and payment cannot alter what they were shown.
 */
router.post('/renewal/:contractId/:token/checkout', async (req, res) => {
    try {
        const loaded = await loadRenewable(req.params.contractId, req.params.token);
        if (loaded.error) return res.status(loaded.code).json({ error: loaded.error });
        const { contract, units, rate } = loaded;

        const method = req.body?.method === 'bank_transfer' ? 'bank_transfer' : 'card';
        const check = validateNewEndDate({
            currentEndDate: contract.endDate,
            newEndDate: req.body?.newEndDate,
        });
        if (!check.ok) return res.status(400).json({ error: check.error });
        if (method === 'card' && !stripeEmbeddedConfigured()) {
            return res.status(400).json({ error: 'Card payment is not available right now — please choose bank transfer.' });
        }

        const feePct = method === 'card' ? RENEWAL_CARD_FEE_PCT : 0;
        const priced = priceRenewal({
            monthlyRate: rate.monthlyRate,
            from: contract.endDate,
            to: req.body.newEndDate,
            vatPct: VAT_PCT,
            cardFeePct: feePct,
        });

        /* One live renewal per contract. Someone who changes their mind about
         * the date, or switches from card to transfer, leaves the earlier row
         * behind — and a stale pending row would otherwise sit in the contract's
         * renewal panel looking like money that never arrived. */
        await ContractRenewal.updateMany(
            { contract: contract._id, status: { $in: ['pending', 'awaiting_transfer'] } },
            { $set: { status: 'cancelled' } },
        );

        const renewal = await ContractRenewal.create({
            contract: contract._id,
            customer: contract.customer?._id || contract.customer,
            currentEndDate: contract.endDate,
            newEndDate: new Date(req.body.newEndDate),
            weeks: priced.weeks,
            monthlyRate: priced.monthlyRate,
            weeklyRate: priced.weeklyRate,
            rateSource: rate.source,
            subTotal: priced.subTotal,
            vatPct: priced.vatPct,
            vatAmount: priced.vatAmount,
            total: priced.total,
            cardFeePct: priced.cardFeePct,
            cardFeeAmount: priced.cardFeeAmount,
            method,
            status: method === 'card' ? 'pending' : 'awaiting_transfer',
        });

        if (method === 'bank_transfer') {
            await raiseTransferTask(contract, renewal);
            return res.json({
                renewalId: renewal._id,
                method,
                status: renewal.status,
                total: priced.total,
                reference: contract.contractNo,
                bank: bankTransferDetails(),
            });
        }

        const origin = String(process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae').replace(/\/+$/, '');
        const unitNo = units.map((u) => u.unitNumber).join(', ') || contract.contractNo;
        const session = await createCheckoutSession({
            amountAed: priced.total,
            productName: `Storage renewal — ${contract.contractNo}`,
            description: `Unit ${unitNo} · ${priced.weeks} week${priced.weeks === 1 ? '' : 's'} · PurpleBox`,
            metadata: { contractRenewalId: String(renewal._id), contractNo: contract.contractNo },
            customerEmail: contract.customer?.email || undefined,
            feePct,
            embedded: true,
            returnUrl: `${origin}/renew/${contract._id}/${req.params.token}?done={CHECKOUT_SESSION_ID}`,
        });

        renewal.stripeCheckoutSessionId = session.id;
        await renewal.save();

        res.json({
            renewalId: renewal._id,
            method,
            status: renewal.status,
            clientSecret: session.clientSecret,
            total: priced.total,
            cardFeeAmount: session.feeAmount,
            totalCharged: Number((priced.total + session.feeAmount).toFixed(2)),
        });
    } catch (e) {
        console.error('[Renewal] checkout failed:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/** Polled by the page after Stripe returns, until the webhook has landed. */
router.get('/renewal/:contractId/:token/status/:renewalId', async (req, res) => {
    const { contractId, token, renewalId } = req.params;
    if (!isValidObjectId(contractId) || !verifyRenewalToken(contractId, token) || !isValidObjectId(renewalId)) {
        return res.status(400).json({ error: 'This link is not valid' });
    }
    const renewal = await ContractRenewal.findOne({ _id: renewalId, contract: contractId })
        .select('status newEndDate total weeks method invoice')
        .lean();
    if (!renewal) return res.status(404).json({ error: 'Renewal not found' });
    res.json({
        status: renewal.status,
        newEndDate: renewal.newEndDate,
        total: renewal.total,
        weeks: renewal.weeks,
        method: renewal.method,
    });
});

/**
 * The same status, found by Stripe's session id instead.
 *
 * Stripe's return_url reloads the page, so whatever the browser was holding
 * about the renewal is gone by the time it comes back — and the session id in
 * the URL is the only thing it still knows. Looking it up here rather than
 * stashing it in the browser means a tenant who returns in a fresh tab, or with
 * storage blocked, still sees their renewal complete.
 */
router.get('/renewal/:contractId/:token/session/:sessionId', async (req, res) => {
    const { contractId, token, sessionId } = req.params;
    if (!isValidObjectId(contractId) || !verifyRenewalToken(contractId, token)) {
        return res.status(400).json({ error: 'This link is not valid' });
    }
    const renewal = await ContractRenewal.findOne({
        contract: contractId,
        stripeCheckoutSessionId: String(sessionId || ''),
    }).select('status newEndDate total weeks method').lean();
    if (!renewal) return res.status(404).json({ error: 'Renewal not found' });
    res.json({
        status: renewal.status,
        newEndDate: renewal.newEndDate,
        total: renewal.total,
        weeks: renewal.weeks,
        method: renewal.method,
    });
});

/**
 * A bank transfer somebody has to watch for.
 *
 * Unlike a card, nothing tells us the money arrived, so the renewal sits until
 * a colleague confirms it. Without a task that wait is invisible and the tenant
 * who paid on Friday is still un-renewed on Wednesday.
 */
async function raiseTransferTask(contract, renewal) {
    try {
        const config = await AiBotConfig.findOne().select('escalateTo').lean();
        let assignee = config?.escalateTo
            ? await User.findById(config.escalateTo).select('_id name email isActive').lean()
            : null;
        if (!assignee || assignee.isActive === false) {
            assignee = await User.findOne({ role: 'admin', isActive: { $ne: false } })
                .select('_id name email').sort({ createdAt: 1 }).lean();
        }
        if (!assignee) return;

        const who = contract.customer?.fullName || 'Tenant';
        const ends = new Date(renewal.newEndDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        await Task.create({
            title: `Renewal by bank transfer — ${who}`,
            description: [
                `${who} chose to renew ${contract.contractNo} by bank transfer.`,
                '',
                `New end date: ${ends} (${renewal.weeks} weeks)`,
                `Amount: AED ${renewal.total.toLocaleString()}`,
                `Reference they were given: ${contract.contractNo}`,
                contract.customer?.phone ? `Phone: ${contract.customer.phone}` : '',
                contract.customer?.email ? `Email: ${contract.customer.email}` : '',
                '',
                'When the money lands, open the contract and press "Confirm transfer received"',
                'on the renewal. That extends the contract, raises the invoice and emails them.',
            ].filter(Boolean).join('\n'),
            assignedTo: assignee._id,
            createdByName: 'Tenant (renewal page)',
            leadId: contract._id,
            leadType: 'contract',
            leadName: who,
            priority: 'high',
            dueDate: contract.endDate || null,
        });
    } catch (e) {
        // A missing task must not lose the renewal the tenant just committed to.
        console.error('[Renewal] transfer task failed:', e.message);
    }
}

export default router;
