import type { FollowUpPriority, FollowUpQueueItem, FollowUpReason } from './api'

/* Shared look-ups for the Follow-Ups page, drawer and bulk review, so the
   three never disagree about what a reason or a priority looks like. The
   reason colours are deliberately far apart: red is "we owe them a reply",
   purple is "they went quiet on us" — different failures, never one style. */

export const INK = '#14081F'
export const MUTED = '#756E80'
export const PURPLE = '#5B2BC9'
export const PURPLE_DEEP = '#4A1FA0'
export const PURPLE_TINT = '#F7F3FF'
export const HAIRLINE = 'rgba(20,8,31,.10)'
export const CREAM = '#FBF8F2'
export const DISPLAY = "'Bricolage Grotesque', 'Plus Jakarta Sans', system-ui, sans-serif"

export const REASON_UI: Record<FollowUpReason, { label: string; bg: string; fg: string; blurb: string }> = {
  sales_response_overdue: { label: 'Needs reply', bg: '#FEE2E2', fg: '#B91C1C', blurb: 'Customer wrote — we haven’t replied' },
  customer_quiet: { label: 'Went quiet', bg: '#EDE5FF', fg: PURPLE_DEEP, blurb: 'We spoke last — they’ve gone quiet' },
  manual_followup_due: { label: 'Follow-up due', bg: '#FEF3C7', fg: '#92400E', blurb: 'A follow-up you scheduled has arrived' },
}

export const PRIORITY_UI: Record<FollowUpPriority, { label: string; bg: string; fg: string }> = {
  high: { label: 'HIGH', bg: '#FEE2E2', fg: '#B91C1C' },
  medium: { label: 'MEDIUM', bg: '#FEF3C7', fg: '#92400E' },
  low: { label: 'LOW', bg: '#ECFDF5', fg: '#047857' },
}

export const TEMP_UI: Record<'hot' | 'warm' | 'cold', { bg: string; fg: string }> = {
  hot: { bg: '#FEE2E2', fg: '#B91C1C' },
  warm: { bg: '#FEF3C7', fg: '#92400E' },
  cold: { bg: '#EFF6FF', fg: '#1D4ED8' },
}

/** The one-line "why" a row shows — the AI's read when there is one, the
 *  bare fact otherwise. Never just "Follow-up required". */
export function whyFor(it: FollowUpQueueItem): string {
  if (it.reason === 'sales_response_overdue') {
    return `Customer wrote ${agoText(it.since)} and hasn’t heard back${it.aiSummary ? ` — ${it.aiSummary}` : ''}`
  }
  if (it.reason === 'manual_followup_due') {
    return it.reasonDetail === 'exhausted'
      ? `Every planned chase is done and they never answered — decide what happens next`
      : `Follow-up scheduled for ${new Date(it.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${it.aiSummary ? ` — ${it.aiSummary}` : ''}`
  }
  return it.aiSummary
    ? `${it.aiSummary} — quiet for ${it.daysWaiting} day${it.daysWaiting === 1 ? '' : 's'}`
    : `We spoke last; nothing back for ${it.daysWaiting} day${it.daysWaiting === 1 ? '' : 's'}`
}

/** "5h ago", "2d ago". */
export function agoText(iso: string | null | undefined): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

/** The stage line under a name: the quiet-send stage, else the manual chase. */
export function stageText(it: FollowUpQueueItem): string {
  if (it.quietStage) return it.quietStage.label
  if (it.sequence) return it.sequence.exhausted ? `${it.sequence.label} · exhausted` : it.sequence.label
  return ''
}
