import mongoose from 'mongoose';
import { isRestrictedKey, maskLast4, scrubText } from '../utils/pii.js';
import * as M from '../models/index.js';
import { AgentAction, AgentLeadFile, AgentProfile } from '../agents/models.js';
import { serviceAuthHeader } from './writeTools.js';

/**
 * Direct, READ-ONLY access to the CRM's data for questions the ready-made tools
 * do not cover: query any allowed collection, and read the app's own API.
 *
 * Guard rails, because one leaked connector address would otherwise be a copy
 * of the whole database:
 *  - only listed collections; no users, sign-in tokens, push keys or audit log
 *  - secrets are removed from every result (password, hash, token, secret, key,
 *    raw webhook payloads, binary data)
 *  - filters and aggregations may not run code or write ($where, $function,
 *    $out, $merge, $lookup …) and every query has a time limit and a row cap
 *  - the API passthrough is GET only and refuses sign-in, users, backup,
 *    settings and connector routes
 * Writes still go only through the dedicated tools.
 */

const ALLOWED = {
  leads: M.Lead, customers: M.Customer, contracts: M.Contract, quotes: M.Quote, invoices: M.Invoice, payments: M.Payment,
  units: M.Unit, unit_types: M.UnitType, whatsapp_messages: M.WhatsAppMessage, tasks: M.Task, contract_renewals: M.ContractRenewal,
  lead_follow_ups: M.LeadFollowUp, lead_routing_rules: M.LeadRoutingRule, site_visits: M.SiteVisit, expenses: M.Expense, purchases: M.Purchase,
  vendors: M.Vendor, moving_leads: M.MovingLead, moving_jobs: M.MovingJob, moving_quotes: M.MovingQuote, moving_invoices: M.MovingInvoice,
  campaigns: M.Campaign, campaign_recipients: M.CampaignRecipient, message_templates: M.MessageTemplate, sales_goals: M.SalesGoal,
  sites: M.Site, reminder_logs: M.ReminderLog, automation_logs: M.AutomationLog, conversation_summaries: M.ConversationSummary,
  agent_actions: AgentAction, agent_lead_files: AgentLeadFile, agent_profiles: AgentProfile,
};

const SECRET_KEY = /pass(word)?|hash|token|secret|api_?key|signingtoken|^raw$|^data$|credential|authorization|^keys?$|endpoint$|otp|code_?hash/i;
const FORBIDDEN_OPS = new Set(['$where', '$function', '$accumulator', '$out', '$merge', '$lookup', '$graphLookup', '$unionWith', '$currentOp', '$listSessions', '$indexStats', '$collStats', '$planCacheStats', '$changeStream', '$search', '$searchMeta', '$set_']);
const STAGES = new Set(['$match', '$group', '$sort', '$limit', '$skip', '$project', '$unwind', '$count', '$addFields', '$set', '$unset', '$sortByCount', '$sample', '$replaceRoot', '$facet']);
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const MAX_ROWS = 200;
const MAX_CHARS = 110_000;

function guard(node, path = '') {
  if (Array.isArray(node)) return node.forEach((x) => guard(x, path));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_OPS.has(k)) throw new Error(`${k} is not allowed`);
      if (k.startsWith('$') && k.length > 40) throw new Error('Bad operator');
      guard(v, `${path}.${k}`);
    }
  }
}

/** Dates arrive as strings; turn ISO strings into real dates so comparisons work. */
function revive(node) {
  if (typeof node === 'string' && ISO.test(node)) {
    // A plain day means that day in Dubai time (start of day); full timestamps are used as given.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(node) ? new Date(`${node}T00:00:00+04:00`) : new Date(node);
    return Number.isNaN(d.getTime()) ? node : d;
  }
  if (Array.isArray(node)) return node.map(revive);
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, revive(v)]));
  return node;
}

function clean(value, depth = 0) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Buffer.isBuffer(value) || value?._bsontype === 'Binary') return '[binary removed]';
  if (Array.isArray(value)) return value.slice(0, 60).map((x) => clean(x, depth + 1));
  if (typeof value === 'object') {
    if (depth > 6) return '[nested]';
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      // Identity numbers: last four only (WP-07).
      out[k] = isRestrictedKey(k) && v != null && typeof v !== 'object' ? maskLast4(v) : clean(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return scrubText(value.length > 600 ? `${value.slice(0, 600)}…` : value);
  return value;
}

const model = (name) => { const m = ALLOWED[String(name || '')]; if (!m) throw new Error(`Unknown collection "${name}". Use describe_data to list them.`); return m; };
const fieldList = (m) => Object.keys(m.schema.paths).filter((p) => !SECRET_KEY.test(p) && !p.startsWith('__') && p !== '_id');
const pack = (obj) => { const t = JSON.stringify(obj, null, 1); return t.length > MAX_CHARS ? { truncated: true, note: 'Result too large; narrow the filter, add fields, or lower the limit.', preview: t.slice(0, MAX_CHARS) } : obj; };

export async function describeData({ collection } = {}) {
  if (!collection) return { collections: Object.entries(ALLOWED).map(([name, m]) => ({ name, fieldCount: fieldList(m).length })), note: 'Pass a collection to see its fields. Dates are filtered as "YYYY-MM-DD" (Dubai day) or full ISO strings. Phone numbers are matched by their last 9 digits (e.g. {"phoneNormalized": {"$regex": "501234567$"}}).' };
  const m = model(collection);
  const sample = await m.findOne({}).sort({ _id: -1 }).lean();
  return { collection, fields: fieldList(m), softDeleted: Boolean(m.schema.paths.deletedAt), sample: clean(sample || {}) };
}

export async function queryData({ collection, filter = {}, fields, sort, limit = 50, count = false, pipeline } = {}) {
  const m = model(collection);
  const cap = Math.min(MAX_ROWS, Math.max(1, Number(limit) || 50));
  if (pipeline) {
    if (!Array.isArray(pipeline) || pipeline.length > 12) throw new Error('pipeline must be a list of at most 12 stages');
    for (const st of pipeline) { const k = Object.keys(st)[0]; if (!STAGES.has(k)) throw new Error(`Stage ${k} is not allowed`); }
    guard(pipeline);
    const stages = revive(pipeline);
    if (m.schema.paths.deletedAt) stages.unshift({ $match: { deletedAt: null } });
    const rows = await m.aggregate([...stages, { $limit: cap }]).option({ maxTimeMS: 15000 });
    return pack({ collection, rows: clean(rows), returned: rows.length });
  }
  guard(filter);
  const q = revive(filter || {});
  if (m.schema.paths.deletedAt && !('deletedAt' in q)) q.deletedAt = null;
  if (count) return { collection, count: await m.countDocuments(q).maxTimeMS(15000) };
  const allowedFields = new Set(fieldList(m));
  const proj = Array.isArray(fields) && fields.length ? Object.fromEntries(fields.filter((f) => allowedFields.has(String(f).split('.')[0]) || f === '_id').map((f) => [f, 1])) : null;
  let cur = m.find(q);
  if (proj && Object.keys(proj).length) cur = cur.select(proj);
  else cur = cur.select(Object.fromEntries([...allowedFields].slice(0, 60).map((f) => [f, 1])));
  if (sort && typeof sort === 'object') { guard(sort); cur = cur.sort(sort); } else cur = cur.sort({ _id: -1 });
  const rows = await cur.limit(cap).maxTimeMS(15000).lean();
  const total = rows.length === cap ? await m.countDocuments(q).maxTimeMS(15000) : rows.length;
  return pack({ collection, matched: total, returned: rows.length, rows: clean(rows) });
}

const API_DENY = /^\/(auth|users|backup|integrations|push|mcp|mcp-oauth|mcp-export|settings|assistant\/config|uploads|public|customer|crew|webhook|whatsapp\/webhook|ai-bot\/config)(\/|$|\?)/i;
export async function apiGet({ path }) {
  const p = String(path || '').trim();
  if (!p.startsWith('/') || p.includes('..') || /^\/\//.test(p)) throw new Error('path must start with / and be an API path, e.g. /leads?status=new');
  if (API_DENY.test(p.replace(/^\/api/, ''))) throw new Error('That part of the API is not available through the connector');
  const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
  const r = await fetch(`${base}${p.replace(/^\/api/, '')}`, { method: 'GET', headers: { Authorization: await serviceAuthHeader() } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { text: text.slice(0, 2000) }; }
  if (!r.ok) throw new Error(json.error || `GET ${p} failed (${r.status})`);
  const cleaned = clean(Array.isArray(json) ? json.slice(0, MAX_ROWS) : json);
  return pack({ path: p, status: r.status, truncatedToRows: Array.isArray(json) && json.length > MAX_ROWS ? MAX_ROWS : undefined, data: cleaned });
}

export function connectorStatus(toolNames, started) {
  return { server: 'purplebox-crm', build: (process.env.COMMIT_REF || process.env.GIT_SHA || 'unknown').slice(0, 7), startedAt: started, toolCount: toolNames.length, tools: toolNames, note: 'If a tool you expect is missing here, the server has not deployed it yet. If it is listed here but Claude does not show it, reconnect the connector in Claude to refresh its tool list.' };
}
