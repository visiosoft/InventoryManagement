import { Lead, WhatsAppMessage } from '../../models/index.js';
import { registerTool } from './tools.js';
import { holdProposal, registerRunner, markProposalTool, markWriteTool } from './actions.js';
import { customersWaitingForReply, followUpList, FOLLOW_UP_LISTS, listInvoices, pendingPayments, listQuotes, contractDetail } from '../../mcp/crmTools.js';
import { leadFollowUpFile, followUpBriefing } from '../../mcp/followUps.js';
import { zohoOutstanding, zohoCustomerLedger } from '../../mcp/zohoTools.js';
import {
   api, createInvoice, recordInvoicePayment, sendInvoice, listMessageTemplates, sendContractWhatsApp, markPaymentVerified, extendContract, updateLeadStatus,
} from '../../mcp/writeTools.js';

/**
 * The rest of a sales rep's day, for the assistant in the staff app.
 *
 * The Claude connector (mcp/server.js) could already read follow-ups, chats,
 * invoices and Zoho, and act on leads, invoices and contracts. The assistant
 * inside the app could not — so a rep had to leave the app to do any of it.
 * These are those same functions, offered to the in-app assistant, with two
 * differences that matter:
 *
 *   - every write runs with the asking person's own token, never the
 *     connector's admin one, so the API's own role checks (a rep may only
 *     touch their own leads) and the audit trail are exactly theirs;
 *   - anything that reaches a customer or moves money is a proposal: the
 *     card shows what will happen and nothing runs until they press Confirm.
 *     Lead housekeeping (status, visit date, a note) runs straight away, the
 *     same as create_lead and schedule_follow_up already do.
 */

const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const link = (label, path) => ({ label, path });
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DAY = 86_400_000;
const shortDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });

/** One lead, by id, phone or name. A name that matches several is an error
 *  that names them, rather than a guess at which one was meant. */
async function findLead({ leadId, query, phone }) {
   if (leadId && /^[a-f0-9]{24}$/i.test(String(leadId))) {
      const l = await Lead.findById(leadId).lean();
      if (l) return { lead: l };
   }
   const q = String(phone || query || '').trim();
   if (!q) return { error: 'Which lead? Give a name or phone number.' };
   const digits = q.replace(/\D/g, '');
   if (digits.length >= 7) {
      const l = await Lead.findOne({ phoneNormalized: new RegExp(`${suffix(digits)}$`), deletedAt: null }).lean();
      return l ? { lead: l } : { error: `No lead with the number ${q}` };
   }
   const found = await Lead.find({ fullName: new RegExp(esc(q), 'i'), deletedAt: null }).sort({ leadDateTime: -1 }).limit(5).lean();
   if (!found.length) return { error: `No lead called "${q}"` };
   const exact = found.filter((l) => l.fullName.toLowerCase() === q.toLowerCase());
   if (found.length === 1 || exact.length === 1) return { lead: exact[0] || found[0] };
   return { error: `Several leads match "${q}": ${found.map((l) => `${l.fullName} (${l.phone})`).join('; ')}. Which one?` };
}

const leadLinks = (l) => [link(l.fullName, `/leads/${l._id}`), link(`Chat with ${l.fullName}`, `/whatsapp/${l.phoneNormalized}`)];

// appOnly: the connector already has its own versions of all of these, so
// mcp/server.js leaves them out rather than listing each one twice.
function read(def) {
   registerTool({ ...def, appOnly: true });
}
function write(def) {
   registerTool({ ...def, appOnly: true });
   markWriteTool(def.name);
}
function proposal(def, kind, run) {
   registerTool({ ...def, appOnly: true });
   markProposalTool(def.name);
   registerRunner(kind, run);
}

/* ── reading ──────────────────────────────────────────────────────────────── */

read({
   name: 'lead_file',
   description: 'Everything about ONE lead: status, owner, follow-up date and whether it is overdue, site visit, call attempts, timeline, tasks, and the recent WhatsApp conversation with whose turn it is. Use before replying to, judging or acting on a lead ("what happened with X?", "what should I say to her?", "is he interested?").',
   parameters: {
      type: 'object',
      properties: {
         query: { type: 'string', description: "The lead's name or phone number" },
         leadId: { type: 'string' },
         messages: { type: 'number', description: 'How many recent messages (default 20)' },
      },
   },
   async run({ query, leadId, messages }) {
      const found = await findLead({ leadId, query });
      if (found.error) return { error: found.error };
      const file = await leadFollowUpFile({ leadId: String(found.lead._id), messages });
      return { ...file, leadId: String(found.lead._id), links: leadLinks(found.lead) };
   },
});

read({
   name: 'customers_waiting',
   description: 'WhatsApp chats where the customer wrote last and nobody has replied, longest wait first, with their lead and owner.',
   parameters: { type: 'object', properties: { minHours: { type: 'number', description: 'Waiting at least this many hours (default 1)' } } },
   run: ({ minHours = 1 }) => customersWaitingForReply({ minHours, limit: 40 }),
});

read({
   name: 'focus_list',
   description: `Leads to work on, by list: ${Object.entries(FOLLOW_UP_LISTS).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
   parameters: { type: 'object', properties: { list: { type: 'string', enum: Object.keys(FOLLOW_UP_LISTS) } }, required: ['list'] },
   run: ({ list }) => followUpList({ list, limit: 40 }),
});

read({
   name: 'followup_briefing',
   description: `A batch of leads to follow up, each with its latest WhatsApp messages, so you can say what to send each one and how urgent it is. Lists: ${Object.keys(FOLLOW_UP_LISTS).join(', ')}. For a sales rep, pass their own name as rep.`,
   parameters: {
      type: 'object',
      properties: {
         list: { type: 'string', enum: Object.keys(FOLLOW_UP_LISTS) },
         rep: { type: 'string', description: 'Part of a rep name' },
         limit: { type: 'number', description: 'Leads to include, max 15 (default 8)' },
      },
   },
   run: ({ list, rep, limit = 8 }) => followUpBriefing({ list, rep, limit: Math.min(15, limit), messagesPer: 5 }),
});

read({
   name: 'list_invoices',
   description: 'Invoices, newest first. Filter by status (draft, sent, paid, partial, overdue, cancelled), customer name, YYYY-MM-DD date range, or overdueOnly.',
   parameters: { type: 'object', properties: { status: { type: 'string' }, customer: { type: 'string' }, overdueOnly: { type: 'boolean' }, from: { type: 'string' }, to: { type: 'string' } } },
   run: (a) => listInvoices({ ...a, limit: 30 }),
});

read({
   name: 'pending_payments',
   description: 'Payments still due from tenants, oldest first, with the total owed and days overdue, and each one\'s paymentId.',
   parameters: { type: 'object', properties: { overdueOnly: { type: 'boolean' } } },
   run: (a) => pendingPayments({ ...a, limit: 40 }),
});

read({
   name: 'list_quotes',
   description: 'Quotations, newest first. Filter by status (draft, sent, accepted, rejected, expired) or customer name.',
   parameters: { type: 'object', properties: { status: { type: 'string' }, customer: { type: 'string' } } },
   run: (a) => listQuotes({ ...a, limit: 30 }),
});

read({
   name: 'contract_detail',
   description: 'One contract by number (e.g. PB-2026-0116): tenant, unit, dates, rate, renewal intent, whether the first payment is verified, and its invoices and payments.',
   parameters: { type: 'object', properties: { contractNo: { type: 'string' } }, required: ['contractNo'] },
   run: (a) => contractDetail(a),
});

read({
   name: 'zoho_ledger',
   description: "One customer's invoices, payments and balance in Zoho Books, by name or phone.",
   parameters: { type: 'object', properties: { query: { type: 'string', description: 'Customer name or phone number' } }, required: ['query'] },
   run: (a) => zohoCustomerLedger(a),
});

read({
   name: 'zoho_outstanding',
   description: 'Who owes money according to Zoho Books, biggest balance first, with the total.',
   parameters: { type: 'object', properties: {} },
   run: () => zohoOutstanding({ limit: 30 }),
});

read({
   name: 'message_templates',
   description: 'The saved message templates and which have an approved WhatsApp template (the only kind that reaches a chat that has been quiet for 24 hours).',
   parameters: { type: 'object', properties: {} },
   run: () => listMessageTemplates(),
});

/* ── lead housekeeping, which runs straight away ──────────────────────────── */

write({
   name: 'set_lead_status',
   description: 'Move a lead to a stage: contact_attempted, contacted, site_visit_scheduled, follow_up_scheduled, quotation_sent, won, lost, already_customer. Lost needs lostReason (price, timing, wrong_size, went_elsewhere, no_response, not_interested, wrong_number, other) — read the conversation first and only use lost when the customer said so or never answered. Executes immediately.',
   parameters: {
      type: 'object',
      properties: {
         query: { type: 'string', description: "The lead's name or phone number" },
         leadId: { type: 'string' },
         status: { type: 'string' },
         lostReason: { type: 'string' },
         comment: { type: 'string', description: 'Why, in a line' },
      },
      required: ['status'],
   },
   async run({ query, leadId, status, lostReason, comment }, { authHeader }) {
      const found = await findLead({ leadId, query });
      if (found.error) return { error: found.error };
      try {
         const out = await updateLeadStatus({ leadId: String(found.lead._id), status, lostReason, comment }, { authHeader });
         return { ok: true, ...out, message: `${found.lead.fullName} is now ${String(out.status).replace(/_/g, ' ')}.`, links: leadLinks(found.lead) };
      } catch (e) { return { error: e.message }; }
   },
});

write({
   name: 'schedule_site_visit',
   description: 'Book (or move) a site visit for a lead, at a date and time in Dubai. Executes immediately. Use when the customer agreed to come and see the units.',
   parameters: {
      type: 'object',
      properties: {
         query: { type: 'string', description: "The lead's name or phone number" },
         leadId: { type: 'string' },
         date: { type: 'string', description: 'YYYY-MM-DD' },
         time: { type: 'string', description: 'HH:MM, 24-hour, Dubai time (default 11:00)' },
      },
      required: ['date'],
   },
   async run({ query, leadId, date, time = '11:00' }, { authHeader }) {
      const found = await findLead({ leadId, query });
      if (found.error) return { error: found.error };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{1,2}:\d{2}$/.test(String(time))) return { error: 'Date must be YYYY-MM-DD and time HH:MM' };
      const at = new Date(`${date}T${String(time).padStart(5, '0')}:00+04:00`);
      if (Number.isNaN(at.getTime())) return { error: 'Not a valid date' };
      try {
         await api('PUT', `/leads/${found.lead._id}`, { siteVisitAt: at.toISOString() }, authHeader);
      } catch (e) { return { error: e.message }; }
      // The visit is booked either way; the stage is a convenience on top.
      if (['new', 'contact_attempted', 'contacted', 'follow_up_scheduled'].includes(found.lead.status)) {
         await api('PATCH', `/leads/${found.lead._id}/status`, { status: 'site_visit_scheduled' }, authHeader).catch(() => {});
      }
      return { ok: true, message: `Site visit with ${found.lead.fullName} booked for ${shortDay(at)} at ${time}.`, links: leadLinks(found.lead) };
   },
});

write({
   name: 'add_lead_note',
   description: "Add a note to a lead's record (what the customer said on a call, what they need). Executes immediately.",
   parameters: {
      type: 'object',
      properties: {
         query: { type: 'string', description: "The lead's name or phone number" },
         leadId: { type: 'string' },
         text: { type: 'string' },
      },
      required: ['text'],
   },
   async run({ query, leadId, text }, { authHeader }) {
      const found = await findLead({ leadId, query });
      if (found.error) return { error: found.error };
      const note = String(text || '').trim();
      if (!note) return { error: 'The note is empty' };
      try {
         await api('POST', `/leads/${found.lead._id}/comments`, { text: note.slice(0, 2000) }, authHeader);
      } catch (e) { return { error: e.message }; }
      return { ok: true, message: `Note added to ${found.lead.fullName}.`, links: leadLinks(found.lead) };
   },
});

/* ── things that reach a customer or move money: card first ──────────────── */

const CONFIRM_LINE = 'Say in one line what is ready and that nothing happens until they press Confirm on the card. Do not repeat the card.';

proposal({
   name: 'propose_whatsapp_message',
   description: 'Prepare a WhatsApp message to a lead or customer, written by you. Read their conversation with lead_file first so the message answers what they last said. Short, warm, plain English (or the language they wrote in), no prices or dates that a tool did not give you. Only prepares it — it is sent when the person confirms.',
   parameters: {
      type: 'object',
      properties: {
         query: { type: 'string', description: "The lead's name or phone number" },
         leadId: { type: 'string' },
         message: { type: 'string' },
      },
      required: ['message'],
   },
   async run({ query, leadId, message }, { user }) {
      const found = await findLead({ leadId, query });
      if (found.error) return { error: found.error };
      const l = found.lead;
      const text = String(message || '').trim();
      if (!text) return { error: 'The message is empty' };
      const lastIn = await WhatsAppMessage.findOne({ phoneNormalized: new RegExp(`${suffix(l.phoneNormalized)}$`), direction: 'inbound' })
         .sort({ occurredAt: -1 }).select('occurredAt').lean();
      if (!lastIn || Date.now() - new Date(lastIn.occurredAt).getTime() >= DAY) {
         return { error: `${l.fullName} has not written in the last 24 hours, so WhatsApp only allows an approved template. Open the chat and send one of the templates instead.`, links: leadLinks(l) };
      }
      return {
         ...holdProposal({
            user, kind: 'send_whatsapp',
            summary: [`WhatsApp to ${l.fullName} (${l.phone})`, text],
            spec: { phone: l.phoneNormalized, body: text, name: l.fullName },
         }),
         links: leadLinks(l),
         instruction: CONFIRM_LINE,
      };
   },
}, 'send_whatsapp', async ({ phone, body, name }, { authHeader }) => {
   await api('POST', '/whatsapp/send', { to: phone, body }, authHeader);
   return { ok: true, message: `Sent to ${name} on WhatsApp.` };
});

proposal({
   name: 'propose_invoice',
   description: 'Prepare an invoice against a contract (a one-off charge, an extra period, a deposit…): contract number, description, quantity, rate in AED, due date. Only prepares it — created when the person confirms.',
   parameters: {
      type: 'object',
      properties: {
         contractNo: { type: 'string' },
         description: { type: 'string' },
         quantity: { type: 'number' },
         rate: { type: 'number', description: 'AED per unit, before VAT' },
         dueDate: { type: 'string', description: 'YYYY-MM-DD' },
         notes: { type: 'string' },
      },
      required: ['contractNo', 'description', 'rate', 'dueDate'],
   },
   async run(a, { user }) {
      const qty = Number(a.quantity || 1);
      const rate = Number(a.rate);
      if (!(rate >= 0)) return { error: 'The rate must be a number' };
      return {
         ...holdProposal({
            user, kind: 'create_invoice',
            summary: [`Invoice on ${a.contractNo}`, `${a.description} — ${qty} × AED ${rate.toLocaleString('en-GB')}`, `Due ${a.dueDate}`],
            spec: { ...a, quantity: qty, rate },
         }),
         instruction: CONFIRM_LINE,
      };
   },
}, 'create_invoice', async (spec, ctx) => {
   const out = await createInvoice(spec, ctx);
   return { ok: true, message: `Invoice ${out.invoiceNo} created on ${out.contractNo} for AED ${Number(out.total).toLocaleString('en-GB')}.` };
});

proposal({
   name: 'propose_send_invoice',
   description: 'Prepare sending an existing invoice to the tenant by WhatsApp or email. Only prepares it — sent when the person confirms.',
   parameters: {
      type: 'object',
      properties: { invoiceNo: { type: 'string' }, via: { type: 'string', enum: ['whatsapp', 'email'] } },
      required: ['invoiceNo'],
   },
   async run({ invoiceNo, via = 'whatsapp' }, { user }) {
      return { ...holdProposal({ user, kind: 'send_invoice', summary: [`Send invoice ${invoiceNo}`, `By ${via}`], spec: { invoiceNo, via } }), instruction: CONFIRM_LINE };
   },
}, 'send_invoice', async (spec, ctx) => {
   const out = await sendInvoice(spec, ctx);
   return { ok: true, message: `Invoice ${out.invoiceNo} sent by ${out.via}.` };
});

proposal({
   name: 'propose_record_payment',
   description: 'Prepare recording a payment received against an invoice (amount in AED, method cash / bank_transfer / card / other, date). Only prepares it — recorded when the person confirms.',
   parameters: {
      type: 'object',
      properties: {
         invoiceNo: { type: 'string' },
         amount: { type: 'number' },
         method: { type: 'string', enum: ['cash', 'bank_transfer', 'card', 'other'] },
         date: { type: 'string', description: 'YYYY-MM-DD, default today' },
         notes: { type: 'string' },
      },
      required: ['invoiceNo', 'amount'],
   },
   async run(a, { user }) {
      return {
         ...holdProposal({
            user, kind: 'record_payment',
            summary: [`Payment on ${a.invoiceNo}`, `AED ${Number(a.amount).toLocaleString('en-GB')} by ${String(a.method || 'bank_transfer').replace('_', ' ')}`, a.date ? `Received ${a.date}` : 'Received today'],
            spec: a,
         }),
         instruction: CONFIRM_LINE,
      };
   },
}, 'record_payment', async (spec, ctx) => {
   const out = await recordInvoicePayment(spec, ctx);
   return { ok: true, message: `Payment recorded on ${out.invoiceNo} — it is now ${out.status}.` };
});

proposal({
   name: 'propose_extend_contract',
   description: 'Prepare extending an active contract to a new check-out date, with a re-sign link for the customer. Only prepares it — done when the person confirms.',
   parameters: {
      type: 'object',
      properties: { contractNo: { type: 'string' }, newEndDate: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['contractNo', 'newEndDate'],
   },
   async run({ contractNo, newEndDate }, { user }) {
      return { ...holdProposal({ user, kind: 'extend_contract', summary: [`Extend ${contractNo}`, `New check-out ${newEndDate}`, 'With a re-sign link for the customer'], spec: { contractNo, newEndDate, allowReSign: true } }), instruction: CONFIRM_LINE };
   },
}, 'extend_contract', async (spec, ctx) => {
   const out = await extendContract(spec, ctx);
   return { ok: true, message: `${out.contractNo} now runs to ${out.newEndDate}.${out.signingUrl ? ' The re-sign link is ready.' : ''}` };
});

proposal({
   name: 'propose_contract_template',
   description: "Prepare sending an approved WhatsApp template (by its label, see message_templates) to a contract's tenant, filled from the contract. Only prepares it — sent when the person confirms.",
   parameters: {
      type: 'object',
      properties: { contractNo: { type: 'string' }, templateLabel: { type: 'string' } },
      required: ['contractNo', 'templateLabel'],
   },
   async run({ contractNo, templateLabel }, { user }) {
      return { ...holdProposal({ user, kind: 'contract_template', summary: [`WhatsApp "${templateLabel}"`, `To the tenant of ${contractNo}`], spec: { contractNo, templateLabel } }), instruction: CONFIRM_LINE };
   },
}, 'contract_template', async (spec, ctx) => {
   const out = await sendContractWhatsApp(spec, ctx);
   return { ok: true, message: `"${out.template}" sent on WhatsApp.` };
});

proposal({
   name: 'propose_payment_verified',
   description: 'Prepare marking the first payment of a newly signed contract as verified, which lets its unit turn Occupied. Only prepares it — done when the person confirms.',
   parameters: {
      type: 'object',
      properties: { contractNo: { type: 'string' }, note: { type: 'string' } },
      required: ['contractNo'],
   },
   async run({ contractNo, note = '' }, { user }) {
      return { ...holdProposal({ user, kind: 'payment_verified', summary: [`Mark first payment verified on ${contractNo}`, 'Its unit can then turn Occupied'], spec: { contractNo, verified: true, note } }), instruction: CONFIRM_LINE };
   },
}, 'payment_verified', async (spec, ctx) => {
   const out = await markPaymentVerified(spec, ctx);
   return { ok: true, message: `${out.contractNo}: first payment ${out.paymentVerified ? 'verified' : 'not verified'}.` };
});
