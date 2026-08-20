import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { WhatsAppWebhookHit, WhatsAppWebhookEvent, WhatsAppMessage } from '../models/index.js';

const router = Router();
const GRAPH = 'https://graph.facebook.com/v20.0';

async function graph(path, token) {
    const r = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body, error: body?.error?.message || '' };
}

/**
 * Run the checks needed to work out why WhatsApp will not connect, in the
 * order that isolates the cause: is the token valid → what can it reach →
 * can it see this phone number.
 *
 * Accepts optional overrides so a token can be tested before it is saved.
 * The token is never echoed back — only a masked hint.
 */
router.post('/diagnostics', requireAdmin, async (req, res) => {
    const token = String(req.body?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneId = String(req.body?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const usingOverride = Boolean(req.body?.accessToken);

    const steps = [];
    const add = (name, ok, detail, fix = '') => steps.push({ name, ok, detail, fix });

    if (!token) {
        add('Access token present', false, 'No token saved and none supplied.',
            'Paste a token above, or save one in Settings → WhatsApp.');
        return res.json({ steps, phoneId, tokenHint: '', usingOverride });
    }
    add('Access token present', true,
        `${usingOverride ? 'Using the token typed above' : 'Using the saved token'} · ${token.length} characters`);

    // 1. Is the token valid, and what kind is it?
    const dbg = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, token);
    const d = dbg.body?.data || {};
    if (!dbg.ok || !d.is_valid) {
        add('Token is valid', false, dbg.error || 'Meta says this token is not valid.',
            'Generate a new token in Business Settings → System Users.');
        return res.json({ steps, phoneId, tokenHint: mask(token), usingOverride });
    }
    const expiry = d.expires_at === 0 ? 'never expires' : `expires ${new Date(d.expires_at * 1000).toUTCString()}`;
    const expired = d.expires_at !== 0 && d.expires_at * 1000 < Date.now();
    add('Token is valid', !expired,
        `${d.type || 'unknown type'} on app "${d.application || '?'}" · ${expiry}`,
        expired ? 'This token has expired — generate a new one.' : '');

    // 2. Does it carry the WhatsApp permissions at all?
    const scopes = d.scopes || [];
    const needed = ['whatsapp_business_messaging', 'whatsapp_business_management'];
    const missing = needed.filter((s) => !scopes.includes(s));
    add('WhatsApp permissions', missing.length === 0,
        scopes.length ? scopes.join(', ') : '(none)',
        missing.length ? `Missing: ${missing.join(', ')}. Add them to the system user and regenerate the token.` : '');

    // 3. THE usual culprit: permissions granted, but no asset attached.
    const granular = d.granular_scopes || [];
    const waTargets = granular
        .filter((g) => needed.includes(g.scope))
        .flatMap((g) => g.target_ids || []);
    add('WhatsApp accounts attached to this token', waTargets.length > 0,
        waTargets.length ? waTargets.join(', ') : 'none — the token can use its permissions on no account',
        waTargets.length
            ? ''
            : 'Business Settings → System Users → your user → Add Assets → WhatsApp Accounts → Full control. Then GENERATE A NEW TOKEN: assets granted after a token is issued do not apply to it.');

    // 4. Who is the token, and what is assigned to that identity?
    const me = await graph('me?fields=id,name', token);
    if (me.ok) {
        add('Token identity', true, `${me.body?.name || '(unnamed)'} · id ${me.body?.id}`);
        const assigned = await graph(`${me.body.id}/assigned_whatsapp_business_accounts?fields=id,name`, token);
        const list = assigned.body?.data || [];
        add('WhatsApp accounts assigned to this user', list.length > 0,
            list.length ? list.map((w) => `${w.name || '(unnamed)'} — ${w.id}`).join(' · ') : 'none',
            list.length ? '' : 'Assign the WhatsApp Business Account to this system user, then regenerate the token.');

        // If a WABA is reachable, read its real phone numbers so the correct
        // Phone number ID can be copied rather than guessed.
        for (const waba of list) {
            const nums = await graph(`${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
            if (nums.ok) {
                const rows = (nums.body?.data || []).map((n) => `${n.display_phone_number} (${n.verified_name || 'no name'}) → id ${n.id}`);
                add(`Numbers on ${waba.name || waba.id}`, rows.length > 0,
                    rows.length ? rows.join(' · ') : 'no numbers on this account');
            }
        }
    } else {
        add('Token identity', false, me.error || 'Could not read the token identity.');
    }

    // 5. The actual question: can it see this phone number?
    if (!phoneId) {
        add('Phone number reachable', false, 'No Phone number ID saved or supplied.');
    } else {
        const num = await graph(`${phoneId}?fields=display_phone_number,verified_name`, token);
        add('Phone number reachable', num.ok,
            num.ok
                ? `${num.body?.display_phone_number} · ${num.body?.verified_name || 'no display name'}`
                : num.error,
            num.ok ? '' : 'Meta returns this both for a wrong id and for an id the token may not see. If the checks above are green, the id is wrong; if they are red, fix those first.');
    }

    // 6. Receiving side. Sending can work perfectly while replies never
    //    arrive, which is a separate chain: app secret → Meta delivering →
    //    signature matching.
    const secret = process.env.WHATSAPP_APP_SECRET || '';
    add('App secret set (needed to accept replies)', Boolean(secret),
        secret ? `${secret.length} characters` : 'missing — every delivery from Meta is rejected with 401',
        secret ? '' : 'Copy the App Secret from Meta → App → Settings → Basic into Settings → WhatsApp.');

    const hits = await WhatsAppWebhookHit.find().sort({ at: -1 }).limit(30).lean();
    const lastOk = hits.find((h) => h.ok);
    const lastBad = hits.find((h) => !h.ok);
    add('Meta has called the webhook', hits.length > 0,
        hits.length
            ? `${hits.length} recent call(s), last ${new Date(hits[0].at).toUTCString()}`
            : 'no calls recorded since logging was added',
        hits.length
            ? ''
            : 'Meta → WhatsApp → Configuration: set the callback URL, then Manage → subscribe to the "messages" field. The field subscription is separate from saving the URL and is the usual omission.');
    if (hits.length) {
        add('Calls accepted', Boolean(lastOk),
            lastOk ? `last accepted ${new Date(lastOk.at).toUTCString()}` : `all rejected — ${lastBad?.reason || 'unknown reason'}`,
            lastOk ? '' : 'Meta is delivering but we are refusing it. Check the App Secret above matches this app.');
    }

    // 7. Is the app actually subscribed to the WhatsApp Business Account?
    //    Without this Meta accepts the callback URL and then sends nothing,
    //    which is indistinguishable from a misconfigured webhook.
    const waba = String(req.body?.wabaId || process.env.WHATSAPP_WABA_ID || '').trim();
    if (waba) {
        const subs = await graph(`${waba}/subscribed_apps`, token);
        const apps = (subs.body?.data || []).map((a) => a.whatsapp_business_api_data?.name || a.whatsapp_business_api_data?.id || 'unknown');
        add('App subscribed to the WhatsApp account', subs.ok && apps.length > 0,
            subs.ok
                ? (apps.length ? apps.join(', ') : 'no app is subscribed — Meta will not send anything')
                : subs.error,
            subs.ok && apps.length === 0
                ? 'Press "Subscribe app to WABA" below, or do it in Meta → WhatsApp → Configuration.'
                : (!subs.ok ? 'The token cannot read this WhatsApp account — fix the asset checks above first.' : ''));
    } else {
        add('App subscribed to the WhatsApp account', false,
            'No WhatsApp Business Account ID supplied.',
            'Enter the WABA ID above (WhatsApp Manager → your account) so this can be checked.');
    }

    res.json({ steps, phoneId, tokenHint: mask(token), usingOverride, hits, wabaId: waba });
});

// Subscribe the app to the WhatsApp Business Account. This is the step that
// makes Meta actually deliver inbound messages to the callback URL.
router.post('/subscribe-waba', requireAdmin, async (req, res) => {
    const token = String(req.body?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const waba = String(req.body?.wabaId || process.env.WHATSAPP_WABA_ID || '').trim();
    if (!token) return res.status(400).json({ error: 'No access token available' });
    if (!waba) return res.status(400).json({ error: 'A WhatsApp Business Account ID is required' });

    const r = await fetch(`${GRAPH}/${waba}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(400).json({ error: body?.error?.message || `HTTP ${r.status}` });
    res.json({ ok: true, result: body });
});

function mask(t) {
    return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : '(short)';
}

/**
 * Which webhook fields Meta has actually sent, and the shape of each.
 *
 * "Is Meta sending us X?" has come up for every part of this integration —
 * inbound messages, delivery receipts, and now echoes of messages staff send
 * from the WhatsApp Business app. Guessing from the docs is slower and less
 * reliable than reading what has arrived, so this reports it.
 *
 * Message text is never returned: only the field names, the keys inside them
 * and counts, which is all that is needed to tell whether a field is arriving.
 */
router.get('/webhook-fields', requireAdmin, async (_req, res) => {
    const events = await WhatsAppWebhookEvent.find({})
        .sort({ createdAt: -1 }).limit(400).select('payload createdAt').lean();

    const seen = new Map();
    for (const ev of events) {
        for (const entry of ev.payload?.entry || []) {
            for (const change of entry?.changes || []) {
                const field = change?.field || '(none)';
                const value = change?.value || {};
                const row = seen.get(field) || { field, count: 0, valueKeys: new Set(), sampleShape: null, lastAt: null };
                row.count += 1;
                for (const k of Object.keys(value)) row.valueKeys.add(k);
                if (!row.lastAt) row.lastAt = ev.createdAt;
                // One redacted sample: the keys of the first array element, so
                // the shape is visible without exposing what anyone wrote.
                if (!row.sampleShape) {
                    for (const [k, v] of Object.entries(value)) {
                        if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
                            row.sampleShape = { arrayKey: k, itemKeys: Object.keys(v[0]) };
                            break;
                        }
                    }
                }
                seen.set(field, row);
            }
        }
    }

    // The structure of a stored payload, values replaced by their type, so a
    // message shape can be read without reading anyone's message.
    const shapeOf = (v, depth = 0) => {
        if (v === null) return 'null';
        if (Array.isArray(v)) return depth > 2 ? '[…]' : [shapeOf(v[0], depth + 1)];
        if (typeof v !== 'object') return typeof v;
        if (depth > 2) return '{…}';
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
    };

    const wanted = String(_req.query.shape || '').trim();
    const shapeSample = wanted
        ? await WhatsAppMessage.findOne({ type: wanted }).sort({ occurredAt: -1 }).select('raw type direction').lean()
        : null;

    // Where the stored messages came from. The top-level keys of the saved
    // payload identify the writer: our own send route stores the Graph
    // response, the webhook stores Meta's message object.
    const recent = await WhatsAppMessage.find({})
        .sort({ occurredAt: -1 }).limit(300).select('direction type raw occurredAt sentByAi').lean();

    const sources = new Map();
    for (const m of recent) {
        const key = `${m.direction}|${Object.keys(m.raw || {}).sort().join(',') || '(empty)'}`;
        const row = sources.get(key) || { direction: m.direction, rawKeys: Object.keys(m.raw || {}).sort(), count: 0, types: new Set(), lastAt: m.occurredAt };
        row.count += 1;
        row.types.add(m.type);
        sources.set(key, row);
    }

    res.json({
        eventsExamined: events.length,
        oldest: events.length ? events[events.length - 1].createdAt : null,
        fields: [...seen.values()]
            .map((r) => ({ ...r, valueKeys: [...r.valueKeys] }))
            .sort((a, b) => b.count - a.count),
        shape: shapeSample ? { type: shapeSample.type, direction: shapeSample.direction, raw: shapeOf(shapeSample.raw) } : null,
        messagesExamined: recent.length,
        messageSources: [...sources.values()]
            .map((r) => ({ ...r, types: [...r.types] }))
            .sort((a, b) => b.count - a.count),
    });
});

/**
 * What this app is actually subscribed to on Meta's side.
 *
 * Ticking a webhook field in the App Dashboard can fail for reasons the
 * dashboard does not explain — the field may not exist for this app, or the
 * number may not have completed Coexistence onboarding. This reports the real
 * state so the failure can be told apart from a mis-click.
 */
router.get('/webhook-subscription', requireAdmin, async (_req, res) => {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const secret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
    const waba = String(process.env.WHATSAPP_WABA_ID || '').trim();
    if (!token) return res.status(400).json({ error: 'No WhatsApp access token is configured' });

    const out = { waba: waba || null };

    // Which app the token belongs to, and therefore whose subscriptions matter.
    const dbg = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, token);
    out.token = dbg.ok
        ? {
            appId: dbg.body?.data?.app_id || null,
            appName: dbg.body?.data?.application || null,
            valid: dbg.body?.data?.is_valid ?? null,
            scopes: dbg.body?.data?.scopes || [],
            expiresAt: dbg.body?.data?.expires_at || null,
        }
        : { error: dbg.error || `HTTP ${dbg.status}` };

    // Which apps the WhatsApp Business Account has authorised.
    if (waba) {
        const subs = await graph(`${waba}/subscribed_apps`, token);
        out.subscribedApps = subs.ok ? subs.body?.data || [] : { error: subs.error || `HTTP ${subs.status}` };
    } else {
        out.subscribedApps = { error: 'WHATSAPP_WABA_ID is not set' };
    }

    // The webhook fields the app is subscribed to. This needs an app access
    // token, which is the app id and secret joined — a user token is rejected.
    const appId = out.token?.appId;
    if (appId && secret) {
        const appToken = `${appId}|${secret}`;
        const r = await graph(`${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`, appToken);
        if (r.ok) {
            const wa = (r.body?.data || []).find((d) => d.object === 'whatsapp_business_account');
            out.webhook = wa
                ? {
                    callbackUrl: wa.callback_url,
                    active: wa.active,
                    fields: (wa.fields || []).map((f) => (typeof f === 'string' ? f : f.name)).sort(),
                }
                : { error: 'This app has no whatsapp_business_account webhook subscription' };
        } else {
            out.webhook = { error: r.error || `HTTP ${r.status}` };
        }
    } else {
        out.webhook = { error: !appId ? 'Could not determine the app id from the token' : 'WHATSAPP_APP_SECRET is not set' };
    }

    // The answer to the question that prompted this.
    const fields = Array.isArray(out.webhook?.fields) ? out.webhook.fields : [];
    out.echoes = {
        subscribed: fields.some((f) => f.endsWith('message_echoes')),
        fieldsMatching: fields.filter((f) => f.endsWith('message_echoes')),
    };

    res.json(out);
});

export default router;
