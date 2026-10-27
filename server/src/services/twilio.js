/**
 * SMS through Twilio. Connected once — from Settings → Integrations, or from
 * the form a bot shows the first time it is asked to send a text — with the
 * account SID, auth token and the number texts come from.
 */

const API = 'https://api.twilio.com/2010-04-01';

export function twilioConfigured() {
   return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

const auth = (sid, token) => `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

/** "+971 50 123 4567", "0501234567" → "+971501234567". UAE numbers assumed when no country code is given. */
export function toE164(phone) {
   let d = String(phone || '').replace(/[^\d+]/g, '');
   if (d.startsWith('+')) return d.length >= 9 ? d : '';
   d = d.replace(/^00/, '');
   if (/^0\d{8,9}$/.test(d)) d = `971${d.slice(1)}`;
   return d.length >= 9 ? `+${d}` : '';
}

/** Checks the SID and token with Twilio; returns the account's name. */
export async function verifyTwilio(sid, token) {
   const r = await fetch(`${API}/Accounts/${encodeURIComponent(sid)}.json`, { headers: { Authorization: auth(sid, token) } });
   const body = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(body.message || `Twilio said HTTP ${r.status}`);
   return { name: body.friendly_name || '', status: body.status || '' };
}

export async function sendSms({ to, body }) {
   if (!twilioConfigured()) throw new Error('SMS is not set up — connect Twilio first');
   const sid = process.env.TWILIO_ACCOUNT_SID;
   const number = toE164(to);
   if (!number) throw new Error(`${to} is not a phone number`);
   const form = new URLSearchParams({ To: number, From: process.env.TWILIO_FROM, Body: String(body || '').slice(0, 1600) });
   const r = await fetch(`${API}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: auth(sid, process.env.TWILIO_AUTH_TOKEN), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
   });
   const out = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(out.message || `Twilio said HTTP ${r.status}`);
   return { sid: out.sid, to: number, status: out.status };
}
