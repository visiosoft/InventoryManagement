import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { toolByName, toolNames } from '../services/assistant/tools.js';
import { responseTimeReport, slowFirstReplies, customersWaitingForReply, followUpList, FOLLOW_UP_LISTS, listInvoices, pendingPayments, paymentsReceived, listQuotes, contractDetail } from './crmTools.js';
import { signedExportUrl } from './focusExport.js';

/**
 * PurpleBox CRM as an MCP server, so Claude can answer questions about the
 * sales team and the money straight from the live system.
 *
 * READ-ONLY. Nothing here creates, edits, sends or deletes anything. The
 * assistant's existing lookup tools are reused as they are (units, pricing,
 * customers, contracts, expiring contracts, tasks, WhatsApp activity, the report
 * blocks); the two that draft messages are left out.
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
  { name: 'list_invoices', description: 'Invoices, newest first. Filter by status (draft, sent, paid, partial, overdue, cancelled), customer name, date range, or overdueOnly.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, overdueOnly: { type: 'boolean' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => listInvoices(a) },
  { name: 'pending_payments', description: 'Payments still due from tenants, oldest first, with the total owed and days overdue.', inputSchema: OBJ({ overdueOnly: { type: 'boolean' }, limit }), run: (a) => pendingPayments(a) },
  { name: 'payments_received', description: 'Payments received in a period (default last 30 days) with the total.', inputSchema: OBJ({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit }), run: (a) => paymentsReceived(a) },
  { name: 'list_quotes', description: 'Quotations, newest first. Filter by status (draft, sent, accepted, rejected, expired) or customer name.', inputSchema: OBJ({ status: { type: 'string' }, customer: { type: 'string' }, limit }), run: (a) => listQuotes(a) },
  { name: 'contract_detail', description: 'One contract by number (e.g. PB-2026-0116): tenant, unit, dates, rate, renewal intent, whether payment is verified, and its invoices and payments.', inputSchema: OBJ({ contractNo: { type: 'string' } }, ['contractNo']), run: (a) => contractDetail(a) },
];

// The assistant's own read tools, except the ones that write a message.
const REUSED = () => toolNames().filter((n) => !/^compose_|^propose_|^send_|^create_|^update_/.test(n));

function allTools() {
  const reused = REUSED().map((n) => { const t = toolByName(n); return { name: `crm_${n}`, description: t.description, inputSchema: t.parameters || OBJ(), run: (a, ctx) => t.run(a, { scope: null, user: ctx.user, now: new Date() }) }; });
  return [...NEW_TOOLS, ...reused];
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
  const server = buildMcpServer({ baseUrl: process.env.PUBLIC_API_URL || `${proto}://${host}`, user: { name: 'Claude (MCP)', role: 'admin' } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
