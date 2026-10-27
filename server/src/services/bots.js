/**
 * Bots: jobs that run on a clock and keep their latest result for the
 * dashboard.
 *
 *   ai_report        a question in plain words, answered by the assistant
 *                    through the same tools (and the web, when allowed) —
 *                    "competitor prices for 50 sq ft", "yesterday's leads".
 *   contract_emails  everyone whose contract ends in the next N days gets an
 *                    email. By default each run's emails wait on the
 *                    dashboard for a person to send; an admin can set a bot
 *                    to send by itself, inside a daily cap.
 *
 * A minute tick runs whatever is due (botsTick). Each bot runs once per
 * Dubai day at most: lastRunDay is set before the run, so a restart cannot
 * send twice.
 */

import { Bot, BotRun, Contract, Lead, User, WhatsAppMessage } from '../models/index.js';

const DUBAI_OFFSET_H = 4;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dubaiParts(now = new Date()) {
   const local = new Date(now.getTime() + DUBAI_OFFSET_H * 3600_000);
   return { hour: local.getUTCHours(), dayOfWeek: local.getUTCDay(), dayOfMonth: local.getUTCDate(), dayKey: local.toISOString().slice(0, 10) };
}

/** Whether a bot's moment has come and it has not run today. */
export function isBotDue(bot, now = new Date()) {
   if (!bot || bot.enabled === false) return false;
   const s = bot.schedule || {};
   if (!s.cadence || s.cadence === 'manual') return false;
   const { hour, dayOfWeek, dayOfMonth, dayKey } = dubaiParts(now);
   if (bot.lastRunDay === dayKey) return false;
   if (hour < Number(s.hour ?? 9)) return false;
   if (s.cadence === 'weekly' && dayOfWeek !== Number(s.dayOfWeek ?? 1)) return false;
   if (s.cadence === 'monthly' && dayOfMonth !== Number(s.dayOfMonth ?? 1)) return false;
   return true;
}

/** "Every Monday 09:00" — for the card. */
export function describeSchedule(s = {}) {
   if (!s.cadence || s.cadence === 'manual') return 'Only when run';
   const at = `${String(s.hour ?? 9).padStart(2, '0')}:00`;
   if (s.cadence === 'daily') return `Daily ${at}`;
   if (s.cadence === 'weekly') return `Every ${DAYS[Number(s.dayOfWeek ?? 1)]} ${at}`;
   const d = Number(s.dayOfMonth ?? 1);
   return `Monthly on the ${d}${['st', 'nd', 'rd'][d - 1] || 'th'} ${at}`;
}

export const DEFAULT_SUBJECT = 'Your PurpleBox storage ends on {endDate}';
export const DEFAULT_MESSAGE = `Hi {name},

Your storage unit {unit} at PurpleBox ends on {endDate}.

Would you like to renew? Just reply to this email, or let us know your plans and we will help with moving out.

Thank you,
PurpleBox Storage`;

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' }) : '');

/** {name}, {unit}, {endDate}, {contractNo}, {daysLeft} filled in; unknown braces left as they are. */
export function fillTemplate(text, vars) {
   return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m === '{name}' ? 'there' : m));
}

/**
 * Who gets an email this run: active contracts ending in the window, with an
 * email on file, not already decided (renewing / not renewing), and not
 * emailed by this bot in the last 7 days.
 */
export function pickRecipients(contracts, { recentlyEmailed = new Set(), subject, message, now = new Date() } = {}) {
   const items = [];
   const today = new Date(new Date(now).setHours(0, 0, 0, 0));
   for (const k of contracts) {
      const email = String(k.customer?.email || '').trim();
      const decided = ['renewing', 'not_renewing'].includes(k.renewalIntent);
      if (!email || decided || recentlyEmailed.has(String(k._id))) continue;
      const vars = {
         name: String(k.customer?.fullName || '').split(/\s+/)[0],
         unit: k.unit?.unitNumber || '',
         endDate: fmtDate(k.endDate),
         contractNo: k.contractNo || '',
         daysLeft: Math.max(0, Math.round((new Date(k.endDate).setHours(0, 0, 0, 0) - today.getTime()) / 86400000)),
      };
      items.push({
         contract: k._id, customer: k.customer?._id || null, name: k.customer?.fullName || '', email,
         unit: vars.unit, endDate: k.endDate,
         subject: fillTemplate(subject || DEFAULT_SUBJECT, vars),
         body: fillTemplate(message || DEFAULT_MESSAGE, vars),
         status: 'pending',
      });
   }
   return items;
}

/* ── Quiet good leads ─────────────────────────────────────────────────── */

const OPEN_GOOD_STATUS = ['quotation_sent', 'site_visit_scheduled', 'follow_up_scheduled'];
const STATUS_WORDS = { quotation_sent: 'Quotation sent', site_visit_scheduled: 'Site visit booked', follow_up_scheduled: 'Follow-up scheduled', contacted: 'Contacted', contact_attempted: 'Contact attempted', new: 'New' };

/** A template's words with {{1}} as the first name, as the customer will read them. */
export function fillTemplateBody(bodyText, variables = []) {
   return variables.reduce((t, v, i) => t.replaceAll(`{{${i + 1}}}`, v), String(bodyText || ''));
}

/**
 * Good leads that have gone quiet: still open, hot or warm or far along
 * (quotation, site visit, follow-up), nothing either way for `quietDays`,
 * the customer last wrote within `maxQuietDays`, no follow-up already planned,
 * and not messaged by this bot in the last week. Best first.
 */
export function pickQuietLeads(leads, activity, { quietDays = 3, maxQuietDays = 30, recentlyMessaged = new Set(), now = new Date(), limit = 50 } = {}) {
   const day = 86400000;
   const out = [];
   for (const l of leads) {
      const good = OPEN_GOOD_STATUS.includes(l.status) || ['hot', 'warm'].includes(l.temperature);
      const a = activity.get(l.phoneNormalized);
      if (!good || !a?.lastIn || !l.phone) continue;
      if (recentlyMessaged.has(String(l._id))) continue;
      if (l.followUpAt && new Date(l.followUpAt) > now) continue;
      const quiet = Math.floor((now - new Date(a.lastAny)) / day);
      const sinceThem = Math.floor((now - new Date(a.lastIn)) / day);
      if (quiet < quietDays || sinceThem > maxQuietDays) continue;
      const rank = (OPEN_GOOD_STATUS.includes(l.status) ? 2 : 0) + (l.temperature === 'hot' ? 1 : 0);
      const why = [STATUS_WORDS[l.status] || l.status, l.temperature ? `${l.temperature}` : '', `quiet ${quiet} day${quiet === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
      out.push({ lead: l, quiet, rank, why });
   }
   return out.sort((x, y) => y.rank - x.rank || x.quiet - y.quiet).slice(0, limit);
}

/* ── Running ───────────────────────────────────────────────────────────── */

/** The real senders and lookups, for routes that act on a run. */
export async function botDeps() {
   return defaultDeps();
}

async function defaultDeps() {
   const [{ askAssistant }, { sendMail }] = await Promise.all([import('./assistant/index.js'), import('./mail.js')]);
   return {
      ask: askAssistant,
      sendMail,
      expiring: async (days, now) => {
         const from = new Date(new Date(now).setHours(0, 0, 0, 0));
         const to = new Date(from.getTime() + (days + 1) * 86400000);
         return Contract.find({ status: 'active', endDate: { $gte: from, $lt: to } })
            .populate('customer', 'fullName email').populate('unit', 'unitNumber').sort({ endDate: 1 }).limit(500).lean();
      },
      recentlyEmailed: async (botId, now) => {
         const runs = await BotRun.find({ bot: botId, createdAt: { $gte: new Date(now.getTime() - 7 * 86400000) } }).select('items.contract items.status').lean();
         return new Set(runs.flatMap((r) => r.items.filter((i) => i.status === 'sent' || i.status === 'pending').map((i) => String(i.contract))));
      },
      sentToday: async (botId, now) => {
         const { dayKey } = dubaiParts(now);
         const start = new Date(`${dayKey}T00:00:00+04:00`);
         const runs = await BotRun.find({ bot: botId, 'items.sentAt': { $gte: start } }).select('items.sentAt').lean();
         return runs.flatMap((r) => r.items).filter((i) => i.sentAt && i.sentAt >= start).length;
      },
      owner: async (id) => (id ? User.findById(id).select('name role').lean() : null),
      quietCandidates: async () => {
         const leads = await Lead.find({
            status: { $nin: ['won', 'lost', 'already_customer'] },
            $or: [{ temperature: { $in: ['hot', 'warm'] } }, { status: { $in: OPEN_GOOD_STATUS } }],
         }).select('fullName whatsappProfileName phone phoneNormalized status temperature followUpAt').limit(2000).lean();
         const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
         const rows = phones.length ? await WhatsAppMessage.aggregate([
            { $match: { phoneNormalized: { $in: phones } } },
            { $group: { _id: '$phoneNormalized', lastAny: { $max: '$occurredAt' }, lastIn: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } } } },
         ]) : [];
         return { leads, activity: new Map(rows.map((r) => [r._id, r])) };
      },
      recentlyMessaged: async (botId, now) => {
         const runs = await BotRun.find({ bot: botId, createdAt: { $gte: new Date(now.getTime() - 7 * 86400000) } }).select('items.lead items.status').lean();
         return new Set(runs.flatMap((r) => r.items.filter((i) => i.status === 'sent' || i.status === 'pending').map((i) => String(i.lead))));
      },
      template: async (name) => {
         const { listWhatsAppTemplates } = await import('./whatsapp.js');
         const list = await listWhatsAppTemplates({ force: true });
         if (list.error) throw new Error(`WhatsApp templates could not be read: ${list.error}`);
         return (list.templates || []).find((t) => t.name === name) || null;
      },
      sendWhatsApp: async (item, bot, by) => {
         const [{ sendWhatsAppTemplate }, { markFirstResponse }] = await Promise.all([import('./whatsapp.js'), import('./aiBot.js')]);
         const variables = bot._variables?.(item) ?? [];
         const result = await sendWhatsAppTemplate({ to: item.phone, name: bot.templateName, language: bot.templateLanguage || 'en', variables });
         const phoneNormalized = String(item.phone).replace(/\D/g, '');
         // Into the chat, so the thread shows what the customer received.
         await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '', phone: item.phone, phoneNormalized, direction: 'outbound', type: 'template',
            text: item.body || `Template: ${bot.templateName}`, status: 'sent', occurredAt: new Date(), sentByAi: false,
            sentBy: by?.id || null, raw: { template: { name: bot.templateName, variables }, bot: bot.name, sendResult: result },
         });
         await markFirstResponse(phoneNormalized).catch(() => {});
      },
      saveRun: (doc) => BotRun.create(doc),
   };
}

/** Send some of a run's messages. Returns how many went. Each item is marked as it goes. */
export async function sendItems(run, bot, ids, { sendMail, sendWhatsApp, by = 'bot', byUser = null } = {}) {
   const want = ids ? new Set(ids.map(String)) : null;
   let sent = 0;
   for (const item of run.items) {
      if (item.status !== 'pending' || (want && !want.has(String(item._id)))) continue;
      try {
         if (item.channel === 'whatsapp') {
            await sendWhatsApp(item, { ...bot, _variables: (it) => templateVariables(bot, it) }, byUser);
         } else {
            await sendMail({
               to: item.email, subject: item.subject, text: item.body,
               context: { kind: 'reminder', label: bot.name, customer: item.customer, contract: item.contract, sentBy: by },
            });
         }
         item.status = 'sent';
         item.sentAt = new Date();
         sent += 1;
      } catch (e) {
         item.status = 'failed';
         item.error = String(e.message || e).slice(0, 300);
      }
   }
   return sent;
}

/** The template's one blank, when it has one, is the customer's first name. */
function templateVariables(bot, item) {
   return Number(bot.templateVariableCount ?? 1) > 0 ? [String(item.name || '').split(/\s+/)[0] || 'there'] : [];
}

function runStatus(items) {
   if (items.some((i) => i.status === 'pending')) return 'waiting';
   return 'ok';
}

export function emailSummary(items, kind = 'contract_emails') {
   const n = (s) => items.filter((i) => i.status === s).length;
   if (!items.length) return kind === 'quiet_leads' ? 'No good lead has gone quiet.' : 'Nobody to email this time.';
   const parts = [];
   if (n('pending')) parts.push(`${n('pending')} to approve`);
   if (n('sent')) parts.push(`${n('sent')} sent`);
   if (n('failed')) parts.push(`${n('failed')} failed`);
   return parts.join(' · ');
}

/** One run of a bot, now. Saves and returns the run. */
export async function runBot(bot, { trigger = 'manual', now = new Date(), deps } = {}) {
   const d = { ...(await defaultDeps()), ...(deps || {}) };
   const run = { bot: bot._id, trigger, status: 'ok', summary: '', answer: '', sources: [], items: [], error: '' };
   try {
      if (bot.kind === 'ai_report') {
         const owner = await d.owner(bot.createdBy);
         const out = await d.ask({
            question: `${bot.instruction}\n\n(This is a scheduled report: answer in full now, with no questions back. Short lines, the figures first.)`,
            user: owner ? { id: String(owner._id), name: owner.name, role: owner.role } : { role: 'admin' },
            web: Boolean(bot.web), now,
         });
         run.answer = String(out?.answer || '').trim();
         run.sources = (out?.sources || []).slice(0, 8);
         run.summary = run.answer.split('\n').find((l) => l.trim())?.slice(0, 160) || 'No answer';
         if (out?.grounded === false) run.status = 'failed';
      } else if (bot.kind === 'contract_emails') {
         const contracts = await d.expiring(Number(bot.days) || 30, now);
         const recent = await d.recentlyEmailed(bot._id, now);
         run.items = pickRecipients(contracts, { recentlyEmailed: recent, subject: bot.subject, message: bot.message, now });
         if (bot.sendMode === 'auto') {
            const room = Math.max(0, (Number(bot.dailyCap) || 50) - await d.sentToday(bot._id, now));
            await sendItems({ items: run.items.slice(0, room) }, bot, null, { sendMail: d.sendMail });
         }
         run.status = runStatus(run.items);
         run.summary = emailSummary(run.items);
      } else if (bot.kind === 'quiet_leads') {
         if (!bot.templateName) throw new Error('Choose the WhatsApp template this bot sends (Edit → Template)');
         const tpl = await d.template(bot.templateName);
         if (!tpl) throw new Error(`The template "${bot.templateName}" is not in WhatsApp any more — choose another`);
         if (String(tpl.status).toUpperCase() !== 'APPROVED') throw new Error(`The template "${bot.templateName}" is ${String(tpl.status).toLowerCase()}, not approved`);
         if (tpl.variableCount > 1) throw new Error(`"${bot.templateName}" has ${tpl.variableCount} blanks; this bot fills one (the first name). Choose a template with one blank or none.`);
         const withCount = { ...bot, templateVariableCount: tpl.variableCount };
         const { leads, activity } = await d.quietCandidates(now);
         const picked = pickQuietLeads(leads, activity, {
            quietDays: Number(bot.quietDays) || 3, maxQuietDays: Number(bot.maxQuietDays) || 30,
            recentlyMessaged: await d.recentlyMessaged(bot._id, now), now, limit: Number(bot.dailyCap) || 50,
         });
         run.items = picked.map(({ lead, why }) => {
            const name = lead.fullName || lead.whatsappProfileName || '';
            const item = { channel: 'whatsapp', lead: lead._id, name, phone: lead.phone, reason: why, status: 'pending' };
            return { ...item, body: fillTemplateBody(tpl.bodyText, templateVariables(withCount, item)) };
         });
         if (bot.sendMode === 'auto') {
            const room = Math.max(0, (Number(bot.dailyCap) || 50) - await d.sentToday(bot._id, now));
            await sendItems({ items: run.items.slice(0, room) }, withCount, null, { sendWhatsApp: d.sendWhatsApp });
         }
         run.status = runStatus(run.items);
         run.summary = emailSummary(run.items, 'quiet_leads');
      }
   } catch (e) {
      run.status = 'failed';
      run.error = String(e.message || e).slice(0, 500);
      run.summary = 'The run failed';
   }
   return d.saveRun(run);
}

/** The minute tick: run every bot whose time has come. */
export async function botsTick(now = new Date(), { deps } = {}) {
   const bots = await Bot.find({ enabled: true, 'schedule.cadence': { $ne: 'manual' } });
   let ran = 0;
   for (const bot of bots) {
      if (!isBotDue(bot, now)) continue;
      // Claimed before running: a second server, or a restart mid-run, sees it done.
      const claimed = await Bot.updateOne({ _id: bot._id, lastRunDay: { $ne: dubaiParts(now).dayKey } }, { $set: { lastRunDay: dubaiParts(now).dayKey, lastRunAt: now } });
      if (!claimed.modifiedCount) continue;
      await runBot(bot, { trigger: 'schedule', now, deps });
      ran += 1;
   }
   return { ran };
}

/* ── The bots an admin should have ──────────────────────────────────────── */

/** Added by "Add recommended bots"; only the emails reach customers, and they ask first. */
export const RECOMMENDED_BOTS = [
   {
      name: 'Renewal reminder emails', icon: '✉️', kind: 'contract_emails', days: 30, sendMode: 'review',
      subject: DEFAULT_SUBJECT, message: DEFAULT_MESSAGE,
      schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1, dayOfMonth: 1 },
   },
   {
      name: 'Morning summary', icon: '☀️', kind: 'ai_report',
      instruction: 'Morning summary for the admin: how many leads came in yesterday and from which sources; which leads have had no reply yet; how many follow-ups are due today and for whom; which contracts end in the next 7 days. Short lines, the numbers first.',
      schedule: { cadence: 'daily', hour: 9, dayOfWeek: 1, dayOfMonth: 1 },
   },
   {
      name: 'Money check', icon: '💰', kind: 'ai_report',
      instruction: 'Weekly money check: the total owed in Zoho Books and the ten customers who owe the most; how much was collected in the last 7 days as recorded in the CRM. If the CRM recorded little or nothing while Zoho shows payments, say that payments are not being recorded in the CRM.',
      schedule: { cadence: 'weekly', hour: 8, dayOfWeek: 1, dayOfMonth: 1 },
   },
   {
      name: 'Improvement check', icon: '🛠️', kind: 'ai_report',
      instruction: 'Daily improvement check for the admin. Look at yesterday and the last 7 days: how fast we first replied on WhatsApp and how many leads were never answered; leads waiting for a reply now; follow-ups that are overdue; quotations sent but not followed up; bookings and contracts made; calls made by each rep; contracts past check-out. Then list the three to five most important things to improve today, each with the number behind it and who should act. Only say what the figures show.',
      schedule: { cadence: 'daily', hour: 9, dayOfWeek: 1, dayOfMonth: 1 },
   },
   {
      name: 'Why leads don\'t convert', icon: '🔍', kind: 'ai_report', web: true,
      instruction: 'Weekly analysis: we get many leads but too few become customers — find out why. Use the last 30 days: win rate overall and by source; the stage where open leads are stuck; the recorded reasons for lost leads; how fast we first reply and how many we never answer; which unit sizes people ask for compared with what is free; and how our prices compare with competitors in Dubai (search the web). Then give the most likely reasons, ranked, each backed by its figures, and what to change for each. Keep what is measured apart from what is a likely explanation.',
      schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1, dayOfMonth: 1 },
   },
   {
      name: 'Competitor watch', icon: '🔎', kind: 'ai_report', web: true,
      instruction: 'Find current monthly prices and any offers for self-storage units of about 25, 50 and 100 sq ft from storage companies in Dubai, and compare them with our own prices for the same sizes. Name each company and where each price came from.',
      schedule: { cadence: 'weekly', hour: 10, dayOfWeek: 1, dayOfMonth: 1 },
   },
];
