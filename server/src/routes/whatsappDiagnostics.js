import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';

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

    res.json({ steps, phoneId, tokenHint: mask(token), usingOverride });
});

function mask(t) {
    return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : '(short)';
}

export default router;
