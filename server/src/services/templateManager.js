import crypto from 'crypto';
import { CampaignTemplate, TemplateImage } from '../models/index.js';
import { listWhatsAppTemplates, resolveWabaId } from './whatsapp.js';
import { pushConfigured, pushToUser } from './push.js';

/**
 * WhatsApp templates written here and submitted to Meta.
 *
 * Meta reviews every template before it can be used — usually within minutes,
 * sometimes up to a day. This keeps the local copy, sends it, and then follows
 * Meta's verdict, so the page can say Waiting / Approved / Rejected (and why)
 * without anybody opening Meta Business Manager.
 */

const GRAPH = 'https://graph.facebook.com/v20.0';
const token = () => String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();

export const NAME_RE = /^[a-z0-9_]{1,200}$/;

/** What is wrong with a template before Meta has to say so. Empty = fine. */
export function validateTemplate(t) {
  const errs = [];
  if (!NAME_RE.test(String(t.name || ''))) errs.push('The name can only use lowercase letters, numbers and underscores, e.g. winback_offer_oct');
  const body = String(t.bodyText || '');
  if (!body.trim()) errs.push('The message text is empty');
  if (body.length > 1024) errs.push('The message text is over 1024 characters');
  const vars = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  vars.forEach((n, i) => { if (n !== i + 1) errs.push('Variables must be numbered in order: {{1}}, {{2}}, …'); });
  if (vars.length && /^\s*\{\{\d+\}\}/.test(body)) errs.push('The text cannot start with a variable');
  if (vars.length && /\{\{\d+\}\}\s*$/.test(body)) errs.push('The text cannot end with a variable');
  const examples = (t.bodyExamples || []).filter((e) => String(e).trim());
  if (vars.length && examples.length < vars.length) errs.push(`Give an example value for each of the ${vars.length} variable(s)`);
  if ((t.footerText || '').length > 60) errs.push('The footer is over 60 characters');
  for (const b of t.buttons || []) {
    if (!String(b.text || '').trim() || String(b.text).length > 25) errs.push('Button text must be 1–25 characters');
    if (b.type === 'URL' && !/^https:\/\//i.test(b.url || '')) errs.push('A link button needs an https:// address');
  }
  if ((t.buttons || []).filter((b) => b.type === 'URL').length > 1) errs.push('Only one link button is allowed');
  if ((t.buttons || []).length > 3) errs.push('At most three buttons');
  if (t.headerType === 'image' && !t.imageKey) errs.push('Upload the header image');
  return errs;
}

async function graph(path, init = {}) {
  const r = await fetch(path.startsWith('http') ? path : `${GRAPH}/${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.error_user_msg || body?.error?.message || `Meta said HTTP ${r.status}`);
  return body;
}

async function appId() {
  const body = await graph(`debug_token?input_token=${encodeURIComponent(token())}`, { headers: { Authorization: `Bearer ${token()}` } });
  const id = body?.data?.app_id;
  if (!id) throw new Error('Could not work out which Meta app this token belongs to');
  return id;
}

/** Meta's resumable upload: the sample image a template header needs for review. */
export async function uploadSampleHandle(buffer, contentType, fileName) {
  const app = await appId();
  const session = await graph(`${app}/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(contentType)}&file_name=${encodeURIComponent(fileName || 'header.jpg')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` },
  });
  const up = await graph(session.id, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token()}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  if (!up?.h) throw new Error('Meta did not accept the sample image');
  return up.h;
}

export function buildComponents(t, headerHandle) {
  const components = [];
  if (t.headerType === 'image') components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } });
  const vars = [...new Set([...String(t.bodyText).matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))];
  components.push({
    type: 'BODY',
    text: t.bodyText,
    ...(vars.length ? { example: { body_text: [vars.map((_, i) => String(t.bodyExamples[i] || 'Sample'))] } } : {}),
  });
  if (String(t.footerText || '').trim()) components.push({ type: 'FOOTER', text: t.footerText.trim() });
  if ((t.buttons || []).length) {
    components.push({
      type: 'BUTTONS',
      buttons: t.buttons.map((b) => (b.type === 'URL' ? { type: 'URL', text: b.text, url: b.url } : { type: 'QUICK_REPLY', text: b.text })),
    });
  }
  return components;
}

/** Send a saved template to Meta for review. */
export async function submitTemplate(templateId) {
  const t = await CampaignTemplate.findById(templateId);
  if (!t) throw new Error('Template not found');
  if (!['draft', 'REJECTED'].includes(t.status)) throw new Error(`This template is already ${t.status}`);
  const errs = validateTemplate(t);
  if (errs.length) throw new Error(errs[0]);
  const waba = await resolveWabaId();
  if (!waba) throw new Error('The WhatsApp Business Account ID is not set');

  try {
    let handle = '';
    if (t.headerType === 'image') {
      const img = await TemplateImage.findOne({ key: t.imageKey }).lean();
      if (!img) throw new Error('The header image is missing — upload it again');
      handle = await uploadSampleHandle(Buffer.from(img.data.buffer ?? img.data), img.contentType, img.fileName);
    }
    const res = await graph(`${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components: buildComponents(t, handle) }),
    });
    t.metaId = res.id || t.metaId;
    t.status = String(res.status || 'PENDING').toUpperCase();
    t.submittedAt = new Date();
    t.statusChangedAt = new Date();
    t.rejectedReason = '';
    t.lastError = '';
    await t.save();
    return t;
  } catch (e) {
    t.lastError = e.message;
    await t.save();
    throw e;
  }
}

/** Read Meta's current verdict for every template we have sent. */
export async function refreshTemplateStatuses() {
  const mine = await CampaignTemplate.find({ status: { $nin: ['draft'] } });
  if (!mine.length) return { checked: 0, changed: 0 };
  const list = await listWhatsAppTemplates({ force: true });
  if (list.error) throw new Error(list.error);
  const byKey = new Map(list.templates.map((m) => [`${m.name}:${m.language}`, m]));
  let changed = 0;
  for (const t of mine) {
    const m = byKey.get(`${t.name}:${t.language}`);
    t.statusCheckedAt = new Date();
    if (!m) {
      // Gone from Meta's list: deleted there.
      if (t.status !== 'DELETED') { t.status = 'DELETED'; t.statusChangedAt = new Date(); changed += 1; }
      await t.save();
      continue;
    }
    const next = String(m.status || '').toUpperCase();
    if (next && next !== t.status) {
      const before = t.status;
      t.status = next;
      t.statusChangedAt = new Date();
      t.metaId = m.id || t.metaId;
      t.rejectedReason = m.rejectedReason || '';
      changed += 1;
      await t.save();
      await tellCreator(t, before).catch(() => {});
      continue;
    }
    if (m.rejectedReason && m.rejectedReason !== t.rejectedReason) t.rejectedReason = m.rejectedReason;
    await t.save();
  }
  return { checked: mine.length, changed };
}

async function tellCreator(t, before) {
  if (!t.createdBy || !pushConfigured()) return;
  if (!['APPROVED', 'REJECTED'].includes(t.status)) return;
  await pushToUser(t.createdBy, {
    title: t.status === 'APPROVED' ? 'WhatsApp template approved' : 'WhatsApp template rejected',
    body: t.status === 'APPROVED' ? `"${t.name}" can now be used in a campaign.` : `"${t.name}" was rejected${t.rejectedReason ? `: ${t.rejectedReason}` : ''}.`,
    url: '/campaign-studio',
  });
  return before;
}

/** A status event from Meta's webhook, for an instant update. */
export async function applyTemplateStatusEvent(value = {}) {
  const name = value.message_template_name;
  const language = value.message_template_language;
  const event = String(value.event || '').toUpperCase();
  if (!name || !event) return false;
  const t = await CampaignTemplate.findOne({ name, ...(language ? { language } : {}) });
  if (!t || t.status === event) return false;
  const before = t.status;
  t.status = event;
  t.statusChangedAt = new Date();
  if (value.message_template_id) t.metaId = String(value.message_template_id);
  t.rejectedReason = event === 'REJECTED' ? String(value.reason || '') : '';
  await t.save();
  await tellCreator(t, before).catch(() => {});
  return true;
}

export const newImageKey = () => crypto.randomBytes(16).toString('hex');

/**
 * Submit the unit-sizes carousel to Meta: one card per unit size that has a
 * photo (server/assets/carousel), each photo uploaded as the card's sample.
 * Meta wants at least two cards.
 */
export async function submitUnitSizesCarousel() {
  const fs = await import('fs');
  const { readyCards, cardImagePath, carouselTemplate } = await import('./carousel.js');
  const cards = readyCards();
  if (cards.length < 2) throw new Error('At least two cards need a photo before the carousel can be sent to Meta');
  const waba = await resolveWabaId();
  if (!waba) throw new Error('The WhatsApp Business Account ID is not set');
  const handles = [];
  for (const c of cards) handles.push(await uploadSampleHandle(fs.readFileSync(cardImagePath(c.code)), 'image/jpeg', `purplebox_unit_${c.code}.jpg`));
  const res = await graph(`${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(carouselTemplate(cards, handles)),
  });
  return { id: res.id, status: String(res.status || 'PENDING').toUpperCase(), cards: cards.map((c) => c.label) };
}
