import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditLog } from '../models/index.js';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* First path segment (a router's mount point in server/src/index.js) → a
 * human entity name. Anything not listed here still gets logged — just
 * title-cased from its own path segment — so a route added later, or one
 * missed here, is never silently left out. */
const ENTITY_LABELS = {
  'customer-auth': 'CustomerAuth', 'customer-portal': 'CustomerPortal',
  'crew-auth': 'CrewAuth', 'crew-portal': 'CrewPortal',
  'unit-types': 'UnitType', 'floor-plan': 'FloorPlan',
  'ai-reports': 'AiReport', 'ai-bot': 'AiBot',
  'moving-inventory': 'MovingItem', 'moving-jobs': 'MovingJob', 'moving-leads': 'MovingLead',
  'moving-quotes': 'MovingQuote', 'moving-invoices': 'MovingInvoice', 'moving-reports': 'MovingReport',
  'moving-surveys': 'MovingSurvey', 'moving-claims': 'MovingClaim',
  'whatsapp-flow-templates': 'WhatsAppFlowTemplate', 'sent-emails': 'SentEmail',
  'site-visits': 'SiteVisit', 'reminder-config': 'ReminderConfig', 'message-templates': 'MessageTemplate',
  'agreement-template': 'AgreementTemplate', 'automation-rules': 'AutomationRule',
  'sales-goals': 'SalesGoal', 'my-day': 'MyDay',
  'lead-follow-up': 'LeadFollowUp', 'follow-up-queue': 'FollowUpQueue',
  'accounts-dashboard': 'AccountsDashboard', 'lead-routing': 'LeadRoutingRule',
  'sign-moving': 'SignMoving', sign: 'Sign', whatsapp: 'WhatsApp',
};

function titleCase(segment) {
  return segment.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function entityLabelFor(firstSegment) {
  return ENTITY_LABELS[firstSegment] || titleCase(firstSegment || 'unknown');
}

/**
 * Pure: given the HTTP method and the request path split into segments
 * (leading "api" already dropped), decide the entity, the id it acted on,
 * and the action. This is deliberately a coarse, best-effort read of the
 * URL, not a per-route configuration — for a path with more than one
 * id-shaped segment (a nested sub-resource, e.g. .../:jobId/visits/:visitId)
 * it reports the LAST one, since that's the resource most specifically
 * being acted on; the entity name still comes from the first segment, so a
 * nested delete reads as e.g. entity "MovingJob", id the visit's own id —
 * imprecise, but `path` (stored alongside) always has the full picture.
 */
export function parseAuditTarget(method, segments) {
  const entity = entityLabelFor(segments[0]);
  const idSegments = segments.filter((s) => OBJECT_ID_RE.test(s));
  const entityId = idSegments[idSegments.length - 1] || '';
  const last = segments[segments.length - 1];
  const lastIsId = last !== undefined && OBJECT_ID_RE.test(last);
  const isCollectionRoot = segments.length <= 1;

  let action;
  if (method === 'DELETE') action = 'deleted';
  else if (method === 'POST') action = (lastIsId || isCollectionRoot) ? 'created' : last;
  else action = (lastIsId || isCollectionRoot) ? 'updated' : `updated (${last})`;

  return { entity, entityId, action };
}

/**
 * Accounts + Admin is watched more closely than anybody else: a deletion or
 * an update by that role records why it was done (the reason typed in the
 * app), what was sent, the record as it stood before, the browser and the IP.
 * This runs ahead of requireAuth, so it reads the token itself.
 */
function watchedActor(req) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return payload?.accountsAdmin === true ? payload : null;
  } catch {
    return null;
  }
}

const SECRET_KEY = /pass|token|secret|hash|otp|pin/i;
const MAX_JSON = 8000;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[hidden]' : redact(v, depth + 1);
  return out;
}

function snapshot(value) {
  if (value === undefined || value === null) return '';
  try {
    const text = JSON.stringify(redact(value));
    return text.length > MAX_JSON ? `${text.slice(0, MAX_JSON)}…[truncated]` : text;
  } catch {
    return '';
  }
}

/** The record about to be changed or deleted, found by the entity name in the URL. */
async function recordBefore(entity, entityId) {
  if (!entityId) return null;
  const names = [entity, entity.replace(/ies$/, 'y'), entity.replace(/es$/, ''), entity.replace(/s$/, '')];
  const name = names.find((n) => mongoose.models[n]);
  if (!name) return null;
  try {
    return await mongoose.models[name].findById(entityId).setOptions({ includeDeleted: true }).lean();
  } catch {
    return null;
  }
}

/** Who made the request, across every auth style this app uses. */
export function actorFrom(req) {
  if (req.user) return { user: req.user.id || null, userName: req.user.name || '', userEmail: req.user.email || '' };
  if (req.customer) return { user: null, userName: req.customer.phone ? `Customer ${req.customer.phone}` : 'Customer', userEmail: '' };
  if (req.crewId) return { user: null, userName: `Crew member ${req.crewId}`, userEmail: '' };
  return { user: null, userName: 'Public', userEmail: '' };
}

/**
 * Mounted once, ahead of every router, in server/src/index.js — sees every
 * mutating request app-wide without any of the ~50 route files needing to
 * change. Only acts after the response is sent (res.on('finish')), so it
 * never adds latency, and only for a request that actually succeeded.
 */
export async function auditLogMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  // Watched accounts: capture the "before" now, while the record still exists.
  const watched = watchedActor(req);
  let beforeText = '';
  if (watched && req.method !== 'POST') {
    try {
      const segs = req.path.split('/').filter(Boolean).filter((x) => x !== 'api');
      if (segs.length) {
        const t = parseAuditTarget(req.method, segs);
        beforeText = snapshot(await recordBefore(t.entity, t.entityId));
      }
    } catch { /* never block the request */ }
  }
  const bodyText = watched ? snapshot(req.body) : '';
  let reason = '';
  if (watched) {
    try { reason = decodeURIComponent(String(req.headers['x-audit-reason'] || '')).slice(0, 500); } catch { reason = ''; }
    if (!reason && req.body && typeof req.body.reason === 'string') reason = req.body.reason.slice(0, 500);
  }

  // Meta calls this every time a message/status update arrives — dozens of
  // times a day, from Meta's own servers, not a person. It's noise that
  // buries the actions a staff member actually took, so it's excluded
  // entirely rather than just filtered out of the report view.
  if ((req.originalUrl || req.path || '').includes('/whatsapp/webhook')) return next();

  // A create's own id never appears in the URL that created it — peek at
  // what the route actually returned instead.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals.auditResponseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      const segments = req.path.split('/').filter(Boolean).filter((s) => s !== 'api');
      if (segments.length === 0) return;

      const { entity, entityId, action } = parseAuditTarget(req.method, segments);
      const actor = actorFrom(req);
      const responseId = res.locals.auditResponseBody?._id ?? res.locals.auditResponseBody?.id;
      const resolvedId = String(entityId || responseId || '');

      AuditLog.create({
        ...actor,
        action,
        entity,
        entityId: resolvedId,
        method: req.method,
        path: req.path,
        ipAddress: req.ip || '',
        ...(watched ? {
          userRole: 'Accounts + Admin',
          userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
          reason,
          changes: bodyText,
          before: beforeText,
        } : {}),
        detail: `${actor.userName || 'Someone'} ${action} ${entity}${resolvedId ? ` ${resolvedId}` : ''}${reason ? ` — ${reason}` : ''}`,
      }).catch((err) => console.error('AuditLog write failed:', err));
    } catch (err) {
      console.error('auditLogMiddleware failed:', err);
    }
  });

  next();
}
