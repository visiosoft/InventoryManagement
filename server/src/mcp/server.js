import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { toolByName, toolNames } from '../services/assistant/tools.js';
import { responseTimeReport, slowFirstReplies, customersWaitingForReply, followUpList, FOLLOW_UP_LISTS, listInvoices, pendingPayments, paymentsReceived, listQuotes, contractDetail } from './crmTools.js';
import { signedExportUrl } from './focusExport.js';
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
  { name: 'forecast', description: 'Projection of occupied units, occupancy % and revenue per 4 weeks, week by week for the next N weeks (default 12), as low / base / high. Uses what tenants said about renewing, the real renewal rate, and the recent pace of new tenants; returns its assumptions and the quoted-pipeline upside. A projection, not a promise.', inputSchema: OBJ({ weeks: { type: 'number' } }), run: (a) => forecast(a) },
  { name: 'cash_forecast', description: 'Money expected in over the next N weeks (default 8): scheduled payments by due week, what is already overdue, and how many contracts end in the window.', inputSchema: OBJ({ weeks: { type: 'number' } }), run: (a) => cashForecast(a) },
  { name: 'list_invoices', description: 'Invoices, newest first. Filter by status (draft, sent, paid, partial, overdue, cancelled), customer name, date range, or overdueOnly.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, overdueOnly: { type: 'boolean' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => listInvoices(a) },
  { name: 'pending_payments', description: 'Payments still due from tenants, oldest first, with the total owed and days overdue.', inputSchema: OBJ({ overdueOnly: { type: 'boolean' }, limit }), run: (a) => pendingPayments(a) },
  { name: 'payments_received', description: 'Payments received in a period (default last 30 days) with the total.', inputSchema: OBJ({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => paymentsReceived(a) },
  { name: 'list_quotes', description: 'Quotations, newest first. Filter by status (draft, sent, accepted, rejected, expired) or customer name.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, limit }), run: (a) => listQuotes(a) },
  { name: 'contract_detail', description: 'One contract by number (e.g. PB-2026-0116): tenant, unit, dates, rate, renewal intent, whether payment is verified, and its invoices and payments.', inputSchema: OBJ({ contractNo: { type: 'string' } }, ['contractNo']), run: (a) => contractDetail(a) },
];

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
  const server = new Server({ name: 'purplebox-crm', version: '1.0.0' }, { capabilities: { tools: {} } });
  const tools = allTools();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = tools.find((x) => x.name === req.params.name);
    if (!t) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }] };
    try {
      const out = await t.run(req.params.arguments || {}, ctx);
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
  if (!given || !safeEq(given, need)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null });
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const server = buildMcpServer({ baseUrl: process.env.PUBLIC_API_URL || `${proto}://${host}`, user: { id: 'mcp', name: 'Claude (MCP)', role: 'admin' } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
