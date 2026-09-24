/**
 * Tells accounts, once, which tenants have a payment due in exactly seven
 * days — so an invoice can be raised or a nudge sent to the tenant before the
 * due date arrives, not after it.
 *
 * Sourced from the Payment collection, the same place the tenant-facing
 * payment_due automation reads from (see automationEngine.js) — not from
 * Contract.nextPaymentDate, which is only ever written once, at legacy
 * import time, and nothing keeps it current.
 *
 * The wording is an editable MessageTemplate (key: accounts_payment_due_digest),
 * same as every tenant-facing email — visible and editable from the Message
 * Templates page. Only the intro text is templated; the list of who is due is
 * always generated fresh, since hand-editing a list of tenants makes no sense.
 *
 * Idempotent through each Payment's accountsDueSoonNotifiedAt: a restart or an
 * extra tick on the same day cannot mention the same due date twice. Nothing
 * here throws — a digest that fails to send must never be the reason a
 * scheduler tick stops.
 */

import { Payment, MessageTemplate } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { accountsAddresses, whyNotEmailed } from './staffMail.js';
import { dubaiDayRange } from './automationEngine.js';

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
 * The due payments, seven days out, that have not already been mentioned.
 * Exported separately from the send step so a dry run or a test can inspect
 * exactly what would go out.
 */
export async function collectPaymentsDueSoon({ now = new Date(), days = DUE_SOON_DAYS } = {}) {
  const { start, end } = dubaiDayRange(new Date(now.getTime() + days * 86_400_000));
  const payments = await Payment.find({
    status: { $in: ['pending', 'overdue'] },
    dueDate: { $gte: start, $lt: end },
    accountsDueSoonNotifiedAt: null,
  })
    .populate({
      path: 'contract',
      select: 'contractNo customer unit units status',
      populate: [
        { path: 'customer', select: 'fullName email phone' },
        { path: 'unit', select: 'unitNumber' },
        { path: 'units', select: 'unitNumber' },
      ],
    })
    .sort({ dueDate: 1 })
    .lean();

  // A payment on a contract that no longer exists, or has since ended,
  // is not accounts' problem any more — drop it rather than emailing a
  // reminder nobody can act on.
  return payments.filter((p) => p.contract && p.contract.status !== 'ended' && p.contract.status !== 'cancelled');
}

/**
 * The message itself — pure, so it can be asserted against. `template` is the
 * editable MessageTemplate row (may be null, in which case the fallback
 * wording is used, same convention as every other automated email here).
 */
export function buildPaymentDueDigest({ payments, template, days = DUE_SOON_DAYS, now = new Date() }) {
  const vars = { count: payments.length, days, date: fmtDate(new Date(now.getTime() + days * 86_400_000)) };
  const subject = interpolate(template?.subject?.trim() || FALLBACK_SUBJECT, vars);
  const intro = interpolate(template?.emailBody?.trim() || FALLBACK_BODY, vars);

  const rows = payments.map((p) => ({
    tenant: p.contract.customer?.fullName || '—',
    unit: unitLabel(p.contract),
    contractNo: p.contract.contractNo || '—',
    amount: money(p.amount),
    dueDate: fmtDate(p.dueDate),
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
 * Send today's digest. Idempotent through accountsDueSoonNotifiedAt — see the
 * field's own comment on the Payment schema.
 */
export async function runPaymentDueDigest({ now = new Date() } = {}) {
  const payments = await collectPaymentsDueSoon({ now });
  if (!payments.length) return { sent: false, reason: 'nothing due', count: 0 };
  if (!mailConfigured()) return { sent: false, reason: 'email is not configured', count: payments.length };

  const recipients = await accountsAddresses();
  if (!recipients.length) return { sent: false, reason: whyNotEmailed({ role: 'accounts' }), count: payments.length };

  // Editable from the Message Templates page — see DEFAULT_TEMPLATES in
  // routes/messageTemplates.js for the seeded starting text.
  const template = await MessageTemplate.findOne({ key: DUE_SOON_KEY }).lean();
  const { subject, text, html } = buildPaymentDueDigest({ payments, template, now });

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
    await Payment.updateMany(
      { _id: { $in: payments.map((p) => p._id) } },
      { $set: { accountsDueSoonNotifiedAt: now } },
    );
    return { sent: true, count: payments.length, to: recipients };
  } catch (e) {
    console.error('[PaymentDueDigest]', e.message);
    return { sent: false, reason: e.message, count: payments.length };
  }
}
