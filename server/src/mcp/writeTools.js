import jwt from 'jsonwebtoken';
import { User, Invoice, Contract, Lead, Customer, MessageTemplate, Payment } from '../models/index.js';

/**
 * What Claude may DO, as well as read. Every action goes through the
 * application's own API, so a quote is numbered and held, an invoice is created
 * and synced, a payment updates the invoice and the contract timeline, exactly
 * as when someone uses the page. Nothing here writes to the database directly.
 *
 * The identity on the audit trail is "Claude (MCP)". Claude's apps ask the
 * person to approve each action before it runs.
 */

const rx = (q) => new RegExp(`^${String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/** A short-lived admin token for calling the app's own API as "Claude (MCP)". */
export async function serviceAuthHeader() {
  const admin = await User.findOne({ role: 'admin', isActive: { $ne: false } }).sort({ createdAt: 1 }).select('_id email').lean();
  if (!admin) throw new Error('There is no active admin to act through');
  const token = jwt.sign({ id: String(admin._id), email: admin.email, name: 'Claude (MCP)', role: 'admin', permissions: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return `Bearer ${token}`;
}

/** `authHeader` is the asking person's own token when the in-app assistant
 *  runs one of these, so the API's role checks and the audit trail are
 *  theirs; without it (the MCP connector) it acts as "Claude (MCP)". */
export async function api(method, path, body, authHeader) {
  const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: authHeader || await serviceAuthHeader(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(json.error || `${method} ${path} failed (${r.status})`);
  return json;
}

const invoiceByNo = async (no) => { const i = await Invoice.findOne({ invoiceNo: rx(no) }).select('_id invoiceNo total paymentMade status customer').lean(); if (!i) throw new Error(`No invoice ${no}`); return i; };
const contractByNo = async (no) => { const c = await Contract.findOne({ contractNo: rx(no) }).select('_id contractNo customer').lean(); if (!c) throw new Error(`No contract ${no}`); return c; };

export async function createInvoice({ contractNo, description, quantity = 1, rate, dueDate, notes = '', items }, { authHeader } = {}) {
  const c = await contractByNo(contractNo);
  const lines = Array.isArray(items) && items.length ? items : [{ itemDetails: description, quantity, rate }];
  if (lines.some((l) => !l.itemDetails || !(Number(l.rate) >= 0))) throw new Error('Every line needs a description and a rate');
  const inv = await api('POST', '/invoices', { customer: String(c.customer), orderNumber: c.contractNo, dueDate, customerNotes: notes, items: lines.map((l) => ({ itemDetails: l.itemDetails, quantity: Number(l.quantity ?? 1), rate: Number(l.rate), amount: Number(l.quantity ?? 1) * Number(l.rate) })), status: 'sent' }, authHeader);
  return { created: true, invoiceNo: inv.invoiceNo, total: inv.total, due: inv.dueDate, contractNo: c.contractNo };
}

export async function recordInvoicePayment({ invoiceNo, amount, method = 'bank_transfer', date, notes = '' }, { authHeader } = {}) {
  const i = await invoiceByNo(invoiceNo);
  const out = await api('POST', `/invoices/${i._id}/record-payment`, { amount, method, date, notes }, authHeader);
  return { recorded: true, invoiceNo: out.invoiceNo, total: out.total, paid: out.paymentMade, status: out.status };
}

export async function recordScheduledPayment({ paymentId, method = 'bank_transfer', paidDate, notes = '', amount }, { authHeader } = {}) {
  const out = await api('POST', `/payments/${paymentId}/record`, { method, paidDate, notes, amount }, authHeader);
  return { recorded: true, status: out.status || 'paid', amount: out.amount };
}

export async function sendInvoice({ invoiceNo, via = 'whatsapp' }, { authHeader } = {}) {
  const i = await invoiceByNo(invoiceNo);
  const path = via === 'email' ? `/invoices/${i._id}/send-email` : `/invoices/${i._id}/whatsapp-send`;
  const out = await api('POST', path, {}, authHeader);
  return { sent: true, via, invoiceNo: i.invoiceNo, to: out.to || out.sentTo || undefined };
}

export async function listMessageTemplates() {
  const rows = await MessageTemplate.find({}).select('label key whatsappTemplate').lean();
  return { templates: rows.map((t) => ({ label: t.label, key: t.key, hasWhatsAppTemplate: Boolean((t.whatsappTemplate || '').trim()) })) };
}

export async function sendContractWhatsApp({ contractNo, templateLabel }, { authHeader } = {}) {
  const c = await contractByNo(contractNo);
  const t = await MessageTemplate.findOne({ label: rx(templateLabel) }).select('_id label whatsappTemplate').lean();
  if (!t) throw new Error(`No template called "${templateLabel}". Use list_message_templates to see them.`);
  const out = await api('POST', `/contracts/${c._id}/whatsapp-template`, { templateId: String(t._id) }, authHeader);
  return { sent: true, to: out.to, template: t.label };
}

export async function markPaymentVerified({ contractNo, verified = true, note = '' }, { authHeader } = {}) {
  const c = await contractByNo(contractNo);
  const out = await api('POST', `/contracts/${c._id}/payment-verified`, { verified, note }, authHeader);
  return { contractNo: c.contractNo, paymentVerified: Boolean(out.paymentGate?.verified), detail: out.paymentGate?.detail };
}

export async function extendContract({ contractNo, newEndDate, allowReSign = true }, { authHeader } = {}) {
  const c = await contractByNo(contractNo);
  const out = await api('POST', `/contracts/${c._id}/extend`, { newEndDate, allowReSign }, authHeader);
  return { extended: true, contractNo: c.contractNo, newEndDate, signingUrl: out.signingUrl || null };
}

export async function updateLeadStatus({ phone, leadId, status, lostReason, comment }, { authHeader } = {}) {
  let lead = null;
  if (leadId) lead = await Lead.findById(leadId).select('_id fullName').lean();
  else if (phone) { const k = String(phone).replace(/\D/g, '').slice(-9); lead = k.length >= 7 ? await Lead.findOne({ phoneNormalized: new RegExp(`${k}$`) }).select('_id fullName').lean() : null; }
  if (!lead) throw new Error('No lead found for that phone number or id');
  const out = await api('PATCH', `/leads/${lead._id}/status`, { status, lostReason, comment }, authHeader);
  return { updated: true, lead: lead.fullName, status: out.status };
}
