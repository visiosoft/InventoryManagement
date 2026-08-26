/**
 * When a follow-up actually lands, and how loudly it should say so.
 *
 * Shared by the leads list and the lead page: they showed the same date and
 * disagreed about what it meant, because each worked it out for itself.
 */

export type FollowUpKind = 'date' | 'week' | 'month'
export type FollowUpTone = 'overdue' | 'today' | 'soon' | 'later'

/**
 * The day the reminder will be raised — mirrors notifyDayFor on the server.
 *
 * Display only. The server decides; this stops the choice being a guess about
 * what the system will do.
 */
export function reminderDay(followUpAt?: string | null, kind: FollowUpKind = 'date'): string {
  if (!followUpAt) return ''
  const day = String(followUpAt).slice(0, 10)
  if (kind === 'month') return `${day.slice(0, 7)}-01`
  if (kind !== 'week') return day
  const midnight = new Date(`${day}T00:00:00.000Z`)
  const weekday = midnight.getUTCDay()
  // Sunday closes the week it belongs to rather than opening the next one.
  const back = weekday === 0 ? 6 : weekday - 1
  return new Date(midnight.getTime() - back * 86_400_000).toISOString().slice(0, 10)
}

/**
 * How many days away that is, and which of four states it falls in.
 *
 * Overdue and due-today are the two worth interrupting somebody over, so they
 * are the two that get a colour of their own.
 */
export function followUpState(day: string): { tone: FollowUpTone; days: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = new Date(`${day}T00:00:00`)
  if (Number.isNaN(at.getTime())) return { tone: 'later', days: 0 }
  const days = Math.round((at.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { tone: 'overdue', days }
  if (days === 0) return { tone: 'today', days }
  if (days <= 3) return { tone: 'soon', days }
  return { tone: 'later', days }
}

/** The colour each state carries, wherever it is shown. */
export const FOLLOW_UP_TONE: Record<FollowUpTone, { color: string; bg: string; border: string }> = {
  overdue: { color: '#DC2626', bg: 'rgba(220,38,38,.09)', border: 'rgba(220,38,38,.25)' },
  today: { color: '#D97706', bg: 'rgba(217,119,6,.09)', border: 'rgba(217,119,6,.25)' },
  soon: { color: '#D97706', bg: 'rgba(217,119,6,.09)', border: 'rgba(217,119,6,.25)' },
  later: { color: '#4A1FA0', bg: '#F7F3FF', border: '#EDE5FF' },
}
