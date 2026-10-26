import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardBody } from './ui'

/**
 * The weekly lead coverage calendar — and the place the roster is edited.
 *
 * Laid out like the coverage review: a column per day, a row per hour, each
 * cell in the colour of whoever takes leads then, pink GAP where nobody does.
 *
 * Click an hour, or drag across several, and a small window asks who is on
 * then and how the leads are split. Left even, the reps on take turns one by
 * one; set percentages (70 / 15 / 15) and that hour follows them. Saved the
 * moment it is applied.
 */

export type Shift = { day: number; start: string; end: string }
export type HourSplit = { day: number; hour: number; shares: { user: string; pct: number }[] }
export type RosterPerson = { _id: string; name: string }
export type RosterRule = {
  user: { _id: string; name: string }
  color?: string
  weeklyShifts?: Shift[]
  rosterManaged?: boolean
}

const GAP_BG = '#FDF2F2'
const GAP_LINE = '#F5D0D0'
const GAP_FG = '#D9534F'
const LINE = '#ECEDF1'
const MUTED = '#6B7280'
const PALETTE = ['#1B2238', '#7B4BBF', '#3E8E6E', '#C2410C', '#0E7490', '#B91C77']

// Monday first, as the calendar reads. Values are Date.getDay() numbers.
const WEEK = [['MONDAY', 1], ['TUESDAY', 2], ['WEDNESDAY', 3], ['THURSDAY', 4], ['FRIDAY', 5], ['SATURDAY', 6], ['SUNDAY', 0]] as const
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const clock = (v?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hourLabel = (h: number) => (h === 24 || h === 0 ? '12:00 AM' : `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`)
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`

/** The name on the calendar: "Mohamed Emad" is EMAD, as the team says it. */
export function shortName(name: string) {
  const words = String(name || '').trim().split(/\s+/)
  const first = /^m[ou]hamm?e?d$/i.test(words[0] || '') && words[1] ? words[1] : words[0]
  return (first || '').toUpperCase()
}

/* ── The roster as a grid of hours ─────────────────────────────────────────
   grid[day][hour] = on shift. Converted to and from the saved weeklyShifts,
   so the calendar can be painted hour by hour. */
type Grid = boolean[][]
const emptyGrid = (): Grid => Array.from({ length: 7 }, () => Array(24).fill(false))

/** On the roster at this weekday and minute — the same rule the server applies: no shifts is off. */
function onShiftAt(rule: RosterRule, day: number, minute: number) {
  return (rule.weeklyShifts ?? []).some((sh) => {
    const s = clock(sh.start)
    const e = clock(sh.end)
    if (s == null || e == null) return false
    if (s < e) return sh.day === day && minute >= s && minute < e
    return (sh.day === day && minute >= s) || ((sh.day + 1) % 7 === day && minute < e)
  })
}

function gridFrom(rule: RosterRule): Grid {
  const g = emptyGrid()
  for (let d = 0; d < 7; d++) for (const h of HOURS) g[d][h] = onShiftAt(rule, d, h * 60)
  return g
}

/** Contiguous hours per day become shifts; a run to midnight ends at 24:00. */
function shiftsFrom(g: Grid): Shift[] {
  const out: Shift[] = []
  for (let d = 0; d < 7; d++) {
    let h = 0
    while (h < 24) {
      if (!g[d][h]) { h++; continue }
      const start = h
      while (h < 24 && g[d][h]) h++
      out.push({ day: d, start: pad(start), end: pad(h) })
    }
  }
  return out
}

type Pct = Record<string, string>

const keyOf = (day: number, hour: number) => `${day}:${hour}`

/** "Mon 3 PM", or "Mon 3 PM – 6 PM", or "8 hours on 3 days". */
function selectionLabel(cells: { day: number; hour: number }[]) {
  if (cells.length === 1) return `${DAY_NAME[cells[0].day]} ${hourLabel(cells[0].hour)}`
  const days = [...new Set(cells.map((c) => c.day))]
  if (days.length === 1) {
    const hours = cells.map((c) => c.hour).sort((a, b) => a - b)
    return `${DAY_NAME[days[0]]} ${hourLabel(hours[0])} – ${hourLabel(hours[hours.length - 1] + 1)}`
  }
  return `${cells.length} hours on ${days.length} days`
}

export default function CoverageCalendar({ rules, people, splits, saving, error, onApply }: {
  rules: RosterRule[]
  /** Everybody who could take leads (sales reps), in the rotation or not. */
  people: RosterPerson[]
  splits: HourSplit[]
  saving: boolean
  error?: string
  onApply: (change: { rules: { userId: string; color: string; weeklyShifts: Shift[] }[]; hourSplits: HourSplit[] }) => void
}) {
  // Everyone shown: the people in the rotation first, in their order, then anybody else who could be.
  const everyone = useMemo(() => {
    const out: { _id: string; name: string; color: string; rule?: RosterRule }[] = []
    // A colour nobody has yet, so two people never look alike.
    const free = () => PALETTE.find((c) => !out.some((x) => x.color.toLowerCase() === c.toLowerCase())) ?? PALETTE[out.length % PALETTE.length]
    for (const r of rules) out.push({ _id: r.user._id, name: r.user.name, color: r.color || free(), rule: r })
    for (const p of people) if (!out.some((x) => x._id === p._id)) out.push({ _id: p._id, name: p.name, color: free() })
    return out
  }, [rules, people])
  const grids = useMemo(() => Object.fromEntries(everyone.map((x) => [x._id, x.rule ? gridFrom(x.rule) : emptyGrid()])), [everyone])
  const splitAt = useMemo(() => new Map(splits.map((c) => [keyOf(c.day, c.hour), c])), [splits])

  /* Selecting: press on an hour and drag to take in more; let go and the
     window opens for whatever was covered. Works with a finger too. */
  const [selecting, setSelecting] = useState<Set<string> | null>(null)
  const [open, setOpen] = useState<{ day: number; hour: number }[] | null>(null)
  const drag = useRef<Set<string> | null>(null)
  const cellAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-cell]') as HTMLElement | null
    return el ? { day: Number(el.dataset.day), hour: Number(el.dataset.hour) } : null
  }
  useEffect(() => {
    const stop = () => {
      const sel = drag.current
      drag.current = null
      setSelecting(null)
      if (sel?.size) setOpen([...sel].map((k) => { const [d, h] = k.split(':').map(Number); return { day: d, hour: h } }))
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [])
  const take = (c: { day: number; hour: number } | null) => {
    if (!c || !drag.current) return
    const k = keyOf(c.day, c.hour)
    if (drag.current.has(k)) return
    drag.current.add(k)
    setSelecting(new Set(drag.current))
  }

  const apply = (cells: { day: number; hour: number }[], on: Record<string, boolean>, pct: Pct, even: boolean) => {
    const changed: { userId: string; color: string; weeklyShifts: Shift[] }[] = []
    for (const x of everyone) {
      const g = grids[x._id].map((row) => [...row])
      let diff = false
      for (const c of cells) if (g[c.day][c.hour] !== Boolean(on[x._id])) { g[c.day][c.hour] = Boolean(on[x._id]); diff = true }
      if (diff) changed.push({ userId: x._id, color: x.color, weeklyShifts: shiftsFrom(g) })
    }
    const inCells = new Set(cells.map((c) => keyOf(c.day, c.hour)))
    const kept = splits.filter((c) => !inCells.has(keyOf(c.day, c.hour)))
    const shares = everyone.filter((x) => on[x._id]).map((x) => ({ user: x._id, pct: Number(pct[x._id]) || 0 })).filter((x) => x.pct > 0)
    const added = even || shares.length < 2 ? [] : cells.map((c) => ({ day: c.day, hour: c.hour, shares }))
    onApply({ rules: changed, hourSplits: [...kept, ...added] })
    setOpen(null)
  }

  const cellBase = { height: 24, padding: 0, borderRadius: 5, overflow: 'hidden' } as const

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" style={{ fontSize: 12.5, fontWeight: 600, color: '#374151' }}>
          {everyone.filter((x) => grids[x._id].some((row) => row.some(Boolean))).map((x) => (
            <span key={x._id} className="inline-flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 999, background: x.color }} />{x.name}</span>
          ))}
          <span className="inline-flex items-center gap-1.5" style={{ color: MUTED }}><span style={{ width: 10, height: 10, borderRadius: 999, background: GAP_BG, border: `1px solid ${GAP_LINE}` }} />Nobody on</span>
          <span className="flex-1" />
          <span style={{ color: saving ? MUTED : error ? '#B91C1C' : MUTED, fontWeight: 500 }}>
            {saving ? 'Saving…' : error ? `Not saved: ${error}` : 'Click or drag hours to edit · Dubai time'}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', minWidth: 900, borderCollapse: 'separate', borderSpacing: 2, tableLayout: 'fixed', userSelect: 'none', touchAction: 'none', cursor: 'pointer' }}
            onPointerDown={(e) => {
              const c = cellAt(e.clientX, e.clientY)
              if (!c || saving) return
              e.preventDefault()
              drag.current = new Set()
              take(c)
            }}
            onPointerMove={(e) => { if (drag.current) take(cellAt(e.clientX, e.clientY)) }}
          >
            <thead>
              <tr>
                <th style={{ width: 64 }} />
                {WEEK.map(([label]) => (
                  <th key={label} style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', padding: '4px 4px 8px' }}>{label.slice(0, 3)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => (
                <tr key={h}>
                  <td style={{ ...cellBase, fontSize: 10.5, color: MUTED, textAlign: 'right', paddingRight: 8 }}>{h % 3 === 0 ? hourLabel(h).replace(':00', '') : ''}</td>
                  {WEEK.map(([label, day]) => {
                    const on = everyone.filter((x) => grids[x._id][day][h])
                    const split = splitAt.get(keyOf(day, h))
                    const pctFor = (id: string) => split?.shares.find((x) => x.user === id)?.pct
                    const picked = selecting?.has(keyOf(day, h))
                    const title = `${DAY_NAME[day]} ${hourLabel(h)} — ${on.length ? on.map((x) => `${x.name}${pctFor(x._id) ? ` ${pctFor(x._id)}%` : ''}`).join(', ') : 'nobody'}. Click to change.`
                    const ring = picked ? { outline: '2px solid #F59E0B', outlineOffset: -2 } : {}
                    if (!on.length) {
                      return (
                        <td key={label} data-cell data-day={day} data-hour={h} title={title}
                          style={{ ...cellBase, ...ring, background: GAP_BG }} />
                      )
                    }
                    return (
                      <td key={label} data-cell data-day={day} data-hour={h} title={title} style={{ ...cellBase, ...ring }}>
                        <div style={{ display: 'flex', height: '100%', pointerEvents: 'none' }}>
                          {on.map((x) => {
                            const p = pctFor(x._id)
                            return (
                              <div key={x._id}
                                style={{
                                  flex: split ? Math.max(25, p ?? 0) : 1, background: x.color, color: '#fff',
                                  fontSize: on.length > 2 ? 8.5 : 10, fontWeight: 700, display: 'flex',
                                  alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                                  borderLeft: '1px solid rgba(255,255,255,.4)', letterSpacing: '.02em',
                                }}>
                                {/* A split hour is too narrow for names: its percentages, in each person's colour. */}
                                {split ? (p ? `${p}%` : '—') : shortName(x.name)}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>

      {open && (
        <HourWindow
          cells={open}
          everyone={everyone}
          onAt={(id) => open.some((c) => grids[id][c.day][c.hour])}
          split={splitAt.get(keyOf(open[0].day, open[0].hour))}
          onCancel={() => setOpen(null)}
          onApply={(on, pct, even) => apply(open, on, pct, even)}
        />
      )}
    </Card>
  )
}

/* The window for an hour (or a few): who is on, and how the leads are split. */
function HourWindow({ cells, everyone, onAt, split, onCancel, onApply }: {
  cells: { day: number; hour: number }[]
  everyone: { _id: string; name: string; color: string }[]
  onAt: (id: string) => boolean
  split?: HourSplit
  onCancel: () => void
  onApply: (on: Record<string, boolean>, pct: Pct, even: boolean) => void
}) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(everyone.map((x) => [x._id, onAt(x._id)])))
  const evenPct = (o: Record<string, boolean>) => {
    const ids = everyone.filter((x) => o[x._id]).map((x) => x._id)
    const each = ids.length ? Math.floor((100 / ids.length) * 10) / 10 : 0
    return Object.fromEntries(ids.map((id, i) => [id, String(i === ids.length - 1 ? Math.round((100 - each * (ids.length - 1)) * 10) / 10 : each)]))
  }
  const [even, setEven] = useState(!split)
  const [pct, setPct] = useState<Pct>(() => (split ? Object.fromEntries(split.shares.map((x) => [x.user, String(x.pct)])) : evenPct(on)))
  const picked = everyone.filter((x) => on[x._id])
  const total = Math.round(picked.reduce((s, x) => s + (Number(pct[x._id]) || 0), 0) * 10) / 10
  const ok = even || picked.length < 2 || total === 100

  const toggle = (id: string) => {
    const next = { ...on, [id]: !on[id] }
    setOn(next)
    if (even) setPct(evenPct(next))
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.35)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Who takes leads this hour"
        style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420, padding: 20, boxShadow: '0 20px 50px rgba(20,8,31,.25)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>{selectionLabel(cells)}</div>

        <div className="mt-4 space-y-1.5">
          {everyone.map((x) => (
            <label key={x._id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ border: `1px solid ${on[x._id] ? x.color : LINE}`, cursor: 'pointer' }}>
              <input type="checkbox" checked={Boolean(on[x._id])} onChange={() => toggle(x._id)} style={{ width: 16, height: 16, accentColor: x.color }} />
              <span style={{ width: 10, height: 10, borderRadius: 3, background: x.color }} />
              <span className="flex-1" style={{ fontSize: 14, fontWeight: 600 }}>{x.name}</span>
              {on[x._id] && picked.length > 1 && (
                <span className="inline-flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                  <input value={pct[x._id] ?? ''} inputMode="decimal" aria-label={`${x.name} share`}
                    onChange={(e) => { setEven(false); setPct({ ...pct, [x._id]: e.target.value.replace(/[^\d.]/g, '') }) }}
                    style={{ width: 54, textAlign: 'right', padding: '4px 6px', borderRadius: 6, border: `1px solid ${LINE}`, fontSize: 13 }} />
                  <span style={{ fontSize: 12.5, color: MUTED }}>%</span>
                </span>
              )}
            </label>
          ))}
        </div>

        {picked.length > 1 && (
          <div className="flex items-center justify-between gap-2 mt-3" style={{ fontSize: 12.5 }}>
            {even
              ? <span style={{ color: '#047857', fontWeight: 600 }}>Taking turns</span>
              : <span style={{ color: total === 100 ? '#047857' : '#B91C1C', fontWeight: 600 }}>Total {total}%</span>}
            {!even && (
              <button type="button" onClick={() => { setEven(true); setPct(evenPct(on)) }}
                style={{ fontWeight: 600, color: '#5B2BC9', background: 'none', border: 'none', cursor: 'pointer' }}>Split evenly</button>
            )}
          </div>
        )}
        {!picked.length && <div className="mt-3" style={{ fontSize: 12.5, color: GAP_FG, fontWeight: 600 }}>Nobody on</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={!ok} onClick={() => onApply(on, pct, even)}
            style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: ok ? 'pointer' : 'default', background: ok ? '#5B2BC9' : '#C4B5FD', color: '#fff' }}>
            Apply{cells.length > 1 ? ` to ${cells.length} hours` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
