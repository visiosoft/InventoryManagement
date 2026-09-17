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

/* "Urgent/Soon/Whenever", not "High/Medium/Low": this is a separate score
 * from Intent (temperature, just below) — how soon to act, not how
 * promising the lead is — and both used to say High/Medium/Low, which
 * read as a contradiction the moment a row disagreed with the intent tab
 * it was sitting in (a lead can genuinely be Urgent and Medium intent at
 * once). Kept in one place so the drawer and the table never disagree. */
export const PRIORITY_UI: Record<FollowUpPriority, { label: string; bg: string; fg: string }> = {
  high: { label: 'URGENT', bg: '#FEE2E2', fg: '#B91C1C' },
  medium: { label: 'SOON', bg: '#FEF3C7', fg: '#92400E' },
  low: { label: 'WHENEVER', bg: '#ECFDF5', fg: '#047857' },
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

/** The badge for who this number is in Customers, or null for nobody. */
export function customerBadge(c: { status: 'active' | 'former'; contracts: { unit: string; contractNo: string }[] } | null | undefined) {
  if (!c) return null
  if (c.status === 'active') {
    const k = c.contracts[0]
    return { label: `Active tenant${k?.unit ? ` · ${k.unit}` : ''}`, bg: '#DCFCE7', fg: '#15803D', title: k ? `${k.contractNo}${k.unit ? ` — unit ${k.unit}` : ''}` : 'Has a live contract' }
  }
  return { label: 'Former tenant', bg: '#F3F4F6', fg: '#6B7280', title: 'Had a contract before; none live now' }
}

export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

/** The name {{1}} will carry. A placeholder like "WhatsApp Contact 2003"
 *  is not a name — "Hello WhatsApp," would go out — so it becomes "there",
 *  matching greetingNameFor() on the server. */
export function firstNameOf(name: string): string {
  const n = (name || '').trim()
  if (!n || /^whatsapp\s*contact/i.test(n)) return 'there'
  return n.split(/\s+/)[0]
}

const LAST_TEMPLATE_KEY = 'pb_followup_last_template'
export function rememberTemplate(name: string) {
  try { localStorage.setItem(LAST_TEMPLATE_KEY, name) } catch { /* private mode */ }
}
/** The template to start on: the one used last, else the first whose name
 *  says follow-up, else the first. Never "Contract Expiry" by accident. */
export function defaultTemplate<T extends { name: string; label: string }>(templates: T[]): T | undefined {
  if (!templates.length) return undefined
  let last = ''
  try { last = localStorage.getItem(LAST_TEMPLATE_KEY) || '' } catch { /* private mode */ }
  return templates.find((t) => t.name === last)
    || templates.find((t) => /follow/i.test(t.name) || /follow/i.test(t.label))
    || templates[0]
}

/** The stage line under a name: the quiet-send stage, else the manual chase. */
export function stageText(it: FollowUpQueueItem): string {
  if (it.quietStage) return it.quietStage.label
  if (it.sequence) return it.sequence.exhausted ? `${it.sequence.label} · exhausted` : it.sequence.label
  return ''
}
