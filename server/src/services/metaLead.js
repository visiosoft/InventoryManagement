import { Lead } from '../models/index.js';
import { normalizeLeadPhone } from '../routes/leads.js';
import { routeInboundLead } from './leadRouting.js';
import { notifyLeadAssigned } from './leadNotify.js';
import { isExistingCustomerPhone } from './customerLeads.js';
import { PLACEHOLDER_NAME } from './leadNames.js';

/**
 * Leads from Meta ads (Facebook / Instagram lead forms).
 *
 * They reach us two ways and both end up here:
 *   1. Somebody posts the form's answers to /api/public/meta-lead (Meta's lead
 *      webhook, Zapier, Make, Pabbly …).
 *   2. The person taps "send" on a Click-to-WhatsApp lead form and the answers
 *      arrive as an ordinary WhatsApp message beginning "I filled out your form".
 *
 * Either way one lead per phone number: a repeat adds a note, never a duplicate.
 */

const clean = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Pull the answers out of the WhatsApp message a lead form produces, or null if it isn't one. */
export function parseFormMessage(text) {
  const t = String(text || '');
  if (!/filled out your form/i.test(t) && !(/full name\s*:/i.test(t) && /phone( number)?\s*:/i.test(t))) return null;
  const answers = {};
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]{2,80}?)\s*:\s*(.+?)\s*$/);
    if (m) answers[m[1].trim()] = m[2].trim();
  }
  const pick = (re) => {
    const k = Object.keys(answers).find((key) => re.test(key));
    return k ? answers[k] : '';
  };
  const phone = pick(/phone|mobile|whatsapp/i);
  const fullName = pick(/^(full )?name$/i);
  if (!phone && !fullName) return null;
  const known = new Set([pick(/^(full )?name$/i), phone, pick(/e-?mail/i)]);
  const extras = Object.entries(answers)
    .filter(([k, v]) => !/^(full )?name$/i.test(k) && !/phone|mobile|whatsapp|e-?mail/i.test(k) && !known.has(v))
    .map(([k, v]) => ({ question: clean(k, 120), answer: clean(v, 200) }));
  return { fullName: clean(fullName, 120), phone: clean(phone, 40), email: clean(pick(/e-?mail/i), 160), extras };
}

/** Accepts flat JSON/form fields, or Meta's own `field_data: [{name, values}]` shape. */
export function normaliseIncoming(body = {}) {
  const flat = { ...body };
  const fd = body.field_data || body.fieldData || body.answers;
  if (Array.isArray(fd)) {
    for (const f of fd) {
      if (f?.name) flat[f.name] = Array.isArray(f.values) ? f.values.join(', ') : (f.value ?? f.values ?? '');
    }
  }
  const get = (...keys) => {
    for (const k of keys) {
      const hit = Object.keys(flat).find((x) => x.toLowerCase().replace(/[\s-]+/g, '_') === k);
      if (hit && flat[hit] !== '' && flat[hit] != null && typeof flat[hit] !== 'object') return String(flat[hit]);
    }
    return '';
  };
  const first = get('first_name');
  const last = get('last_name');
  const fullName = get('full_name', 'name', 'fullname') || [first, last].filter(Boolean).join(' ');
  const phone = get('phone_number', 'phone', 'mobile', 'mobile_number', 'whatsapp', 'whatsapp_number');
  const email = get('email', 'email_address', 'e_mail');
  const skip = new Set(['full_name', 'name', 'fullname', 'first_name', 'last_name', 'phone_number', 'phone', 'mobile', 'mobile_number', 'whatsapp', 'whatsapp_number', 'email', 'email_address', 'e_mail',
    'field_data', 'fielddata', 'answers', 'form_name', 'campaign', 'campaign_name', 'ad', 'ad_name', 'adset', 'adset_name', 'platform', 'leadgen_id', 'created_time', 'form_id', 'ad_id', 'page_id']);
  const extras = Object.entries(flat)
    .filter(([k, v]) => !skip.has(k.toLowerCase().replace(/[\s-]+/g, '_')) && v != null && typeof v !== 'object' && String(v).trim())
    .map(([k, v]) => ({ question: clean(k.replace(/_/g, ' '), 120), answer: clean(v, 200) }));
  const meta = {
    form: clean(get('form_name'), 120), campaign: clean(get('campaign_name', 'campaign'), 120),
    ad: clean(get('ad_name', 'ad'), 120), platform: clean(get('platform'), 40),
  };
  return { fullName: clean(fullName, 120), phone: clean(phone, 40), email: clean(email, 160), extras, meta };
}

const describe = ({ extras = [], meta = {} }) => [
  ...extras.map((e) => `${e.question}: ${e.answer}`),
  meta.platform && `Platform: ${meta.platform}`, meta.campaign && `Campaign: ${meta.campaign}`,
  meta.ad && `Ad: ${meta.ad}`, meta.form && `Form: ${meta.form}`,
].filter(Boolean).join('\n');

/**
 * Save one Meta lead. `existing` is a lead already found for this phone (the
 * WhatsApp path creates it a moment before this runs).
 * Returns { lead, created } or { error }.
 */
export async function ingestMetaLead(fields, { channel = 'form', existing = null } = {}) {
  const phoneNormalized = normalizeLeadPhone(fields.phone);
  if (!phoneNormalized) return { error: 'A phone number is required' };
  const details = describe(fields);
  const note = `Meta ad lead (${channel === 'whatsapp' ? 'WhatsApp form' : 'instant form'})${details ? `\n${details}` : ''}`;
  const lead = existing || await Lead.findOne({ phoneNormalized });

  if (lead) {
    // Fill what is missing, never overwrite what somebody here typed.
    if (fields.fullName && (!lead.fullName || PLACEHOLDER_NAME.test(String(lead.fullName)))) lead.fullName = fields.fullName;
    if (fields.email && !lead.email) lead.email = fields.email;
    if (!lead.tags?.includes('meta-ads')) lead.tags = [...(lead.tags || []), 'meta-ads'];
    // A chat that only just began is a Meta lead; an old lead keeps its source.
    if (existing && lead.source === 'whatsapp' && Date.now() - new Date(lead.createdAt || Date.now()) < 10 * 60_000) lead.source = 'meta_ads';
    lead.notes = [lead.notes, details].filter(Boolean).join('\n');
    lead.timeline.push({ type: 'note', text: note });
    await lead.save();
    return { lead, created: false };
  }

  let ownerId = null; let routingNote = '';
  const decision = await routeInboundLead({ phoneNormalized }).catch(() => null);
  if (decision && !decision.off) {
    ownerId = decision.ownerId || null;
    routingNote = ownerId ? `Assigned by distribution rules — ${decision.reason}` : `Left unassigned — ${decision.reason}`;
  } else {
    routingNote = decision?.off ? 'Left unassigned — distribution is off' : 'Left unassigned — could not route';
  }
  const already = await isExistingCustomerPhone(phoneNormalized).catch(() => false);
  const parts = fields.fullName.split(/\s+/).filter(Boolean);
  const created = await Lead.create({
    firstName: parts[0] || '', lastName: parts.slice(1).join(' '),
    fullName: fields.fullName || `Meta Lead ${phoneNormalized.slice(-4)}`,
    phone: fields.phone, phoneNormalized, email: fields.email || '',
    source: 'meta_ads', status: already ? 'already_customer' : 'new',
    leadDateTime: new Date(), unitsNeeded: 1, tags: ['meta-ads'], notes: details,
    owner: ownerId, assignedAt: ownerId ? new Date() : null, autoAssigned: Boolean(ownerId),
    timeline: [{ type: 'created', text: note }, { type: 'note', text: routingNote }],
  });
  if (ownerId) notifyLeadAssigned({ lead: created, ownerId, reason: routingNote.replace(/^Assigned by distribution rules — /, '') }).catch(() => {});
  return { lead: created, created: true };
}
