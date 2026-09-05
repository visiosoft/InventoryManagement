import crypto from 'node:crypto';
import { Customer, Lead, Quote, Unit, WhatsAppMessage } from '../../models/index.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { quoteLines, quoteTotals, termWeeks } from '../quoteLines.js';
import { uploadWhatsAppMedia, sendWhatsAppMedia, whatsappSendConfigured } from '../whatsapp.js';
import { mailConfigured } from '../mail.js';
import { pauseBotForHuman } from '../aiBot.js';
import { registerTool } from './tools.js';

/**
 * What the assistant may do, as opposed to know.
 *
 * Every action is two steps with a person between them. The model can only
 * *propose*: it gathers what it needs, the server prices it exactly as the
 * quote page would, and the widget shows a card saying what will happen.
 * Nothing is created or sent until someone presses Confirm. Then the executor
 * runs — through the application's own API, with the confirming user's own
 * token, so the quotation is created, numbered, attributed and held exactly
 * as if they had done it on the Book Unit page.
 *
 * The model never sees the executor. It cannot skip the card.
 */

export const PROPOSE_TOOL = 'propose_quotation';
const TTL_MS = 15 * 60_000;
const EXPIRY_DAYS = 30;

const proposals = new Map();
const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const money = (n) => Number(Number(n || 0).toFixed(2));
const fmt = (n) => `AED ${money(n).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;

function sweep() {
   const now = Date.now();
   for (const [id, p] of proposals) if (p.expiresAt <= now) proposals.delete(id);
}

/** The person, if we already know them. Phone first — it is the identity the
 *  rest of the system uses — then a name match if there is exactly one. */
async function findPerson({ phone, name }) {
   const key = suffix(phone);
   if (key.length >= 7) {
      const rx = new RegExp(`${key}$`);
      const customer = await Customer.findOne({ $or: [{ phone: rx }, { phones: rx }] }).lean();
      if (customer) return { customer, lead: null };
      const lead = await Lead.findOne({ phoneNormalized: rx }).lean();
      if (lead) return { customer: null, lead };
   }
   if (name) {
      const rx = new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const customers = await Customer.find({ fullName: rx }).limit(2).lean();
      if (customers.length === 1) return { customer: customers[0], lead: null };
   }
   return { customer: null, lead: null };
}

/** The unit and the price, the way the quote page would work them out. */
async function priceUnit({ unitNumber, sizeSqf, startDate, endDate, discountPct = 0 }) {
   const { allUnits, bookedUnitIds } = await computeUnitAvailability({ from: new Date(startDate), to: new Date(endDate) });
   let unit = null;
   if (unitNumber) {
      unit = allUnits.find((u) => String(u.unitNumber).toLowerCase() === String(unitNumber).toLowerCase())
         || await Unit.findOne({ unitNumber: new RegExp(`^${String(unitNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
      if (!unit) throw new Error(`No unit called ${unitNumber}`);
      if (bookedUnitIds.has(String(unit._id))) throw new Error(`${unit.unitNumber} is not free for those dates`);
   } else {
      const free = allUnits
         .filter((u) => !bookedUnitIds.has(String(u._id)) && Number(u.sizeSqf) === Number(sizeSqf) && u.price > 0)
         .sort((a, b) => a.price - b.price);
      if (!free.length) throw new Error(`No free ${sizeSqf} sq ft unit for those dates`);
      unit = free[0];
   }
   if (!(unit.price > 0)) throw new Error(`${unit.unitNumber} has no price set`);

   const line = { unitNumber: unit.unitNumber, sizeSqf: unit.sizeSqf, floor: unit.floor, rate: unit.price, discountPct, startDate, endDate };
   const quote = { units: [line], addOns: [], items: [], deposit: 0, holdAdvance: true, vatEnabled: true, vatRate: 5, adjustment: 0 };
   const rows = quoteLines(quote);
   const totals = quoteTotals(quote, rows);
   return { unit, line, rows, totals, weeks: termWeeks(line) };
}

async function replyWindowOpen(phone) {
   const key = suffix(phone);
   if (key.length < 7) return false;
   const last = await WhatsAppMessage.findOne({ phoneNormalized: new RegExp(`${key}$`), direction: 'inbound' })
      .sort({ occurredAt: -1 }).select('occurredAt').lean();
   return Boolean(last && Date.now() - new Date(last.occurredAt).getTime() < 24 * 3600_000);
}

/* ── the proposal, which the model may make ───────────────────────────────── */

registerTool({
   name: PROPOSE_TOOL,
   description: 'Prepare a quotation for a named person for a unit between two dates, and optionally send it. This only PREPARES it — the person asking must confirm in the chat before anything is created or sent. Use when asked to quote, book, reserve or hold a unit for somebody, or to send them a quotation.',
   parameters: {
      type: 'object',
      properties: {
         customerName: { type: 'string', description: 'The person\'s full name' },
         phone: { type: 'string', description: 'Their phone number, as given' },
         email: { type: 'string', description: 'Their email, if given' },
         unitNumber: { type: 'string', description: 'A specific unit, if named' },
         sizeSqf: { type: 'number', description: 'Or the size they want' },
         startDate: { type: 'string', description: 'YYYY-MM-DD' },
         endDate: { type: 'string', description: 'YYYY-MM-DD' },
         discountPct: { type: 'number', description: 'Discount on the first 4 weeks, if any' },
         sendVia: { type: 'string', enum: ['whatsapp', 'email', 'none'], description: 'How to send it, or none to only create it' },
      },
      required: ['customerName', 'startDate', 'endDate', 'sendVia'],
   },
   async run(args, { user }) {
      sweep();
      const { customerName, phone = '', email = '', unitNumber, sizeSqf, startDate, endDate, discountPct = 0, sendVia } = args;
      if (!unitNumber && !sizeSqf) return { error: 'Need a unit number or a size' };
      if (new Date(endDate) <= new Date(startDate)) return { error: 'End date must be after the start date' };
      if (sendVia === 'whatsapp' && suffix(phone).length < 7) return { error: 'A phone number is needed to send on WhatsApp' };

      let priced;
      try { priced = await priceUnit({ unitNumber, sizeSqf, startDate, endDate, discountPct }); }
      catch (e) { return { error: e.message }; }

      const { customer, lead } = await findPerson({ phone, name: customerName });
      const known = customer ? `existing customer ${customer.fullName}` : lead ? `existing lead ${lead.fullName}` : 'a new customer record';
      const emailTo = email || customer?.email || lead?.email || '';
      const windowOpen = sendVia === 'whatsapp' ? await replyWindowOpen(phone) : null;

      const summary = [
         `Quotation for ${customerName}${phone ? ` (${phone})` : ''} — ${known}`,
         `Unit ${priced.unit.unitNumber}, ${priced.unit.sizeSqf} sq ft, floor ${priced.unit.floor}, at ${fmt(priced.unit.price)} a month`,
         `${startDate} to ${endDate} · ${priced.weeks} week(s)${discountPct ? ` · ${discountPct}% off the first 4 weeks` : ''}`,
         `Total ${fmt(priced.totals.total)} — ${priced.rows.map((r) => `${r.title.toLowerCase()} ${fmt(r.amount)}`).join(', ')}, VAT ${fmt(priced.totals.vatAmount)}`,
         'The unit is held for this person once the quotation exists',
      ];
      if (sendVia === 'whatsapp') {
         summary.push(windowOpen
            ? `Send the PDF on WhatsApp to ${phone}`
            : `WhatsApp: they have not written in the last 24 hours, so the PDF cannot be delivered there${emailTo ? ` — it will go by email to ${emailTo} instead` : ' and there is no email on record, so it will be created but not sent'}`);
      } else if (sendVia === 'email') {
         summary.push(emailTo ? `Send the PDF by email to ${emailTo}` : 'Email: no address on record, so it will be created but not sent');
      } else {
         summary.push('Create it only — nothing is sent');
      }

      const id = crypto.randomBytes(8).toString('hex');
      const expiresAt = Date.now() + TTL_MS;
      proposals.set(id, {
         id, userId: String(user?.id || ''), kind: 'create_quotation', expiresAt, summary,
         spec: { customerName, phone, email: emailTo, unitNumber: priced.unit.unitNumber, startDate, endDate, discountPct, sendVia, customerId: customer?._id || null, leadId: lead?._id || null },
      });

      return {
         proposalId: id,
         summary,
         total: money(priced.totals.total),
         unit: priced.unit.unitNumber,
         instruction: 'Tell the user what you have prepared, in one or two lines, and that they need to press Confirm in the card to create it. Do not say it has been created or sent.',
      };
   },
});

export function takeProposal(id, userId) {
   sweep();
   const p = proposals.get(id);
   if (!p) return null;
   if (p.userId !== String(userId)) return null;
   proposals.delete(id);
   return p;
}

export function dropProposal(id) {
   proposals.delete(id);
}

/* ── the executor, which only a confirmed card reaches ────────────────────── */

/**
 * Create the quotation and send it, through the application's own API.
 *
 * Self-requests with the confirming user's token, so every side effect —
 * the quote number, the unit hold, who it is attributed to, the timeline, the
 * email path — is exactly the Book Unit page's. Nothing here is a second way
 * of doing any of it.
 */
export async function runAction(proposal, { authHeader }) {
   const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
   const call = async (method, path, body) => {
      const r = await fetch(`${base}${path}`, {
         method,
         headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
         body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let json = {};
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!r.ok) throw new Error(json.error || `${method} ${path} failed (${r.status})`);
      return json;
   };

   const s = proposal.spec;
   const steps = [];

   // 1. The person — found again now, or created.
   let customerId = s.customerId;
   if (!customerId) {
      const created = await Customer.create({
         fullName: s.customerName,
         phone: s.phone || '',
         phones: s.phone ? [s.phone] : [],
         email: s.email || '',
      });
      customerId = created._id;
      steps.push(`Created customer ${s.customerName}`);
   }

   // 2. The unit and price — priced again, in case it was taken since.
   const priced = await priceUnit({ unitNumber: s.unitNumber, startDate: s.startDate, endDate: s.endDate, discountPct: s.discountPct });

   // 3. The quotation, through the quotes API.
   const expiry = new Date(Date.now() + EXPIRY_DAYS * 864e5).toISOString().slice(0, 10);
   const quote = await call('POST', '/quotes', {
      customer: String(customerId),
      ...(s.leadId ? { lead: String(s.leadId) } : {}),
      units: [{ unit: String(priced.unit._id), ...priced.line }],
      addOns: [], items: [],
      expiryDate: expiry,
      holdAdvance: true,
      vatEnabled: true,
      subject: `Storage quotation — ${priced.unit.sizeSqf} sq ft`,
      status: 'draft',
   });
   // The quotation step of the wizard: from here the unit is held for them.
   await call('PATCH', `/quotes/${quote._id}/flow-step`, { step: 3 });
   steps.push(`Created quotation ${quote.quoteNo} for ${fmt(quote.total)} — ${priced.unit.unitNumber} is now held`);

   // 4. Sending, where asked and where possible.
   let sent = '';
   const wantsWhatsApp = s.sendVia === 'whatsapp';
   const wantsEmail = s.sendVia === 'email';

   if (wantsWhatsApp && whatsappSendConfigured() && await replyWindowOpen(s.phone)) {
      const pdfRes = await fetch(`${base}/quotes/${quote._id}/pdf`, { headers: { Authorization: authHeader } });
      if (!pdfRes.ok) throw new Error('Could not render the PDF');
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const filename = `${quote.quoteNo}.pdf`;
      const { id: mediaId } = await uploadWhatsAppMedia({ buffer, mimeType: 'application/pdf', filename });
      const caption = `Hello ${s.customerName}, please find your storage quotation ${quote.quoteNo} — ${fmt(quote.total)}. Thank you, PurpleBox.`;
      const result = await sendWhatsAppMedia({ to: s.phone, mediaId, kind: 'document', caption, filename });
      const phoneNormalized = String(s.phone).replace(/\D/g, '');
      await WhatsAppMessage.create({
         messageId: result?.messages?.[0]?.id || '',
         phone: s.phone, phoneNormalized,
         direction: 'outbound', type: 'document', text: caption, status: 'sent', occurredAt: new Date(), sentByAi: false,
         raw: { document: { id: mediaId, mime_type: 'application/pdf', filename, caption }, sendResult: result },
      });
      await pauseBotForHuman(phoneNormalized);
      await Quote.updateOne({ _id: quote._id }, {
         $set: { status: 'sent' },
         $push: { timeline: { type: 'sent', text: `Quote sent on WhatsApp to ${s.phone} via the assistant` } },
      });
      sent = `Sent on WhatsApp to ${s.phone}`;
   } else if ((wantsEmail || wantsWhatsApp) && s.email && mailConfigured()) {
      await call('POST', `/quotes/${quote._id}/send-email`, { to: s.email });
      sent = `Sent by email to ${s.email}${wantsWhatsApp ? ' (WhatsApp window was closed)' : ''}`;
   } else if (wantsWhatsApp || wantsEmail) {
      sent = wantsWhatsApp
         ? 'Not sent: they have not written on WhatsApp in the last 24 hours and there is no email on record'
         : 'Not sent: no email address on record';
   }
   if (sent) steps.push(sent);

   return {
      ok: true,
      quoteId: String(quote._id),
      quoteNo: quote.quoteNo,
      pdfPath: `/quotes/${quote._id}/pdf`,
      message: steps.join('. ') + '.',
   };
}
