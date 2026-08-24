import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Contract } from '../models/index.js';
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
        heading: "Thank you — we'll keep your unit",
        body: 'We have recorded that you would like to continue storing with us. A member of the team will be in touch to confirm the details and your next invoice.',
        accent: '#047857',
        other: 'not_renewing',
        otherLabel: 'Actually, I want to move out',
    },
    not_renewing: {
        title: 'Move-out noted',
        heading: "Thank you — we've noted you're moving out",
        body: 'We have recorded that you will be vacating your unit. A member of the team will contact you to arrange the move-out date and the return of your key or access device.',
        accent: '#5B2BC9',
        other: 'renewing',
        otherLabel: 'Actually, I want to renew',
    },
};

function page({ title, heading, body, accent, footer = '' }) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — PurpleBox Storage</title>
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
  a { color:#5B2BC9; }
</style></head>
<body><div class="wrap"><div class="card">
  <p class="brand">PurpleBox<span>.</span></p>
  <h1>${heading}</h1>
  <p>${body}</p>
  ${footer}
  <p class="muted">
    Questions? Call <a href="tel:+97143293924">04 329 3924</a> or message us on
    <a href="https://wa.me/971542249946">WhatsApp</a>.
  </p>
</div></div></body></html>`;
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
    contract.renewalIntent = intent;
    // Recorded on the timeline so it is clear the tenant said this themselves,
    // rather than a colleague setting it after a call.
    contract.timeline.push({
        type: 'renewal_intent',
        text: `Tenant answered the expiry email: ${intent === 'renewing' ? 'Renewing' : 'Not renewing'}${before !== 'undecided' && before !== intent ? ` (was ${before})` : ''}`,
    });
    await contract.save();

    const cfg = INTENTS[intent];
    // A one-click answer needs a one-click correction — people do misread.
    const otherHref = `/api/contracts/public/renewal/${contractId}/${renewalToken(contractId)}?intent=${cfg.other}`;
    res.send(page({
        title: cfg.title,
        heading: cfg.heading,
        body: cfg.body,
        accent: cfg.accent,
        footer: `<form method="GET" action="${otherHref}">
      <input type="hidden" name="intent" value="${cfg.other}">
      <button type="submit">${cfg.otherLabel}</button>
    </form>`,
    }));
});

export default router;
