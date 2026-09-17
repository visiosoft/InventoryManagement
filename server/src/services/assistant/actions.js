import crypto from 'node:crypto';
import { Customer, Lead, Quote, Unit, WhatsAppMessage } from '../../models/index.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { quoteLines, quoteTotals, termWeeks } from '../quoteLines.js';
import { uploadWhatsAppMedia, sendWhatsAppMedia, whatsappSendConfigured } from '../whatsapp.js';
import { mailConfigured, sendMail } from '../mail.js';
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
export const PROPOSE_CONTRACT_TOOL = 'propose_contract';
export const PROPOSE_EMAIL_TOOL = 'propose_email';
export const PROPOSAL_TOOLS = [PROPOSE_TOOL, PROPOSE_CONTRACT_TOOL, PROPOSE_EMAIL_TOOL];
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

/* A contract is a bigger thing than a quotation, and the card says so.
 *
 * Converting a quotation is the Book Unit page's own path, and it does more
 * than write one record: it generates the first draft invoice, marks the lead
 * as won, turns the person into a tenant, and holds the unit. None of that
 * is hidden from the person confirming — it is listed, line by line, on the
 * card. The contract is created as a draft, because a contract nobody has
 * signed is a draft; signing is the contract page's job, on paper or through
 * e-signature, and this does not pretend otherwise. */
registerTool({
   name: PROPOSE_CONTRACT_TOOL,
   description: 'Prepare a rental CONTRACT for a person — either from an existing quotation (give its number, e.g. QT-000159) or directly from a name, phone, unit or size and dates. Optionally send the contract PDF. This only PREPARES it; the person asking must confirm in the chat. Creating a contract also creates the first draft invoice, marks the lead as won and makes the person a tenant. Use when asked to create, make, issue or draw up a contract or agreement.',
   parameters: {
      type: 'object',
      properties: {
         quoteNo: { type: 'string', description: 'An existing quotation number to convert, e.g. QT-000159' },
         customerName: { type: 'string' },
         phone: { type: 'string' },
         email: { type: 'string' },
         unitNumber: { type: 'string' },
         sizeSqf: { type: 'number' },
         startDate: { type: 'string', description: 'YYYY-MM-DD' },
         endDate: { type: 'string', description: 'YYYY-MM-DD' },
         discountPct: { type: 'number' },
         sendVia: { type: 'string', enum: ['whatsapp', 'email', 'none'], description: 'Send the contract PDF, or none to only create it' },
      },
      required: ['sendVia'],
   },
   async run(args, { user }) {
      sweep();
      const { quoteNo, customerName, phone = '', email = '', unitNumber, sizeSqf, startDate, endDate, discountPct = 0, sendVia } = args;
      const summary = [];
      let spec;

      if (quoteNo) {
         const quote = await Quote.findOne({ quoteNo: new RegExp(`^${String(quoteNo).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
            .populate('customer', 'fullName phone email').lean();
         if (!quote) return { error: `No quotation called ${quoteNo}` };
         if (quote.contract) return { error: `${quote.quoteNo} has already been converted to a contract` };
         if (!quote.units?.length) return { error: `${quote.quoteNo} has no unit on it` };
         const u = quote.units[0];
         const who = quote.customer;
         summary.push(
            `Contract from quotation ${quote.quoteNo} for ${who?.fullName || 'its customer'}${who?.phone ? ` (${who.phone})` : ''}`,
            `Unit ${u.unitNumber}, ${u.sizeSqf} sq ft, ${new Date(u.startDate).toISOString().slice(0, 10)} to ${new Date(u.endDate).toISOString().slice(0, 10)}, at ${fmt(u.rate)} a month`,
            `Quotation total ${fmt(quote.total)}`,
         );
         spec = {
            quoteId: String(quote._id), quoteNo: quote.quoteNo,
            customerName: who?.fullName || '', phone: who?.phone || '', email: email || who?.email || '',
            sendVia,
         };
      } else {
         if (!customerName || !startDate || !endDate) return { error: "Need the person's name and the start and end dates, or a quotation number" };
         if (!unitNumber && !sizeSqf) return { error: 'Need a unit number or a size' };
         if (new Date(endDate) <= new Date(startDate)) return { error: 'End date must be after the start date' };
         let priced;
         try { priced = await priceUnit({ unitNumber, sizeSqf, startDate, endDate, discountPct }); }
         catch (e) { return { error: e.message }; }
         const { customer, lead } = await findPerson({ phone, name: customerName });
         const known = customer ? `existing customer ${customer.fullName}` : lead ? `existing lead ${lead.fullName}` : 'a new customer record';
         summary.push(
            `Contract for ${customerName}${phone ? ` (${phone})` : ''} — ${known}`,
            `Unit ${priced.unit.unitNumber}, ${priced.unit.sizeSqf} sq ft, floor ${priced.unit.floor}, at ${fmt(priced.unit.price)} a month`,
            `${startDate} to ${endDate} · ${priced.weeks} week(s)${discountPct ? ` · ${discountPct}% off the first 4 weeks` : ''}`,
            `Quotation first, total ${fmt(priced.totals.total)}, then the contract from it`,
         );
         spec = {
            customerName, phone, email: email || customer?.email || lead?.email || '',
            unitNumber: priced.unit.unitNumber, startDate, endDate, discountPct,
            customerId: customer?._id || null, leadId: lead?._id || null, sendVia,
         };
      }

      summary.push(
         'Creates the contract as a DRAFT — it still needs signing, from the contract page',
         'Also: the first invoice as a draft, the lead marked won, the person made a tenant, the unit held',
      );
      if (sendVia === 'whatsapp') {
         const open = await replyWindowOpen(spec.phone);
         summary.push(open
            ? `Send the contract PDF on WhatsApp to ${spec.phone}`
            : `WhatsApp: they have not written in the last 24 hours${spec.email ? ` — the PDF will go by email to ${spec.email} instead` : ' and there is no email on record, so it will be created but not sent'}`);
      } else if (sendVia === 'email') {
         summary.push(spec.email ? `Send the contract PDF by email to ${spec.email}` : 'Email: no address on record, so it will be created but not sent');
      } else {
         summary.push('Create it only — nothing is sent');
      }

      const id = crypto.randomBytes(8).toString('hex');
      proposals.set(id, { id, userId: String(user?.id || ''), kind: 'create_contract', expiresAt: Date.now() + TTL_MS, summary, spec });
      return {
         proposalId: id, kind: 'create_contract', summary,
         instruction: 'Tell the user what you have prepared in one or two lines, including that the contract will be a draft needing signature, and that they must press Confirm in the card. Do not say it has been created or sent.',
      };
   },
});

/* An email the model drafted, to people the database knows.
 *
 * The draft is the model's words, so it is held to the same rule as an
 * answer: any figure in it must have come from a tool. Recipients are
 * resolved here, by name or number, to the email on record — the card says
 * who will get it and who cannot be reached — and nothing goes until Confirm.
 * {{name}} in the body becomes each person's first name. */
registerTool({
   name: PROPOSE_EMAIL_TOOL,
   description: 'Draft an email to one or more customers or leads, to be sent from the company after the person asking confirms. Give the recipients by name or phone (or "the tenants whose contracts end this month" resolved from earlier results into names), a subject, and the body you drafted. Write {{name}} where the person\'s first name goes. Use only facts and figures that came from tools in this conversation. Use when asked to draft, write or send an email.',
   parameters: {
      type: 'object',
      properties: {
         recipients: { type: 'array', items: { type: 'string' }, description: 'Names or phone numbers of the people to email' },
         subject: { type: 'string' },
         body: { type: 'string', description: 'The email, plain text. {{name}} for the first name.' },
      },
      required: ['recipients', 'subject', 'body'],
   },
   async run({ recipients = [], subject, body }, { user }) {
      sweep();
      if (!recipients.length) return { error: 'Who should it go to?' };
      if (!String(subject || '').trim() || !String(body || '').trim()) return { error: 'Need a subject and a body' };

      const resolved = [];
      const unreachable = [];
      for (const r of recipients.slice(0, 50)) {
         const q = String(r || '').trim();
         if (!q) continue;
         const digits = q.replace(/\D/g, '');
         let person = null;
         if (digits.length >= 7) {
            const rx = new RegExp(`${suffix(digits)}$`);
            person = await Customer.findOne({ $or: [{ phone: rx }, { phones: rx }] }).lean()
               || await Lead.findOne({ phoneNormalized: rx }).lean();
         } else if (/@/.test(q)) {
            person = { fullName: q.split('@')[0], email: q };
         } else {
            const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            person = await Customer.findOne({ fullName: rx }).lean() || await Lead.findOne({ fullName: rx }).lean();
         }
         if (!person) { unreachable.push(`${q} — not found`); continue; }
         if (!person.email) { unreachable.push(`${person.fullName} — no email on record`); continue; }
         if (person.unsubscribed) { unreachable.push(`${person.fullName} — unsubscribed`); continue; }
         if (!resolved.some((x) => x.email === person.email)) resolved.push({ name: person.fullName, email: person.email });
      }
      if (!resolved.length) return { error: `Nobody to send to: ${unreachable.join('; ') || 'no recipients matched'}` };
      if (!mailConfigured()) return { error: 'Email is not configured on the server' };

      const summary = [
         `Email to ${resolved.length} ${resolved.length === 1 ? 'person' : 'people'}: ${resolved.map((r) => `${r.name} <${r.email}>`).join(', ')}`,
         ...(unreachable.length ? [`Cannot reach: ${unreachable.join('; ')}`] : []),
         `Subject: ${subject}`,
         `— ${String(body).trim()}`,
         'Sent from the company address, one email per person, {{name}} filled in',
      ];
      const id = crypto.randomBytes(8).toString('hex');
      proposals.set(id, { id, userId: String(user?.id || ''), kind: 'send_email', expiresAt: Date.now() + TTL_MS, summary, spec: { recipients: resolved, subject: String(subject), body: String(body) } });
      return {
         proposalId: id, kind: 'send_email', summary, recipients: resolved.length, unreachable,
         instruction: 'Say the draft is ready for them to read on the card and that nothing is sent until they confirm. Do not repeat the whole email in your reply.',
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

   if (proposal.kind === 'create_contract') return runContract(proposal, { call, base, authHeader });
   if (proposal.kind === 'send_email') return runEmail(proposal);

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

/**
 * Quotation → accepted → contract, through the same three routes the page
 * uses, then the PDF. Anything the convert route does — invoice, lead, tenant,
 * unit — it does here too, because it is the same code.
 */
async function runContract(proposal, { call, base, authHeader }) {
   const s = proposal.spec;
   const steps = [];

   let quoteId = s.quoteId;
   let quoteNo = s.quoteNo;
   if (!quoteId) {
      let customerId = s.customerId;
      if (!customerId) {
         const created = await Customer.create({ fullName: s.customerName, phone: s.phone || '', phones: s.phone ? [s.phone] : [], email: s.email || '' });
         customerId = created._id;
         steps.push(`Created customer ${s.customerName}`);
      }
      const priced = await priceUnit({ unitNumber: s.unitNumber, startDate: s.startDate, endDate: s.endDate, discountPct: s.discountPct });
      const expiry = new Date(Date.now() + EXPIRY_DAYS * 864e5).toISOString().slice(0, 10);
      const quote = await call('POST', '/quotes', {
         customer: String(customerId),
         ...(s.leadId ? { lead: String(s.leadId) } : {}),
         units: [{ unit: String(priced.unit._id), ...priced.line }],
         addOns: [], items: [], expiryDate: expiry, holdAdvance: true, vatEnabled: true,
         subject: `Storage quotation — ${priced.unit.sizeSqf} sq ft`, status: 'draft',
      });
      await call('PATCH', `/quotes/${quote._id}/flow-step`, { step: 3 });
      quoteId = quote._id;
      quoteNo = quote.quoteNo;
      steps.push(`Created quotation ${quoteNo} for ${fmt(quote.total)}`);
   }

   // Accepted, because only an accepted quotation can become a contract —
   // and the person confirming this card is the acceptance.
   await call('PATCH', `/quotes/${quoteId}/status`, { status: 'accepted' });
   const made = await call('POST', `/quotes/${quoteId}/convert-to-contract`, {});
   steps.push(`Created contract ${made.contractNo} as a draft, with draft invoice ${made.invoiceNo}`);

   let sent = '';
   const wantsWhatsApp = s.sendVia === 'whatsapp';
   const wantsEmail = s.sendVia === 'email';
   if (wantsWhatsApp || wantsEmail) {
      const pdfRes = await fetch(`${base}/contracts/${made.contractId}/pdf`, { headers: { Authorization: authHeader } });
      if (!pdfRes.ok) throw new Error('Could not render the contract PDF');
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const filename = `${made.contractNo}.pdf`;

      if (wantsWhatsApp && whatsappSendConfigured() && await replyWindowOpen(s.phone)) {
         const { id: mediaId } = await uploadWhatsAppMedia({ buffer, mimeType: 'application/pdf', filename });
         const caption = `Hello ${s.customerName}, please find your storage agreement ${made.contractNo}. Thank you, PurpleBox.`;
         const result = await sendWhatsAppMedia({ to: s.phone, mediaId, kind: 'document', caption, filename });
         const phoneNormalized = String(s.phone).replace(/\D/g, '');
         await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '', phone: s.phone, phoneNormalized,
            direction: 'outbound', type: 'document', text: caption, status: 'sent', occurredAt: new Date(), sentByAi: false,
            raw: { document: { id: mediaId, mime_type: 'application/pdf', filename, caption }, sendResult: result },
         });
         await pauseBotForHuman(phoneNormalized);
         sent = `Sent on WhatsApp to ${s.phone}`;
      } else if (s.email && mailConfigured()) {
         await sendMail({
            to: s.email,
            subject: `Storage agreement ${made.contractNo} — PurpleBox`,
            text: `Hello ${s.customerName},\n\nPlease find attached your storage agreement ${made.contractNo}.\n\nThank you,\nPurpleBox`,
            html: `Hello ${s.customerName},<br/><br/>Please find attached your storage agreement ${made.contractNo}.<br/><br/>Thank you,<br/>PurpleBox`,
            attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
         });
         sent = `Sent by email to ${s.email}${wantsWhatsApp ? ' (WhatsApp window was closed)' : ''}`;
      } else {
         sent = wantsWhatsApp
            ? 'Not sent: they have not written on WhatsApp in the last 24 hours and there is no email on record'
            : 'Not sent: no email address on record';
      }
      steps.push(sent);
   }

   return {
      ok: true,
      quoteId: String(quoteId), quoteNo,
      contractId: String(made.contractId), contractNo: made.contractNo, invoiceNo: made.invoiceNo,
      pdfPath: `/contracts/${made.contractId}/pdf`,
      message: steps.join('. ') + '. It is a draft until it is signed.',
   };
}

/** One email per person, the first name filled in. Sent through the same
 *  mail service as everything else, so it lands in the Sent Emails log. */
async function runEmail(proposal) {
   const { recipients, subject, body } = proposal.spec;
   const sent = [];
   const failed = [];
   for (const r of recipients) {
      const first = String(r.name || '').trim().split(/\s+/)[0] || 'there';
      const text = body.replace(/\{\{\s*name\s*\}\}/gi, first);
      try {
         await sendMail({ to: r.email, subject, text, html: text.replace(/\n/g, '<br/>') });
         sent.push(r.name);
      } catch (e) {
         failed.push(`${r.name} (${e.message})`);
      }
   }
   return {
      ok: failed.length === 0,
      message: [
         sent.length ? `Sent to ${sent.join(', ')}` : 'Nothing was sent',
         failed.length ? `Failed: ${failed.join('; ')}` : '',
      ].filter(Boolean).join('. ') + '.',
   };
}
