import { useSyncExternalStore } from 'react'

/**
 * How far each WhatsApp conversation has been read, shared across the app.
 *
 * The console and the notification bell in the top bar both need this, and both
 * write to it. localStorage alone would not do: it does not notify listeners in
 * the same tab, so opening a chat in the console would leave the bell still
 * showing it as unread. This keeps the value in memory, persists it, and tells
 * subscribers when it changes.
 */

const SEEN_KEY = 'wa_inbox_last_seen'

export type SeenMap = Record<string, string>

function read(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

let seen: SeenMap = read()
const listeners = new Set<() => void>()

function commit(next: SeenMap) {
  seen = next
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch { /* quota — ignore */ }
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// Returned unchanged when nothing moved, so useSyncExternalStore does not
// re-render on every poll.
const getSnapshot = () => seen

export function useSeen(): SeenMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const isNewer = (iso: string, against?: string) =>
  !against || new Date(iso).getTime() > new Date(against).getTime()

/** Mark one conversation read up to the given message time. */
export function markSeen(phoneNormalized: string, iso: string) {
  if (!phoneNormalized || !iso || !isNewer(iso, seen[phoneNormalized])) return
  commit({ ...seen, [phoneNormalized]: iso })
}

/**
 * Mark every conversation read up to its own newest message, rather than to
 * "now" — a message arriving mid-click stays unread instead of being skipped.
 */
export function markAllSeen(messages: Array<{ direction: string; phoneNormalized: string; occurredAt: string }>) {
  const next = { ...seen }
  let changed = false
  for (const m of messages) {
    if (m.direction !== 'inbound') continue
    if (isNewer(m.occurredAt, next[m.phoneNormalized])) {
      next[m.phoneNormalized] = m.occurredAt
      changed = true
    }
  }
  if (changed) commit(next)
}

/** Unread inbound count per conversation, given the whole-inbox feed. */
export function unreadFrom(
  messages: Array<{ direction: string; phoneNormalized: string; occurredAt: string }> | undefined,
  seenMap: SeenMap,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of messages ?? []) {
    if (m.direction !== 'inbound') continue
    const at = seenMap[m.phoneNormalized]
    if (at && new Date(m.occurredAt).getTime() <= new Date(at).getTime()) continue
    out[m.phoneNormalized] = (out[m.phoneNormalized] ?? 0) + 1
  }
  return out
}
