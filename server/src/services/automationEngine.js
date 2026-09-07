import mongoose from 'mongoose';
import { AutomationRule, AutomationLog, MessageTemplate, Payment, Contract } from '../models/index.js';
import { sendWhatsAppText, sendWhatsAppTemplate, whatsappSendConfigured, listWhatsAppTemplates } from './whatsapp.js';
import { sendMail, mailConfigured } from './mail.js';
import { renewLink, moveOutLink } from './renewalLink.js';
import { brandedEmailHtml } from './emailLayout.js';

// Master switch for the scheduled runs — OFF until it is turned on from the
// Automation Rules page, so a fresh deploy can never blast the whole backlog
// unreviewed. Manual "Run now" from the page always works.
const CONFIG_ID = 'automation-config';

async function configCollection() {
  return mongoose.connection.db.collection('automationconfig');
}

export async function getAutoSend() {
  const doc = await (await configCollection()).findOne({ _id: CONFIG_ID });
  return !!doc?.autoSend;
}

export async function setAutoSend(value) {
  await (await configCollection()).updateOne(
    { _id: CONFIG_ID },
    { $set: { autoSend: !!value, updatedAt: new Date() } },
    { upsert: true },
  );
  return !!value;
}

/**
 * Global kill switch for automated WhatsApp.
 *
 * Separate from the per-rule toggles on purpose. The built-in rules ship with
 * whatsappEnabled true, so enabling a rule to get its *email* also enables its
 * WhatsApp — which is exactly how a run once went out on a channel nobody had
 * asked for. This gate sits in front of all of them and defaults to OFF, so
 * WhatsApp only sends once someone deliberately turns it on here.
 *
 * Email is unaffected.
 */
export async function getWhatsAppAutomation() {
  const doc = await (await configCollection()).findOne({ _id: CONFIG_ID });
  return doc?.whatsappAutomation === true;
}

export async function setWhatsAppAutomation(value) {
  await (await configCollection()).updateOne(
    { _id: CONFIG_ID },
    { $set: { whatsappAutomation: !!value, updatedAt: new Date() } },
    { upsert: true },
  );
  return !!value;
}

// Executes the rules configured on Settings → Automation Rules.
// Per-contract behaviour comes from the contract's Reminders tab:
// remindersMuted silences everything; a reminderOverrides entry pins one
// rule on/off for that contract regardless of the rule's global toggle.

const DAY = 24 * 60 * 60 * 1000;
// Payments this far past due stop generating messages — chase manually instead
const MAX_OVERDUE_DAYS = 60;

const FALLBACK_MESSAGES = {
  payment_due:
    'Dear @name, your storage payment of AED @amount for Unit @unit is due on @dueDate. Please arrange payment at your earliest convenience. Thank you, PurpleBox Storage.',
  payment_overdue:
    'Dear @name, your payment of AED @amount for Unit @unit was due on @dueDate and is now overdue. Please make payment immediately or contact us. PurpleBox Storage.',
  contract_expiry:
    'Dear @name, your storage contract @contractNo for Unit @unit expires on @endDate. Please contact us if you wish to renew. Thank you, PurpleBox Storage.',
};

function interpolate(text, vars) {
  return String(text || '').replace(/@(\w+)/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
}

function effectiveEnabled(contract, rule) {
  const override = (contract.reminderOverrides || []).find((o) => String(o.rule) === String(rule._id));
  return override ? !!override.enabled : !!rule.enabled;
}

function unitLabel(contract) {
  return contract.units?.length > 1
    ? contract.units.map((u) => u.unitNumber).join(', ')
    : (contract.unit?.unitNumber ?? '—');
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// 'before' steps: fire once we are within step.value days of the date (closest step wins).
// 'after' steps: fire once step.value days have passed (most severe step wins).
function pickStep(steps, daysLeft) {
  const applicable = steps
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => (s.direction === 'after' ? -daysLeft >= s.value : daysLeft >= 0 && daysLeft <= s.value));
  if (!applicable.length) return null;
  applicable.sort((a, b) =>
    a.s.direction === 'after' ? b.s.value - a.s.value : a.s.value - b.s.value);
  return applicable[0];
}

/**
 * How far back a 'sent' log still counts against a step — two independent
 * lower bounds, a recurring rule's own window and an admin's deliberate
 * "start fresh" reset (AutomationRule.remindersResetAt), both of which must
 * hold, so the later of the two wins. `null` means no bound: any prior send
 * blocks forever, the default for a non-recurring, never-reset rule. Pure
 * and exported so the "both must hold" logic is checkable without a
 * database.
 */
export function sentCutoff({ recurring, remindersResetAt, now = new Date() }) {
  const cutoffs = [];
  if (recurring?.enabled) cutoffs.push(new Date(now.getTime() - Math.max(1, recurring.everyDays) * DAY));
  if (remindersResetAt) cutoffs.push(new Date(remindersResetAt));
  if (!cutoffs.length) return null;
  return new Date(Math.max(...cutoffs.map((d) => d.getTime())));
}

async function alreadySent({ rule, eventKey, channel, recurring }) {
  const filter = { rule: rule._id, event: eventKey, channel, status: 'sent' };
  const cutoff = sentCutoff({ recurring, remindersResetAt: rule.remindersResetAt });
  if (cutoff) filter.sentAt = { $gte: cutoff };
  return !!(await AutomationLog.findOne(filter).select('_id').lean());
}

/**
 * Midnight..midnight for the Dubai calendar day `now` falls in — "today"
 * meaning the day the office is having, not a UTC day that rolls over
 * mid-afternoon local time. Pure and exported so the boundary itself (a run
 * just before vs. just after midnight) is testable without a database.
 */
export function dubaiDayRange(now = new Date()) {
  const OFFSET = 4 * 3600_000;
  const local = new Date(now.getTime() + OFFSET);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - OFFSET);
  return { start, end: new Date(start.getTime() + DAY) };
}

/**
 * A second, coarser guard on top of alreadySent()'s per-step tracking: no
 * contract gets the same rule on the same channel more than once in one
 * Dubai calendar day, full stop — regardless of which step matched, and
 * regardless of a race between the 6-hourly tick and someone pressing
 * "Run now" at the same time. Kept independent of eventKey on purpose: it
 * still holds even if a future change to step numbering ever made two runs
 * in one day compute two different eventKeys for what is really the same
 * reminder.
 */
async function alreadySentToday({ rule, contract, channel, now }) {
  const { start, end } = dubaiDayRange(now);
  return !!(await AutomationLog.findOne({
    rule: rule._id, contract: contract._id, channel, status: 'sent',
    sentAt: { $gte: start, $lt: end },
  }).select('_id').lean());
}

async function resolveMessages(step, templatesByName, event, vars) {
  const tpl = templatesByName.get((step.template || '').trim().toLowerCase());
  const whatsappBody = step.whatsappBody?.trim() || tpl?.whatsappBody || FALLBACK_MESSAGES[event];
  const emailBody = step.emailBody?.trim() || tpl?.emailBody || FALLBACK_MESSAGES[event];
  const emailSubject = step.emailSubject?.trim() || tpl?.subject || 'PurpleBox Storage — Reminder';
  const emailText = interpolate(emailBody, vars);
  // A step or template can still carry its own designed emailHtml, but
  // nothing writes one any more — every automated email now goes out in the
  // standard branded shell, built from the same Subject/Body an admin can
  // actually see and edit.
  const customHtml = interpolate(step.emailHtml?.trim() || tpl?.emailHtml || '', vars);
  return {
    whatsapp: interpolate(whatsappBody, vars),
    emailText,
    emailHtml: customHtml || brandedEmailHtml({ bodyText: emailText }),
    emailSubject: interpolate(emailSubject, vars),
    ...templateFor(step, tpl, vars),
  };
}

/**
 * The approved template a step names, with its {{1}}, {{2}} … filled in.
 *
 * Meta matches parameters by position, so the order of whatsappTemplateVars is
 * the order of the placeholders. A named variable with nothing behind it sends
 * an empty string rather than the literal name: a reminder reading "Hello
 * {{1}}" to a customer is worse than one reading "Hello".
 */
export function templateFor(step, tpl, vars) {
  // The step wins when it names one, so a single reminder can differ; the
  // template it was built from is the default, which is where it is edited.
  const source = String(step.whatsappTemplate || '').trim()
    ? step
    : (String(tpl?.whatsappTemplate || '').trim() ? tpl : null);
  if (!source) return {};

  return {
    whatsappTemplate: String(source.whatsappTemplate).trim(),
    whatsappTemplateLang: String(source.whatsappTemplateLang || 'en').trim() || 'en',
    whatsappTemplateVars: (source.whatsappTemplateVars || []).map((k) => String(vars[k] ?? '')),
  };
}

/**
 * Which channels a message may go out on.
 *
 * Pure and exported so the gate can be tested without a database or a live
 * WhatsApp token — this is the function that decides whether a tenant gets
 * messaged, so it should not only be verifiable by reading it.
 */
export function pickChannels({ rule, waAllowed, waConfigured, mailReady, phone, email }) {
  const channels = [];
  if (waAllowed && rule.whatsappEnabled && waConfigured && phone) channels.push('whatsapp');
  if (rule.emailEnabled && mailReady && email) channels.push('email');
  return channels;
}

async function dispatch({ rule, contract, eventKey, stepIdx, messages, dryRun, results, waAllowed }) {
  const customer = contract.customer;
  const phone = (customer.phones?.[0] || customer.phone || '').replace(/\s+/g, '');
  const email = customer.email || '';
  const base = {
    rule: rule._id,
    ruleName: rule.name,
    customer: customer._id,
    contract: contract._id,
    unit: unitLabel(contract),
    event: eventKey,
  };

  const channels = pickChannels({
    rule,
    waAllowed,
    waConfigured: whatsappSendConfigured(),
    mailReady: mailConfigured(),
    phone,
    email,
  });
  if (!channels.length) { results.skipped++; return; }

  for (const channel of channels) {
    if (await alreadySent({ rule, eventKey, channel, recurring: rule.recurring })) { results.skipped++; continue; }
    if (await alreadySentToday({ rule, contract, channel })) { results.skipped++; continue; }
    if (dryRun) {
      results.planned.push({ rule: rule.name, contract: contract.contractNo, customer: customer.fullName, channel, step: stepIdx, message: channel === 'whatsapp' ? messages.whatsapp : messages.emailText });
      continue;
    }
    try {
      if (channel === 'whatsapp') {
        // A template when the step names one, free text otherwise. Free text
        // only reaches somebody who wrote to us in the last 24 hours, which a
        // tenant whose contract is expiring almost never has.
        if (messages.whatsappTemplate) {
          await sendWhatsAppTemplate({
            to: phone,
            name: messages.whatsappTemplate,
            language: messages.whatsappTemplateLang || 'en',
            variables: messages.whatsappTemplateVars,
          });
        } else {
          await sendWhatsAppText({ to: phone, body: messages.whatsapp });
        }
        await AutomationLog.create({ ...base, channel, message: messages.whatsapp, status: 'sent' });
      } else {
        // Send the designed version when there is one, keeping the text as the
        // alternative part rather than replacing it.
        await sendMail({
          to: email,
          subject: messages.emailSubject,
          text: messages.emailText,
          ...(messages.emailHtml ? { html: messages.emailHtml } : {}),
          context: {
            kind: 'reminder', label: rule.name, sentBy: 'Automation',
            customer: customer._id, contract: contract._id,
          },
        });
        await AutomationLog.create({ ...base, channel, message: messages.emailText, status: 'sent' });
      }
      results.sent++;
    } catch (e) {
      await AutomationLog.create({ ...base, channel, message: channel === 'whatsapp' ? messages.whatsapp : messages.emailText, status: 'failed', error: e.message || String(e) });
      results.errors++;
    }
  }
}

/**
 * Every active contract that currently matches one of `rules`' steps, with
 * vars resolved — the shared "who is due, and for which step" computation
 * behind both the automatic engine and the pending-approval queue below.
 * Does not check alreadySent/alreadySentToday: the automatic path filters
 * that in dispatch(), the queue filters it itself so it can also report
 * *why* a contract isn't shown.
 */
async function expiryCandidates({ rules, now = new Date(), skipCounter } = {}) {
  const maxBefore = Math.max(0, ...rules.flatMap((r) => r.steps.map((s) => s.value)));
  const contracts = await Contract.find({
    status: 'active',
    endDate: { $gte: now, $lte: new Date(now.getTime() + (maxBefore + 1) * DAY) },
  }).populate([{ path: 'customer' }, { path: 'unit' }, { path: 'units' }]).lean();

  const out = [];
  for (const contract of contracts) {
    if (!contract.customer) continue;
    if (contract.remindersMuted) { if (skipCounter) skipCounter.skipped++; continue; }

    const daysLeft = Math.ceil((new Date(contract.endDate).getTime() - now.getTime()) / DAY);
    const vars = {
      name: contract.customer.fullName,
      amount: '',
      unit: unitLabel(contract),
      dueDate: fmtDate(contract.endDate),
      daysLeft: String(Math.max(0, daysLeft)),
      contractNo: contract.contractNo || '',
      endDate: fmtDate(contract.endDate),
      rate: contract.rate != null ? Number(contract.rate).toFixed(2) : '',
      // One-click answers to "are you staying?", so the tenant can settle it
      // without a phone call from us.
      renewLink: renewLink(contract._id),
      moveOutLink: moveOutLink(contract._id),
      lateFee: process.env.LATE_FEE_AMOUNT || 'AED 100',
    };

    for (const rule of rules) {
      if (!effectiveEnabled(contract, rule)) continue;
      const picked = pickStep(rule.steps, daysLeft);
      if (!picked) continue;
      out.push({ contract, rule, picked, daysLeft, vars, eventKey: `contract_expiry:${contract._id}:step${picked.idx}` });
    }
  }
  return out;
}

export async function runAutomationRules({ dryRun = false } = {}) {
  // Read once per run rather than per contract.
  const waAllowed = await getWhatsAppAutomation();
  const rules = await AutomationRule.find().lean();
  const templates = await MessageTemplate.find().lean();
  const templatesByName = new Map();
  for (const t of templates) {
    templatesByName.set(String(t.label || '').trim().toLowerCase(), t);
    templatesByName.set(String(t.key || '').trim().toLowerCase(), t);
  }

  const results = { sent: 0, skipped: 0, errors: 0, planned: [] };
  const now = Date.now();

  const paymentRules = rules.filter((r) => ['payment_due', 'payment_overdue'].includes(r.triggerEvent) && r.steps?.length);
  const expiryRules = rules.filter((r) => r.triggerEvent === 'contract_expiry' && r.steps?.length);

  if (paymentRules.length) {
    const maxBefore = Math.max(0, ...paymentRules.flatMap((r) => r.steps.filter((s) => s.direction !== 'after').map((s) => s.value)));
    const payments = await Payment.find({
      status: { $ne: 'paid' },
      dueDate: {
        $gte: new Date(now - MAX_OVERDUE_DAYS * DAY),
        $lte: new Date(now + (maxBefore + 1) * DAY),
      },
    }).populate({
      path: 'contract',
      match: { status: 'active' },
      populate: [{ path: 'customer' }, { path: 'unit' }, { path: 'units' }],
    }).lean();

    // One message per tenant per rule — group this contract's unpaid payments,
    // sum what is overdue and take the next upcoming due date.
    const byContract = new Map();
    for (const payment of payments) {
      if (!payment.contract || !payment.contract.customer) continue;
      const key = String(payment.contract._id);
      if (!byContract.has(key)) byContract.set(key, { contract: payment.contract, payments: [] });
      byContract.get(key).payments.push(payment);
    }

    for (const { contract, payments: list } of byContract.values()) {
      if (contract.remindersMuted) { results.skipped++; continue; }

      const overdue = list.filter((p) => new Date(p.dueDate).getTime() < now);
      const upcoming = list.filter((p) => new Date(p.dueDate).getTime() >= now)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      const oldestOverdue = overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
      const totalOverdue = overdue.reduce((s, p) => s + Number(p.amount || 0), 0);

      const baseVars = {
        name: contract.customer.fullName,
        unit: unitLabel(contract),
        contractNo: contract.contractNo || '',
        endDate: contract.endDate ? fmtDate(contract.endDate) : '',
      };

      for (const rule of paymentRules) {
        if (!effectiveEnabled(contract, rule)) continue;

        let target, daysLeft, vars;
        if (rule.triggerEvent === 'payment_due') {
          target = upcoming[0];
          if (!target) continue;
          daysLeft = Math.ceil((new Date(target.dueDate).getTime() - now) / DAY);
          vars = { ...baseVars, amount: Number(target.amount).toFixed(2), dueDate: fmtDate(target.dueDate), daysLeft: String(Math.max(0, daysLeft)) };
        } else {
          target = oldestOverdue;
          if (!target) continue;
          daysLeft = Math.ceil((new Date(target.dueDate).getTime() - now) / DAY);
          vars = { ...baseVars, amount: totalOverdue.toFixed(2), dueDate: fmtDate(target.dueDate), daysLeft: '0' };
        }

        const picked = pickStep(rule.steps, daysLeft);
        if (!picked) continue;
        // Overdue keys on the contract (the outstanding balance is one conversation);
        // due keys on the specific payment so each week's payment reminds once.
        const eventKey = rule.triggerEvent === 'payment_due'
          ? `payment_due:${target._id}:step${picked.idx}`
          : `payment_overdue:${contract._id}:step${picked.idx}`;
        const messages = await resolveMessages(picked.s, templatesByName, rule.triggerEvent, vars);
        await dispatch({ rule, contract, eventKey, stepIdx: picked.idx, messages, dryRun, results, waAllowed });
      }
    }
  }

  if (expiryRules.length) {
    for (const c of await expiryCandidates({ rules: expiryRules, now: new Date(now), skipCounter: results })) {
      const messages = await resolveMessages(c.picked.s, templatesByName, 'contract_expiry', c.vars);
      await dispatch({ rule: c.rule, contract: c.contract, eventKey: c.eventKey, stepIdx: c.picked.idx, messages, dryRun, results, waAllowed });
    }
  }

  if (!dryRun) console.log(`[Automation] sent=${results.sent} skipped=${results.skipped} errors=${results.errors}`);
  return results;
}

/** Which of a candidate's eligible channels are still actually pending —
 *  eligible per pickChannels(), and not already covered by either of
 *  dispatch()'s own guards. Shared by the queue (to decide what to show) and
 *  implicitly re-checked by dispatch() itself (to decide what to send), so
 *  the two can never disagree about what "still pending" means. */
async function pendingChannelsFor({ rule, contract, eventKey, waAllowed }) {
  const customer = contract.customer;
  const phone = (customer.phones?.[0] || customer.phone || '').replace(/\s+/g, '');
  const email = customer.email || '';
  const eligible = pickChannels({
    rule, waAllowed, waConfigured: whatsappSendConfigured(), mailReady: mailConfigured(), phone, email,
  });
  const out = [];
  for (const channel of eligible) {
    if (await alreadySent({ rule, eventKey, channel, recurring: rule.recurring })) continue;
    if (await alreadySentToday({ rule, contract, channel })) continue;
    out.push(channel);
  }
  return out;
}

/**
 * The approval queue: every contract currently due a contract-expiry
 * reminder that has NOT already gone out, grouped by which step matched —
 * "6 days before", "3 days before" and so on — with the actual message each
 * client would receive already rendered, so an admin reviews the real thing
 * rather than a guess at it.
 *
 * Reads only — building this list never sends anything and never writes an
 * AutomationLog row. A contract due on two channels (email + WhatsApp) but
 * already sent on one shows only the one still outstanding.
 */
export async function pendingExpiryQueue({ now = new Date() } = {}) {
  // rule.enabled gates the *automatic* run — reviewing what would be sent
  // is exactly what lets an admin approve individually while leaving that
  // switch off, so it is deliberately not filtered on here. A contract's own
  // reminderOverrides still wins either way (effectiveEnabled() reads that
  // first), so a specific mute stays respected.
  const rules = (await AutomationRule.find({ triggerEvent: 'contract_expiry' }).lean())
    .filter((r) => r.steps?.length)
    .map((r) => ({ ...r, enabled: true }));
  if (!rules.length) return { groups: [], total: 0 };

  const waAllowed = await getWhatsAppAutomation();
  const templates = await MessageTemplate.find().lean();
  const templatesByName = new Map();
  for (const t of templates) {
    templatesByName.set(String(t.label || '').trim().toLowerCase(), t);
    templatesByName.set(String(t.key || '').trim().toLowerCase(), t);
  }
  // An approved-template WhatsApp send's real wording lives on Meta's side,
  // not in our own templates collection — resolved here the same way the
  // quiet-leads composer does, so the preview shows what actually goes out.
  const approved = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
  const approvedByName = new Map((approved.templates || []).map((t) => [t.name, t]));

  const candidates = await expiryCandidates({ rules, now });
  const groups = new Map();
  let alreadyHandled = 0;
  for (const c of candidates) {
    const channels = await pendingChannelsFor({ rule: c.rule, contract: c.contract, eventKey: c.eventKey, waAllowed });
    if (!channels.length) { alreadyHandled++; continue; }

    const messages = await resolveMessages(c.picked.s, templatesByName, 'contract_expiry', c.vars);
    let whatsappPreview = messages.whatsapp;
    if (messages.whatsappTemplate) {
      const approvedTpl = approvedByName.get(messages.whatsappTemplate);
      whatsappPreview = approvedTpl
        ? messages.whatsappTemplateVars.reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v || ''), approvedTpl.bodyText)
        : `[Approved template "${messages.whatsappTemplate}" not found in Meta's current list — check it is still approved]`;
    }

    const groupKey = `${c.rule._id}:${c.picked.idx}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ruleId: String(c.rule._id),
        ruleName: c.rule.name,
        step: c.picked.idx,
        stepLabel: `${c.picked.s.value} day${c.picked.s.value === 1 ? '' : 's'} ${c.picked.s.direction === 'after' ? 'after' : 'before'} expiry`,
        rows: [],
      });
    }
    groups.get(groupKey).rows.push({
      contractId: String(c.contract._id),
      ruleId: String(c.rule._id),
      contractNo: c.contract.contractNo,
      customerName: c.contract.customer.fullName,
      unit: unitLabel(c.contract),
      endDate: c.contract.endDate,
      daysLeft: c.daysLeft,
      channels,
      preview: {
        emailSubject: messages.emailSubject,
        emailHtml: messages.emailHtml,
        whatsapp: whatsappPreview,
      },
    });
  }

  const list = [...groups.values()].sort((a, b) => a.step - b.step);
  return {
    groups: list,
    total: list.reduce((n, g) => n + g.rows.length, 0),
    // So an empty queue can say *why* rather than just "nothing here": how
    // many active contracts currently sit inside one of the configured
    // windows at all, and of those, how many are excluded because that
    // exact step already has a 'sent' log. A step is tracked by its
    // position (1st, 2nd, 3rd…), not by its day count — editing a step's
    // number of days does not reset what has already gone out under that
    // position, which is the usual reason a freshly-retimed step shows zero.
    matched: candidates.length,
    alreadyHandled,
  };
}

/**
 * Send exactly the reminders an admin checked and approved, and nothing
 * else — `selections` is a list of {contractId, ruleId} pairs from the
 * queue above. Everything about the message is re-derived here from the
 * contract and rule, the same way the automatic run would, rather than
 * trusting whatever the client last rendered: a stale preview cannot become
 * a stale send. Every one of dispatch()'s guards (per-step, and the
 * same-day rail) still applies — approving something already sent by the
 * automatic run in the meantime is a no-op, not a duplicate.
 */
export async function sendApprovedReminders({ selections = [] } = {}) {
  const results = { sent: 0, skipped: 0, errors: 0 };
  const wanted = new Set(
    selections.filter((s) => s?.contractId && s?.ruleId).map((s) => `${s.contractId}:${s.ruleId}`),
  );
  if (!wanted.size) return results;

  const ruleIds = [...new Set(selections.map((s) => s.ruleId))];
  const rules = (await AutomationRule.find({ _id: { $in: ruleIds }, triggerEvent: 'contract_expiry' }).lean())
    .filter((r) => r.steps?.length);
  if (!rules.length) return results;

  const waAllowed = await getWhatsAppAutomation();
  const templates = await MessageTemplate.find().lean();
  const templatesByName = new Map();
  for (const t of templates) {
    templatesByName.set(String(t.label || '').trim().toLowerCase(), t);
    templatesByName.set(String(t.key || '').trim().toLowerCase(), t);
  }

  for (const c of await expiryCandidates({ rules })) {
    if (!wanted.has(`${c.contract._id}:${c.rule._id}`)) continue;
    const messages = await resolveMessages(c.picked.s, templatesByName, 'contract_expiry', c.vars);
    await dispatch({ rule: c.rule, contract: c.contract, eventKey: c.eventKey, stepIdx: c.picked.idx, messages, dryRun: false, results, waAllowed });
  }
  return results;
}
