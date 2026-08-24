import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Contract, Task, User, AiBotConfig } from '../models/index.js';
import { verifyRenewalToken, renewalToken } from '../services/renewalLink.js';

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

export default router;
