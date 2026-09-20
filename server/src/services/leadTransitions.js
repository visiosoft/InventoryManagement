export const LOSS_REASONS = ['price', 'timing', 'competitor', 'no_response', 'not_a_fit', 'other'];
export const CLOSED_LEAD_STATUSES = ['won', 'lost', 'already_customer'];

export function transitionError(lead, status, body = {}, now = new Date()) {
  if (status === 'lost' && !LOSS_REASONS.includes(body.lossReason)) return 'Choose a loss reason';
  if (body.reopenAt) {
    const revisit = new Date(body.reopenAt).getTime();
    const unchanged = lead.reopenAt && revisit === new Date(lead.reopenAt).getTime();
    if (!Number.isFinite(revisit) || (!unchanged && revisit <= now.getTime())) return 'Revisit date must be in the future';
  }
  if (status === 'follow_up_scheduled' || status === 'site_visit_scheduled') {
    const key = status === 'follow_up_scheduled' ? 'followUpAt' : 'siteVisitAt';
    const at = body[key] ?? lead[key];
    if (!lead.owner) return 'Assign an owner before scheduling this lead';
    if (!at || !Number.isFinite(new Date(at).getTime()) || new Date(at) <= now) return 'Choose a future date and time for this action';
  }
  return null;
}

/** A move is an administrative event, never proof of customer contact. */
export function recordLeadTransition(lead, status, user, comment = '', at = new Date()) {
  if (lead.status === status) return false;
  const fromStatus = lead.status;
  lead.status = status;
  lead.timeline ||= [];
  lead.timeline.push({ type: 'status_changed', fromStatus, toStatus: status, at, user,
    text: `Status changed from ${fromStatus} to ${status}${comment ? ` — ${String(comment).slice(0, 2000)}` : ''}` });
  return true;
}

export function applyTransitionDetails(lead, status, body) {
  if (status === 'lost') {
    lead.lossReason = body.lossReason;
    lead.lossCompetitor = String(body.lossCompetitor || '').trim().slice(0, 200);
    lead.reopenAt = body.reopenAt ? new Date(body.reopenAt) : null;
  } else if (!CLOSED_LEAD_STATUSES.includes(status)) {
    // The previous loss remains on the timeline, not on the reopened deal.
    lead.lossReason = '';
    lead.lossCompetitor = '';
    lead.reopenAt = null;
  }
  if (status === 'follow_up_scheduled' && body.followUpAt) {
    lead.followUpAt = new Date(body.followUpAt);
    lead.followUpKind = 'date';
    lead.followUpNote = String(body.followUpNote || '').slice(0, 500);
    lead.followUpNotifiedAt = null;
    lead.followUpPushedAt = null;
  }
  if (status === 'site_visit_scheduled' && body.siteVisitAt) lead.siteVisitAt = new Date(body.siteVisitAt);
}
