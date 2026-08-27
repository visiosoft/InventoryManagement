/**
 * The chase: what was tried, and what comes next.
 *
 * "Attempt 2 of 3" is counted from the attempts against the plan, never
 * stored on the lead — so it cannot disagree with what actually happened.
 */

import { Phone, MessageCircle, Mic, Mail, MessageSquare, DoorOpen, CircleDot } from 'lucide-react'

export type AttemptChannel = 'call' | 'whatsapp' | 'voice_note' | 'email' | 'sms' | 'walk_in' | 'other'
export type AttemptOutcome = 'no_answer' | 'no_reply' | 'reached' | 'call_back' | 'not_interested' | 'wrong_number'

export type Attempt = {
  no: number
  at: string
  channel: AttemptChannel
  outcome: AttemptOutcome
  note?: string
  user?: { name: string } | null
}

export type FollowUpStep = { label: string; afterDays: number; channel: AttemptChannel }
export type FollowUpPlan = { steps: FollowUpStep[] }

/** How it was tried. A call and a voice note are the two the old model had no way to say. */
export const CHANNELS: { value: AttemptChannel; label: string; icon: typeof Phone }[] = [
  { value: 'call', label: 'Called', icon: Phone },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'voice_note', label: 'Voice note', icon: Mic },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
  { value: 'walk_in', label: 'In person', icon: DoorOpen },
  { value: 'other', label: 'Other', icon: CircleDot },
]

/**
 * What came back. Ordered by how often it happens, not by how good it is —
 * the first two are what a chase is mostly made of.
 */
export const OUTCOMES: { value: AttemptOutcome; label: string; bg: string; fg: string; ends?: boolean }[] = [
  { value: 'no_answer', label: 'No answer', bg: 'rgba(217,119,6,.09)', fg: '#D97706' },
  { value: 'no_reply', label: 'No reply', bg: 'rgba(217,119,6,.09)', fg: '#D97706' },
  { value: 'reached', label: 'Spoke to them', bg: 'rgba(22,163,74,.09)', fg: '#16A34A', ends: true },
  { value: 'call_back', label: 'Call back later', bg: '#F7F3FF', fg: '#4A1FA0' },
  { value: 'not_interested', label: 'Not interested', bg: 'rgba(117,110,128,.09)', fg: '#756E80', ends: true },
  { value: 'wrong_number', label: 'Wrong number', bg: 'rgba(117,110,128,.09)', fg: '#756E80', ends: true },
]

export const channelOf = (v?: string) => CHANNELS.find((c) => c.value === v) ?? CHANNELS[CHANNELS.length - 1]
export const outcomeOf = (v?: string) => OUTCOMES.find((o) => o.value === v) ?? OUTCOMES[0]

/** Mirrors sequenceState on the server. */
export function sequenceState(attempts: Attempt[] = [], plan?: FollowUpPlan | null, exhausted = false) {
  const made = attempts.length
  const total = plan?.steps?.length ?? 0
  return {
    made,
    total,
    // Capped: giving it one more should not read "attempt 4 of 3".
    label: total ? `Attempt ${Math.min(made + 1, total)} of ${total}` : `Attempt ${made + 1}`,
    exhausted,
    nextStep: plan?.steps?.[made] ?? null,
  }
}

/** Today plus the step's gap, as a Dubai-local YYYY-MM-DD for a date input. */
export function suggestedNextDate(plan: FollowUpPlan | null | undefined, made: number, today: string): string {
  const step = plan?.steps?.[made]
  if (!step) return ''
  const days = Math.max(0, Number(step.afterDays) || 0)
  return new Date(new Date(`${today}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
