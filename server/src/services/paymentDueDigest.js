/**
 * Tells accounts, once, which tenants have their next 4-week rent cycle
 * landing in exactly seven days — so an invoice can be raised or a nudge sent
 * to the tenant before the due date arrives, not after it.
 *
 * The due date for each contract is computed, not looked up — see
 * services/billingCycle.js for why the local Payment collection cannot
 * answer "when is this contract's next payment due" for an ongoing lease
 * invoiced through Zoho Books after signing.
 *
 * The wording is an editable MessageTemplate (key: accounts_payment_due_digest),
 * same as every tenant-facing email — visible and editable from the Message
 * Templates page. Only the intro text is templated; the list of who is due is
 * always generated fresh, since hand-editing a list of tenants makes no sense.
 *
 * Idempotent through each Contract's lastDueSoonNotifiedFor: a restart or an
 * extra tick on the same day cannot mention the same cycle twice. Nothing
 * here throws — a digest that fails to send must never be the reason a
 * scheduler tick stops.
 */

import { Contract, MessageTemplate } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { accountsAddresses, whyNotEmailed } from './staffMail.js';
import { dubaiDayRange } from './automationEngine.js';
import { nextPaymentDueDate } from './billingCycle.js';

export const DUE_SOON_KEY = 'accounts_payment_due_digest';
export const DUE_SOON_DAYS = 7;

const DATE = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', DATE) : '—');
const money = (n) => (Number.isFinite(Number(n))
  ? `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—');

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function interpolate(text, vars) {
  return String(text || '').replace(/@(\w+)/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
}

function unitLabel(contract) {
  const many = (contract?.units || []).map((u) => u?.unitNumber).filter(Boolean);
  if (many.length) return many.join(', ');
  return contract?.unit?.unitNumber || '—';
}

const FALLBACK_SUBJECT = 'Payments due in @days days — @count tenant(s)';
const FALLBACK_BODY = 'Hi team,\n\nThe following @count payment(s) are due in @days days, on @date.\n\nPlease raise invoices / follow up as needed.';

/**
 * The active contracts whose computed next-due date falls exactly `days`
 * from now, and have not already been mentioned for that specific cycle.
 * Exported separately from the send step so a dry run or a test can inspect
 * exactly what would go out.
 */
export async function collectPaymentsDueSoon({ now = new Date(), days = DUE_SOON_DAYS } = {}) {
  const { start, end } = dubaiDayRange(new Date(now.getTime() + days * 86_400_000));

  const contracts = await Contract.find({ status: 'active' })
    .select('contractNo customer unit units startDate endDate rate lastDueSoonNotifiedFor')
    .populate('customer', 'fullName email phone')
    .populate('unit', 'unitNumber')
    .populate('units', 'unitNumber')
    .lean();

  const due = [];
  for (const c of contracts) {
    const nextDue = nextPaymentDueDate({ startDate: c.startDate, endDate: c.endDate, now });
    if (!nextDue || nextDue < start || nextDue >= end) continue;
    // Already mentioned for this exact cycle — do not repeat it just because
    // the job ticks more than once before the cycle rolls over.
    if (c.lastDueSoonNotifiedFor && new Date(c.lastDueSoonNotifiedFor).getTime() === nextDue.getTime()) continue;
    due.push({ contract: c, dueDate: nextDue });
  }
  due.sort((a, b) => a.dueDate - b.dueDate);
  return due;
}

/**
 * The message itself — pure, so it can be asserted against. `template` is the
 * editable MessageTemplate row (may be null, in which case the fallback
 * wording is used, same convention as every other automated email here).
 */
export function buildPaymentDueDigest({ due, template, days = DUE_SOON_DAYS, now = new Date() }) {
  const vars = { count: due.length, days, date: fmtDate(new Date(now.getTime() + days * 86_400_000)) };
  const subject = interpolate(template?.subject?.trim() || FALLBACK_SUBJECT, vars);
  const intro = interpolate(template?.emailBody?.trim() || FALLBACK_BODY, vars);

  const rows = due.map(({ contract, dueDate }) => ({
    tenant: contract.customer?.fullName || '—',
    unit: unitLabel(contract),
    contractNo: contract.contractNo || '—',
    // Every cycle after the first is billed at the full monthly/4-week rate
    // — the first-cycle discount never applies past the first invoice (see
    // [[billing-28day-logic]]) — so contract.rate is always the right figure
    // here.
    amount: money(contract.rate),
    dueDate: fmtDate(dueDate),
  }));

  const text = [
    intro,
    '',
    ...rows.map((r) => `${r.tenant} — Unit ${r.unit} — ${r.contractNo} — ${r.amount} — due ${r.dueDate}`),
    '',
    'PurpleBox',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14081F;max-width:620px">
      <p style="font-size:14px;white-space:pre-line">${escapeHtml(intro)}</p>
      <table style="border-collapse:collapse;width:100%;margin-top:10px">
        <tr>
          ${['Tenant', 'Unit', 'Contract', 'Amount', 'Due'].map((h) => `<th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#756E80;padding:4px 10px 4px 0;border-bottom:1px solid #E6E0F0">${h}</th>`).join('')}
        </tr>
        ${rows.map((r) => `
        <tr>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#14081F">${escapeHtml(r.tenant)}</td>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#14081F">${escapeHtml(r.unit)}</td>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#14081F">${escapeHtml(r.contractNo)}</td>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#14081F">${escapeHtml(r.amount)}</td>
          <td style="padding:6px 0;font-size:13px;color:#14081F">${escapeHtml(r.dueDate)}</td>
        </tr>`).join('')}
      </table>
      <p style="font-size:13px;color:#756E80;margin-top:18px">PurpleBox</p>
    </div>`;

  return { subject, text, html };
}

/**
 * Send today's digest. Idempotent through each Contract's
 * lastDueSoonNotifiedFor — see the field's own comment on the model.
 */
export async function runPaymentDueDigest({ now = new Date() } = {}) {
  const due = await collectPaymentsDueSoon({ now });
  if (!due.length) return { sent: false, reason: 'nothing due', count: 0 };
  if (!mailConfigured()) return { sent: false, reason: 'email is not configured', count: due.length };

  const recipients = await accountsAddresses();
  if (!recipients.length) return { sent: false, reason: whyNotEmailed({ role: 'accounts' }), count: due.length };

  // Editable from the Message Templates page — see DEFAULT_TEMPLATES in
  // routes/messageTemplates.js for the seeded starting text.
  const template = await MessageTemplate.findOne({ key: DUE_SOON_KEY }).lean();
  const { subject, text, html } = buildPaymentDueDigest({ due, template, now });

  try {
    // Extra recipients set on the template itself (e.g. a manager copied in
    // addition to everyone with the accounts role) — see Message Templates →
    // Accounts: Payment Due Soon.
    const cc = template?.cc?.trim() || undefined;
    await sendMail({
      to: recipients.join(', '),
      cc,
      subject, text, html,
      context: { kind: 'accounts_payment_due_digest' },
    });
    await Contract.bulkWrite(due.map(({ contract, dueDate }) => ({
      updateOne: {
        filter: { _id: contract._id },
        update: { $set: { lastDueSoonNotifiedFor: dueDate } },
      },
    })));
    return { sent: true, count: due.length, to: recipients };
  } catch (e) {
    console.error('[PaymentDueDigest]', e.message);
    return { sent: false, reason: e.message, count: due.length };
  }
}
