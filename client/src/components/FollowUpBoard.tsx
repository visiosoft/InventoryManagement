import { useState } from 'react'
import type { FollowUpQueueItem } from '../lib/api'
import { agoText } from '../lib/followUpUi'

/**
 * The follow-ups as a board: every open lead sits in exactly one column —
 * waiting for our reply, 1st / 2nd / 3rd follow-up due next, or all sent and
 * needing a decision. Tap a card to open the chat and send the next one.
 */

type Heat = 'hot' | 'warm' | 'cold'
const HEAT: Record<Heat, { label: string; bg: string; fg: string }> = {
  hot: { label: 'Hot', bg: '#FEE2E2', fg: '#B91C1C' },
  warm: { label: 'Warm', bg: '#FEF3C7', fg: '#B45309' },
  cold: { label: 'Cold', bg: '#E0F2FE', fg: '#0369A1' },
}
const INK = '#14081F'
const MUTED = '#756E80'
const PAGE = 40
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th']

const initials = (name = '') => name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

function columnOf(it: FollowUpQueueItem): string {
  if (it.reason === 'sales_response_overdue') return 'reply'
  if (it.window === 'exhausted' || it.quietStage?.exhausted) return 'decide'
  return `stage-${Math.max(1, it.quietStage?.next || 1)}`
}

/** When it is due, and whether that is now. */
function dueOf(it: FollowUpQueueItem) {
  if (it.reason === 'sales_response_overdue') return { text: `Wrote ${agoText(it.lastInboundAt || it.since)}`, now: true }
  if (it.window === 'exhausted') return { text: `Quiet ${it.daysWaiting} days`, now: true }
  if (!it.nextContactAt) return { text: 'No date', now: false }
  const at = new Date(it.nextContactAt)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  if (at <= end) return { text: 'Due today', now: true }
  return { text: `Due ${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`, now: false }
}

export default function FollowUpBoard({ items, isAdmin, heatOf, byBest, onOpen }: {
  items: FollowUpQueueItem[]
  isAdmin: boolean
  heatOf: (it: FollowUpQueueItem) => Heat
  byBest: (a: FollowUpQueueItem, b: FollowUpQueueItem) => number
  onOpen: (leadId: string) => void
}) {
  const [shown, setShown] = useState<Record<string, number>>({})
  const total = Math.max(3, ...items.map((it) => it.quietStage?.total || 0))

  const columns = [
    { key: 'reply', title: 'Reply now', dot: '#DC2626', hint: 'They wrote — answer them' },
    ...Array.from({ length: total }, (_, i) => ({
      key: `stage-${i + 1}`, title: `${ORDINAL[i] || `${i + 1}th`} follow-up`,
      dot: ['#D97706', '#EA580C', '#7C3AED', '#0284C7', '#0D9488', '#64748B'][i] || '#64748B',
      hint: i === 0 ? 'Quiet — first nudge next' : `${ORDINAL[i - 1] || i} sent, no reply yet`,
    })),
    { key: 'decide', title: 'Needs a decision', dot: '#475569', hint: 'All sent — keep, nurture or close' },
  ]

  const byCol = new Map<string, FollowUpQueueItem[]>()
  for (const it of items) {
    const k = columnOf(it)
    byCol.set(k, [...(byCol.get(k) || []), it])
  }
  // Due ones first, then the most promising.
  for (const list of byCol.values()) list.sort((a, b) => Number(dueOf(b).now) - Number(dueOf(a).now) || byBest(a, b))

  return (
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start', marginTop: 12 }}>
      {columns.map((c) => {
        const list = byCol.get(c.key) || []
        const limit = shown[c.key] || PAGE
        const dueNow = list.filter((it) => dueOf(it).now).length
        return (
          <section key={c.key} style={{ flex: '0 0 268px', borderRadius: 18, padding: 10, background: '#F4F0E8' }}>
            <header style={{ padding: '8px 8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: c.dot }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{c.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: MUTED, background: '#fff', borderRadius: 999, padding: '3px 10px' }}>{list.length}</span>
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, paddingLeft: 17 }}>
                {c.hint}{dueNow ? <> · <b style={{ color: '#B91C1C' }}>{dueNow} due now</b></> : null}
              </div>
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!list.length && <div style={{ padding: '18px 8px', fontSize: 13, color: '#B7B1C0', textAlign: 'center' }}>Nobody here</div>}
              {list.slice(0, limit).map((it) => {
                const h = HEAT[heatOf(it)]
                const due = dueOf(it)
                return (
                  <button key={it.leadId} type="button" onClick={() => onOpen(it.leadId)}
                    style={{ textAlign: 'left', background: '#fff', borderRadius: 14, padding: 12, border: '1px solid rgba(20,8,31,.08)', boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 999, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700 }}>{initials(it.name)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || it.phone}</span>
                        <span style={{ display: 'block', fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.phone}{isAdmin && it.ownerName ? ` · ${it.ownerName}` : ''}
                        </span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      <span style={{ background: h.bg, color: h.fg, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}>{h.label}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: due.now ? '#B91C1C' : '#4A4357' }}>
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: due.now ? '#DC2626' : '#16A34A' }} />{due.text}
                      </span>
                    </div>
                  </button>
                )
              })}
              {list.length > limit && (
                <button type="button" onClick={() => setShown((s) => ({ ...s, [c.key]: limit + PAGE }))}
                  style={{ border: 0, background: 'none', color: '#5B2BC9', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 8 }}>
                  Show {Math.min(PAGE, list.length - limit)} more of {list.length - limit}
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
