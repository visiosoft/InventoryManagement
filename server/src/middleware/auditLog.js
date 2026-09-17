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
  'sales-goals': 'SalesGoal', 'sales-team': 'SalesTeam', 'my-day': 'MyDay',
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
export function auditLogMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

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
        detail: `${actor.userName || 'Someone'} ${action} ${entity}${resolvedId ? ` ${resolvedId}` : ''}`,
      }).catch((err) => console.error('AuditLog write failed:', err));
    } catch (err) {
      console.error('auditLogMiddleware failed:', err);
    }
  });

  next();
}
