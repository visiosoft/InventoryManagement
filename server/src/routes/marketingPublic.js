import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Customer, Lead } from '../models/index.js';
import { verifyUnsubscribeToken } from '../services/marketingConsent.js';

/**
 * Unsubscribe, reached from a link in a marketing email.
 *
 * Unauthenticated by necessity — the person clicking has no account. The token
 * is what authorises it, and it only ever affects the one record it names.
 *
 * Responds with a page rather than JSON: a human is reading this in a browser
 * they opened from their inbox.
 */
const router = Router();

const modelFor = (kind) => (kind === 'lead' ? Lead : kind === 'customer' ? Customer : null);

function page({ title, body, accent = '#5B2BC9' }) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | PurpleBox Storage</title>
<style>
  body { margin:0; background:#FBF8F2; color:#14081F; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 520px; margin: 12vh auto; padding: 0 20px; }
  .card { background:#fff; border:1px solid rgba(20,8,31,.08); border-radius:18px; padding:32px; }
  h1 { font-size:20px; margin:0 0 10px; }
  p { font-size:14.5px; line-height:1.6; color:#4A4357; margin:0 0 12px; }
  .accent { color:${accent}; font-weight:700; }
  form { margin-top:18px; }
  button { background:${accent}; color:#fff; border:0; border-radius:999px;
           padding:10px 20px; font-size:14px; font-weight:700; cursor:pointer; }
  .muted { font-size:12.5px; color:#756E80; margin-top:18px; }
</style></head>
<body><div class="wrap"><div class="card">${body}</div>
<p class="muted">PurpleBox Storage · Al Quoz, Dubai</p>
</div></body></html>`;
}

router.get('/unsubscribe/:kind/:id/:token', async (req, res) => {
    const { kind, id, token } = req.params;
    const Model = modelFor(kind);
    if (!Model || !isValidObjectId(id) || !verifyUnsubscribeToken(kind, id, token)) {
        return res.status(400).send(page({
            title: 'Link not recognised',
            body: '<h1>This link is not valid</h1><p>It may have been altered in transit. Reply to any of our emails and we will take you off the list by hand.</p>',
            accent: '#B91C1C',
        }));
    }

    const doc = await Model.findByIdAndUpdate(id, { $set: { unsubscribed: true } }, { new: true }).select('fullName');
    if (!doc) {
        return res.status(404).send(page({
            title: 'Not found',
            body: '<h1>We could not find that record</h1><p>You are not on our marketing list.</p>',
            accent: '#B91C1C',
        }));
    }

    res.send(page({
        title: 'Unsubscribed',
        body: `<h1>You're unsubscribed</h1>
<p>We won't send you any more offers or announcements.</p>
<p>You will still receive <span class="accent">invoices, contract notices and anything else about your storage</span>. Those are not marketing, and we cannot switch them off.</p>
<form method="POST" action="/api/marketing/resubscribe/${kind}/${id}/${token}">
  <button type="submit">Actually, keep me subscribed</button>
</form>`,
    }));
});

// Because the usual reason someone lands on that page is a mis-tap.
router.post('/resubscribe/:kind/:id/:token', async (req, res) => {
    const { kind, id, token } = req.params;
    const Model = modelFor(kind);
    if (!Model || !isValidObjectId(id) || !verifyUnsubscribeToken(kind, id, token)) {
        return res.status(400).send(page({ title: 'Link not recognised', body: '<h1>This link is not valid</h1>', accent: '#B91C1C' }));
    }
    await Model.findByIdAndUpdate(id, { $set: { unsubscribed: false } });
    res.send(page({
        title: 'Subscribed',
        body: '<h1>You\'re back on the list</h1><p>You will keep receiving our offers and announcements. You can unsubscribe again from any of them.</p>',
    }));
});

export default router;
