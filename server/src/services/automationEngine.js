import mongoose from 'mongoose';
import { AutomationRule, AutomationLog, MessageTemplate, Payment, Contract } from '../models/index.js';
import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';
import { sendMail, mailConfigured } from './mail.js';
import { renewLink, moveOutLink } from './renewalLink.js';

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

async function alreadySent({ rule, eventKey, channel, recurring }) {
  const filter = { rule: rule._id, event: eventKey, channel, status: 'sent' };
  if (recurring?.enabled) {
    filter.sentAt = { $gte: new Date(Date.now() - Math.max(1, recurring.everyDays) * DAY) };
  }
  return !!(await AutomationLog.findOne(filter).select('_id').lean());
}

async function resolveMessages(step, templatesByName, event, vars) {
  const tpl = templatesByName.get((step.template || '').trim().toLowerCase());
  const whatsappBody = step.whatsappBody?.trim() || tpl?.whatsappBody || FALLBACK_MESSAGES[event];
  const emailBody = step.emailBody?.trim() || tpl?.emailBody || FALLBACK_MESSAGES[event];
  const emailSubject = step.emailSubject?.trim() || tpl?.subject || 'PurpleBox Storage — Reminder';
  return {
    whatsapp: interpolate(whatsappBody, vars),
    emailText: interpolate(emailBody, vars),
    emailHtml: interpolate(step.emailHtml?.trim() || tpl?.emailHtml || '', vars),
    emailSubject: interpolate(emailSubject, vars),
  };
}

async function dispatch({ rule, contract, eventKey, stepIdx, messages, dryRun, results }) {
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

  const channels = [];
  if (rule.whatsappEnabled && whatsappSendConfigured() && phone) channels.push('whatsapp');
  if (rule.emailEnabled && mailConfigured() && email) channels.push('email');
  if (!channels.length) { results.skipped++; return; }

  for (const channel of channels) {
    if (await alreadySent({ rule, eventKey, channel, recurring: rule.recurring })) { results.skipped++; continue; }
    if (dryRun) {
      results.planned.push({ rule: rule.name, contract: contract.contractNo, customer: customer.fullName, channel, step: stepIdx, message: channel === 'whatsapp' ? messages.whatsapp : messages.emailText });
      continue;
    }
    try {
      if (channel === 'whatsapp') {
        await sendWhatsAppText({ to: phone, body: messages.whatsapp });
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

export async function runAutomationRules({ dryRun = false } = {}) {
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
        await dispatch({ rule, contract, eventKey, stepIdx: picked.idx, messages, dryRun, results });
      }
    }
  }

  if (expiryRules.length) {
    const maxBefore = Math.max(0, ...expiryRules.flatMap((r) => r.steps.map((s) => s.value)));
    const contracts = await Contract.find({
      status: 'active',
      endDate: { $gte: new Date(now), $lte: new Date(now + (maxBefore + 1) * DAY) },
    }).populate([{ path: 'customer' }, { path: 'unit' }, { path: 'units' }]).lean();

    for (const contract of contracts) {
      if (!contract.customer) continue;
      if (contract.remindersMuted) { results.skipped++; continue; }

      const daysLeft = Math.ceil((new Date(contract.endDate).getTime() - now) / DAY);
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

      for (const rule of expiryRules) {
        if (!effectiveEnabled(contract, rule)) continue;
        const picked = pickStep(rule.steps, daysLeft);
        if (!picked) continue;
        const eventKey = `contract_expiry:${contract._id}:step${picked.idx}`;
        const messages = await resolveMessages(picked.s, templatesByName, 'contract_expiry', vars);
        await dispatch({ rule, contract, eventKey, stepIdx: picked.idx, messages, dryRun, results });
      }
    }
  }

  if (!dryRun) console.log(`[Automation] sent=${results.sent} skipped=${results.skipped} errors=${results.errors}`);
  return results;
}
