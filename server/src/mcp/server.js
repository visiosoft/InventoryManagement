import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { validAccessToken, baseUrl } from './oauth.js';
import { toolByName, toolNames } from '../services/assistant/tools.js';
import { responseTimeReport, slowFirstReplies, customersWaitingForReply, followUpList, FOLLOW_UP_LISTS, listInvoices, pendingPayments, paymentsReceived, listQuotes, contractDetail } from './crmTools.js';
import { signedExportUrl } from './focusExport.js';
import { describeData, queryData, apiGet, connectorStatus } from './dataTools.js';
import { leadFollowUpFile, followUpBriefing, followUpAdherence } from './followUps.js';
import { zohoOutstanding, zohoCustomerLedger, zohoExpenses } from './zohoTools.js';
import { whatsappReplyTimeReport, whatsappVolumeReport, whatsappTopicsReport, whatsappInboundSample } from './whatsappAnalysis.js';
import { dataHealth } from './analytics.js';
import { occupancyAndRevenueTrend, conversionReport, forecast, cashForecast, businessSnapshot } from './analytics.js';
import { takeProposal } from '../services/assistant/actions.js';
import { runAction } from '../services/assistant/actions.js';
import { serviceAuthHeader, createInvoice, recordInvoicePayment, recordScheduledPayment, sendInvoice, listMessageTemplates, sendContractWhatsApp, markPaymentVerified, extendContract, updateLeadStatus } from './writeTools.js';

/**
 * PurpleBox CRM as an MCP server, so Claude can answer questions about the
 * sales team and the money straight from the live system.
 *
 * Lookups plus actions. The actions (quotes, contracts, invoices, payments,
 * messages, lead stages) all go through the app's own API as "Claude (MCP)".
 * Quotation / contract / email are two steps: prepare, then confirm_action.
 * Set MCP_READ_ONLY=1 to switch every action off.
 */

const OBJ = (properties = {}, required = []) => ({ type: 'object', properties, required });
const days = { type: 'number', description: 'How many days back (default 30)' };
const limit = { type: 'number', description: 'Maximum rows (default 50)' };

const NEW_TOOLS = [
  { name: 'response_time_report', description: 'How fast the sales team answers new leads: team and per-rep average, median, share answered within 5 minutes / 1 hour, share over 24 hours, and how many leads were never answered.', inputSchema: OBJ({ days }), run: (a) => responseTimeReport(a) },
  { name: 'slow_first_replies', description: 'The leads that waited longest for a first reply (the mistakes): name, phone, rep, how long they waited, and whether they are still unanswered.', inputSchema: OBJ({ days, overMinutes: { type: 'number', description: 'Only waits longer than this (default 60)' }, limit }), run: (a) => slowFirstReplies(a) },
  { name: 'customers_waiting_for_reply', description: 'WhatsApp conversations where the customer wrote last and nobody has replied yet, longest wait first.', inputSchema: OBJ({ minHours: { type: 'number', description: 'Waiting at least this many hours (default 2)' }, limit }), run: (a) => customersWaitingForReply(a) },
  { name: 'people_to_follow_up', description: `Phone numbers the sales team should focus on, by list. Lists: ${Object.entries(FOLLOW_UP_LISTS).map(([k, v]) => `${k} (${v})`).join('; ')}.`, inputSchema: OBJ({ list: { type: 'string', enum: Object.keys(FOLLOW_UP_LISTS) }, limit }, ['list']), run: (a) => followUpList(a) },
  { name: 'export_focus_workbook', description: 'A link to an Excel workbook with one tab per focus list (visit booked, invited not confirmed, quoted with no decision, overdue follow-ups, waiting for a reply, …) plus response-time and slow-reply tabs. The link works for 30 minutes.', inputSchema: OBJ({ days }), run: async (a, ctx) => { const url = signedExportUrl(ctx.baseUrl, { days: a.days || 30 }); return url ? { downloadUrl: url, expiresInMinutes: 30 } : { error: 'Exports are not available' }; } },
  { name: 'business_snapshot', description: 'The whole picture in one call: occupancy, revenue per 4 weeks, money owed (overdue and upcoming), last-30-day sales (leads, wins, win rate, response time), the next four weeks projected, and the last three months.', inputSchema: OBJ(), run: () => businessSnapshot() },
  { name: 'occupancy_revenue_trend', description: 'Month by month for the past N months (default 12): occupied units, occupancy %, and payments collected. Use it to show a trend.', inputSchema: OBJ({ months: { type: 'number' } }), run: (a) => occupancyAndRevenueTrend(a) },
  { name: 'conversion_report', description: 'Lead conversion over the last N days (default 90): overall, by source (Meta ads, WhatsApp, website, …) and by rep, win rate, still open, and why leads were lost.', inputSchema: OBJ({ days }), run: (a) => conversionReport(a) },
  { name: 'forecast', description: 'Projection of occupied units, occupancy % and revenue per 4 weeks, week by week for the next N weeks (default 12), as low / base / high. Uses what tenants said about renewing, the real renewal rate, and the recent pace of new tenants; returns its assumptions and the quoted-pipeline upside. A projection, not a promise.', inputSchema: OBJ({ weeks: { type: 'number' }, renewalRatePct: { type: 'number', description: 'Replace the history-based renewal rate for undecided tenants, 0–100' }, newTenantsPerWeek: { type: 'number', description: 'Replace the recent pace of new tenants' } }), run: (a) => forecast(a) },
  { name: 'cash_forecast', description: 'Money expected in over the next N weeks (default 8): scheduled payments by due week, what is already overdue, and how many contracts end in the window.', inputSchema: OBJ({ weeks: { type: 'number' } }), run: (a) => cashForecast(a) },
  { name: 'whatsapp_reply_time_report', description: 'WhatsApp reply times measured from the real messages: from a customer writing to our next reply, over the last N days. Team average, median, % within 5 minutes / 1 hour, over 24 hours; split by replied-by-a-person vs AI, by customer writing inside or outside working hours (Mon–Sat 09:00–19:00 Dubai), per rep (the lead\'s owner), and conversations still unanswered.', inputSchema: OBJ({ days }), run: (a) => whatsappReplyTimeReport(a) },
  { name: 'whatsapp_volume_report', description: 'WhatsApp traffic over the last N days: conversations, messages each way, how many were sent by the AI, new conversations and how many were never replied to, busiest hours (Dubai time), messages by weekday, and per-day counts.', inputSchema: OBJ({ days }), run: (a) => whatsappVolumeReport(a) },
  { name: 'whatsapp_topics_report', description: 'What customers write about on WhatsApp: share of customers who mentioned price, availability/size, visiting, duration, payment, access/security, moving, or cancelling (keyword-based, English and some Arabic).', inputSchema: OBJ({ days }), run: (a) => whatsappTopicsReport(a) },
  { name: 'whatsapp_inbound_sample', description: 'Recent customer WhatsApp messages (text only, no names or numbers), optionally containing a keyword, so you can read the actual wording and find themes, objections and common questions.', inputSchema: OBJ({ days, keyword: { type: 'string' }, limit }), run: (a) => whatsappInboundSample(a) },
  { name: 'zoho_outstanding', description: 'Who owes money according to Zoho Books: customers with an outstanding balance, biggest first, with the total. Read from the Zoho connection the CRM already has.', inputSchema: OBJ({ limit }), run: (a) => zohoOutstanding(a) },
  { name: 'zoho_customer_ledger', description: 'One customer\'s invoices and payments in Zoho Books (found by name or phone, matched to Zoho by email or phone), with the balance owing.', inputSchema: OBJ({ query: { type: 'string', description: 'Customer name or phone number' } }, ['query']), run: (a) => zohoCustomerLedger(a) },
  { name: 'zoho_expenses', description: 'Expenses recorded in Zoho Books for a period, with the total and a breakdown by category. Combine with payments received to see the margin.', inputSchema: OBJ({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => zohoExpenses(a) },
  { name: 'lead_followup_file', description: 'Everything about ONE lead\'s follow-up, with the conversation: status, owner, follow-up date and whether it is overdue, what the rep did (attempts), the timeline, tasks, AI proposals waiting for approval, the recent WhatsApp messages (customer vs us), and whose turn it is. Use it to answer "what happened with X?", "was the follow-up done?", "what should we say to X?".', inputSchema: OBJ({ phone: { type: 'string' }, leadId: { type: 'string' }, messages: { type: 'number', description: 'How many recent messages (default 20)' } }), run: (a) => leadFollowUpFile(a) },
  { name: 'followup_briefing', description: `A batch of leads that need following up, EACH WITH ITS LATEST WHATSAPP MESSAGES, so you can read the conversations and judge what to say and how urgent it is. Choose a list (${Object.keys(FOLLOW_UP_LISTS).join(', ')}), optionally one rep.`, inputSchema: OBJ({ list: { type: 'string', enum: Object.keys(FOLLOW_UP_LISTS) }, rep: { type: 'string', description: 'Part of a rep name' }, limit: { type: 'number', description: 'Leads to include, max 25 (default 12)' }, messagesPer: { type: 'number' } }), run: (a) => followUpBriefing(a) },
  { name: 'followup_adherence', description: 'Were follow-ups done? For follow-ups that fell due in the last N days: per rep how many were done on time, late, or missed, and the list of missed ones.', inputSchema: OBJ({ days }), run: (a) => followUpAdherence(a) },
  { name: 'describe_data', description: 'List the collections you can query directly (leads, customers, contracts, invoices, payments, quotes, units, whatsapp_messages, tasks, …), or pass a collection to see its fields and a sample record. Use this before query_data when a ready-made tool does not answer the question.', inputSchema: OBJ({ collection: { type: 'string' } }), run: (a) => describeData(a) },
  { name: 'query_data', description: 'Read-only query of any allowed collection (see describe_data). Give a MongoDB-style filter, optional fields, sort and limit (max 200), or count:true, or an aggregation pipeline (stages: $match, $group, $sort, $limit, $project, $unwind, $addFields, …; no $lookup). Dates in filters can be "YYYY-MM-DD" (a Dubai day) or ISO strings. Secrets are removed from results. Prefer the ready-made tools when one fits.', inputSchema: OBJ({ collection: { type: 'string' }, filter: { type: 'object' }, fields: { type: 'array', items: { type: 'string' } }, sort: { type: 'object' }, limit: { type: 'number' }, count: { type: 'boolean' }, pipeline: { type: 'array', items: { type: 'object' } } }, ['collection']), run: (a) => queryData(a) },
  { name: 'api_get', description: 'Read-only GET of the CRM\'s own API (the same data the app screens use), e.g. /leads?status=new, /contracts/expiring-soon?days=14, /reports/summary. Sign-in, users, backup, settings and connector routes are refused. Responses are capped and secrets removed.', inputSchema: OBJ({ path: { type: 'string', description: 'API path starting with /, e.g. /contracts/renewal-requests' } }, ['path']), run: (a) => apiGet(a) },
  { name: 'connector_status', description: 'What this connector is running: build, start time, and the full list of tools. Use it to check whether a tool exists.', inputSchema: OBJ(), run: () => connectorStatus(allTools().map((t) => t.name), STARTED) },
  { name: 'list_invoices', description: 'Invoices, newest first. Filter by status (draft, sent, paid, partial, overdue, cancelled), customer name, date range, or overdueOnly.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, overdueOnly: { type: 'boolean' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => listInvoices(a) },
  { name: 'pending_payments', description: 'Payments still due from tenants, oldest first, with the total owed and days overdue.', inputSchema: OBJ({ overdueOnly: { type: 'boolean' }, limit }), run: (a) => pendingPayments(a) },
  { name: 'payments_received', description: 'Payments received in a period (default last 30 days) with the total.', inputSchema: OBJ({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => paymentsReceived(a) },
  { name: 'list_quotes', description: 'Quotations, newest first. Filter by status (draft, sent, accepted, rejected, expired) or customer name.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, limit }), run: (a) => listQuotes(a) },
  { name: 'contract_detail', description: 'One contract by number (e.g. PB-2026-0116): tenant, unit, dates, rate, renewal intent, whether payment is verified, and its invoices and payments.', inputSchema: OBJ({ contractNo: { type: 'string' } }, ['contractNo']), run: (a) => contractDetail(a) },
];

const STARTED = new Date().toISOString();
const MONEY_TOOLS = /^(business_snapshot|occupancy_revenue_trend|pending_payments|cash_forecast|forecast|payments_received|list_invoices|zoho_outstanding|crm_report_revenue_collected|crm_report_revenue_outstanding)$/;
const INSTRUCTIONS = [
  'You are reading the live PurpleBox Storage CRM (Dubai). Accuracy matters more than a complete-looking answer.',
  '1. Every number, name and date you state must come from a tool result in this conversation. Never estimate, round up or fill gaps from memory. If the tools do not give it, say so.',
  '2. Name the tool and the period behind each figure. If a result has dataWarnings, truncated, "not reviewed" or a note field, tell the user what it says before giving conclusions that depend on it.',
  '3. An empty or zero result is not proof that nothing happened: check the warnings, and cross-check a second tool (for example WhatsApp activity against lead reports) before saying "no activity".',
  '4. Do not infer who someone is or what they did from a name. A contact\'s role is known only if a tool states it.',
  '5. Judgements about customers (hot, lost, interested, agreed to visit) need the customer\'s latest messages read first, through the lead and WhatsApp tools. The latest message wins; "all good for now", "not interested" or "found another place" ends a follow-up. If you did not read the messages, label the list as unreviewed.',
  '6. Dates are Dubai time. A single day means that whole day.',
  '7. Anything that creates, sends or changes something: state exactly what will happen and wait for the user to agree. Quotes, contracts and emails are prepared first, then confirmed.',
  '8. Prefer the ready-made tools over query_data; use query_data when none fits, and say which fields you filtered on.',
].join('\n');
const DO = ' This takes effect immediately.';
const WRITE_TOOLS = [
  { name: 'confirm_action', description: 'Carry out a prepared action. crm_propose_quotation, crm_propose_contract and crm_propose_email only PREPARE something and return a proposalId and a summary. Show the person that summary, and call this with the proposalId only after they agree. It then creates the quotation / contract (with its first draft invoice) / sends the email through the CRM.', inputSchema: OBJ({ proposalId: { type: 'string' } }, ['proposalId']), run: async (a) => { const p = takeProposal(a.proposalId, 'mcp'); if (!p) return { error: 'That proposal does not exist or has expired (they last 15 minutes). Prepare it again.' }; return runAction(p, { authHeader: await serviceAuthHeader() }); } },
  { name: 'create_invoice', description: 'Create an invoice against a contract (a one-off charge, extra period, deposit…). Give the contract number, a description, quantity and rate (AED), and the due date.' + DO, inputSchema: OBJ({ contractNo: { type: 'string' }, description: { type: 'string' }, quantity: { type: 'number' }, rate: { type: 'number' }, dueDate: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' } }, ['contractNo', 'description', 'rate', 'dueDate']), run: (a) => createInvoice(a) },
  { name: 'record_invoice_payment', description: 'Record a payment received against an invoice (it updates the invoice status and the contract).' + DO, inputSchema: OBJ({ invoiceNo: { type: 'string' }, amount: { type: 'number' }, method: { type: 'string', enum: ['cash', 'bank_transfer', 'card', 'other'] }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, notes: { type: 'string' } }, ['invoiceNo', 'amount']), run: (a) => recordInvoicePayment(a) },
  { name: 'record_scheduled_payment', description: 'Mark one of the scheduled payments from pending_payments as received, using its paymentId.' + DO, inputSchema: OBJ({ paymentId: { type: 'string' }, method: { type: 'string', enum: ['cash', 'bank_transfer', 'card', 'other'] }, paidDate: { type: 'string' }, amount: { type: 'number' }, notes: { type: 'string' } }, ['paymentId']), run: (a) => recordScheduledPayment(a) },
  { name: 'send_invoice', description: 'Send an invoice to the tenant by WhatsApp or email.' + DO, inputSchema: OBJ({ invoiceNo: { type: 'string' }, via: { type: 'string', enum: ['whatsapp', 'email'] } }, ['invoiceNo']), run: (a) => sendInvoice(a) },
  { name: 'list_message_templates', description: 'The saved message templates and which of them have an approved WhatsApp template.', inputSchema: OBJ(), run: () => listMessageTemplates() },
  { name: 'send_contract_whatsapp', description: 'Send an approved WhatsApp template (by its label) to the tenant of a contract, filled from the contract (name, unit, dates, renewal and move-out links).' + DO, inputSchema: OBJ({ contractNo: { type: 'string' }, templateLabel: { type: 'string' } }, ['contractNo', 'templateLabel']), run: (a) => sendContractWhatsApp(a) },
  { name: 'mark_payment_verified', description: 'For a newly signed contract: mark the first payment as verified (or not) by hand, which lets its unit turn Occupied.' + DO, inputSchema: OBJ({ contractNo: { type: 'string' }, verified: { type: 'boolean' }, note: { type: 'string' } }, ['contractNo']), run: (a) => markPaymentVerified(a) },
  { name: 'extend_contract', description: 'Extend an active contract to a new check-out date, optionally creating a re-sign link for the customer.' + DO, inputSchema: OBJ({ contractNo: { type: 'string' }, newEndDate: { type: 'string', description: 'YYYY-MM-DD' }, allowReSign: { type: 'boolean' } }, ['contractNo', 'newEndDate']), run: (a) => extendContract(a) },
  { name: 'update_lead_status', description: 'Move a lead to a stage (new, contact_attempted, contacted, site_visit_scheduled, follow_up_scheduled, quotation_sent, won, lost, already_customer). Moving to lost needs lostReason (price, timing, wrong_size, went_elsewhere, no_response, not_interested, wrong_number, other).' + DO, inputSchema: OBJ({ phone: { type: 'string' }, leadId: { type: 'string' }, status: { type: 'string' }, lostReason: { type: 'string' }, comment: { type: 'string' } }, ['status']), run: (a) => updateLeadStatus(a) },
];

// The assistant's own tools: the lookups as they are, plus the three that PREPARE
// an action and the two quick lead actions. compose_* just draft text, so skipped.
const REUSED = () => toolNames().filter((n) => !/^compose_/.test(n));

function allTools() {
  const reused = REUSED().map((n) => { const t = toolByName(n); return { name: `crm_${n}`, description: t.description, inputSchema: t.parameters || OBJ(), run: async (a, ctx) => t.run(a, { scope: null, user: ctx.user, now: new Date(), authHeader: await serviceAuthHeader() }) }; });
  // MCP_READ_ONLY=1 switches every action off and leaves only the lookups.
  if (process.env.MCP_READ_ONLY === '1') return [...NEW_TOOLS, ...reused.filter((t) => !/^crm_(create_|schedule_|propose_)/.test(t.name))];
  return [...NEW_TOOLS, ...WRITE_TOOLS, ...reused];
}

export function buildMcpServer(ctx) {
  const server = new Server({ name: 'purplebox-crm', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const tools = allTools();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = tools.find((x) => x.name === req.params.name);
    if (!t) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }] };
    try {
      let out = await t.run(req.params.arguments || {}, ctx);
      // Money figures carry the warnings a reader needs before trusting them.
      if (out && typeof out === 'object' && !Array.isArray(out) && MONEY_TOOLS.test(t.name)) out = { ...out, dataWarnings: await dataHealth().catch(() => []) };
      if (out && typeof out === 'object' && !Array.isArray(out)) out = { ...out, _source: t.name, _asOf: new Date().toISOString() };
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1).slice(0, 120_000) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Could not run ${t.name}: ${e.message}` }] };
    }
  });
  return server;
}

const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Express handler. Auth: Bearer token, x-api-key header, or the token as the last path segment. */
export async function mcpHandler(req, res) {
  const need = process.env.MCP_ACCESS_TOKEN;
  if (!need) return res.status(503).json({ error: 'MCP access is not switched on' });
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = bearer || req.headers['x-api-key'] || req.params.token || '';
  if (!given || !(safeEq(given, need) || validAccessToken(given))) {
    // Tells a connector where to sign in (OAuth discovery).
    res.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null });
  const server = buildMcpServer({ baseUrl: baseUrl(req), user: { id: 'mcp', name: 'Claude (MCP)', role: 'admin' } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
