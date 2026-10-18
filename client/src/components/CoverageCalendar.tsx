import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardBody } from './ui'

/**
 * The weekly lead coverage calendar — and the place the roster is edited.
 *
 * Laid out like the coverage review: a column per day, a row per hour, each
 * cell in the colour of whoever takes leads then, pink GAP where nobody does.
 *
 * Editing is done on the calendar itself: pick a rep, then click or drag over
 * hours to give them those hours (or take them away). For the usual case —
 * the same hours on several days — each rep also has a one-line shift setter.
 * Nothing changes for distribution until Save.
 */

export type Shift = { day: number; start: string; end: string }
export type RosterRule = {
  user: { _id: string; name: string }
  color?: string
  weeklyShifts?: Shift[]
  workingHours?: { days?: number[]; start?: string; end?: string }
  rosterManaged?: boolean
}

const NAVY = '#1B2238'
const GAP_BG = '#FBE5E5'
const GAP_FG = '#D9534F'
const LINE = '#D9DCE3'
const MUTED = '#6B7280'
const PALETTE = ['#1B2238', '#7B4BBF', '#3E8E6E', '#C2410C', '#0E7490', '#B91C77']

// Monday first, as the calendar reads. Values are Date.getDay() numbers.
const WEEK = [['MONDAY', 1], ['TUESDAY', 2], ['WEDNESDAY', 3], ['THURSDAY', 4], ['FRIDAY', 5], ['SATURDAY', 6], ['SUNDAY', 0]] as const
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const clock = (v?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hourLabel = (h: number) => (h === 24 || h === 0 ? '12:00 AM' : `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`)
const shortHour = (h: number) => (h === 24 || h === 0 ? '12am' : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`)
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

function onShiftAt(rule: RosterRule, day: number, minute: number) {
  const shifts = rule.weeklyShifts ?? []
  // On the roster with no shifts is off — the server reads it the same way.
  if (shifts.length || rule.rosterManaged) {
    return shifts.some((sh) => {
      const s = clock(sh.start)
      const e = clock(sh.end)
      if (s == null || e == null) return false
      if (s < e) return sh.day === day && minute >= s && minute < e
      return (sh.day === day && minute >= s) || ((sh.day + 1) % 7 === day && minute < e)
    })
  }
  const hours = rule.workingHours ?? {}
  if (hours.days?.length && !hours.days.includes(day)) return false
  const s = clock(hours.start)
  const e = clock(hours.end)
  if (s == null || e == null) return true
  return s <= e ? minute >= s && minute < e : minute >= s || minute < e
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

/** "Mon–Sat 8am–4pm · Sun 10am–6pm" */
function describe(g: Grid) {
  const perDay = new Map<number, string>()
  for (let d = 0; d < 7; d++) {
    const parts: string[] = []
    let h = 0
    while (h < 24) {
      if (!g[d][h]) { h++; continue }
      const s = h
      while (h < 24 && g[d][h]) h++
      parts.push(`${shortHour(s)}–${shortHour(h)}`)
    }
    if (parts.length) perDay.set(d, parts.join(', '))
  }
  if (!perDay.size) return 'No hours — gets no leads'
  // Group consecutive days (Mon→Sun order) that share the same hours.
  const order: number[] = WEEK.map(([, d]) => d)
  const groups: { days: number[]; hours: string }[] = []
  for (const d of order) {
    const hrs = perDay.get(d)
    if (!hrs) continue
    const last = groups[groups.length - 1]
    if (last && last.hours === hrs && order.indexOf(last.days[last.days.length - 1]) === order.indexOf(d) - 1) last.days.push(d)
    else groups.push({ days: [d], hours: hrs })
  }
  return groups.map((g2) => {
    const label = g2.days.length > 2
      ? `${DAY_SHORT[g2.days[0]]}–${DAY_SHORT[g2.days[g2.days.length - 1]]}`
      : g2.days.map((d) => DAY_SHORT[d]).join(', ')
    return `${label} ${g2.hours}`
  }).join(' · ')
}

/** The longest stretch of the week with nobody on, wrapping Sunday into Monday. */
function longestGap(grids: Grid[]) {
  const slots: boolean[] = []
  for (const [, day] of WEEK) for (const h of HOURS) slots.push(grids.some((g) => g[day][h]))
  if (!slots.some(Boolean)) return 'Nobody has any hours yet — every lead waits for the out-of-hours setting.'
  if (slots.every(Boolean)) return null
  const n = slots.length
  let best = { len: 0, from: 0 }
  for (let i = 0; i < n; i++) {
    if (slots[i] || !slots[(i - 1 + n) % n]) continue
    let len = 0
    while (!slots[(i + len) % n] && len < n) len++
    if (len > best.len) best = { len, from: i }
  }
  const at = (i: number) => {
    const idx = ((i % n) + n) % n
    return `${DAY_NAME[WEEK[Math.floor(idx / 24)][1]]} ${hourLabel(idx % 24)}`
  }
  return `Key gap: ${at(best.from)} – ${at(best.from + best.len)} = ${best.len} continuous hours without lead coverage.`
}

/* The Purplebox coverage calendar, as reviewed: matched to reps by name. */
const PRESET: { match: RegExp; color: string; days: number[]; start: number; end: number }[] = [
  { match: /emad/i, color: '#1B2238', days: [1, 2, 3, 4, 5, 6], start: 8, end: 16 },
  { match: /randa/i, color: '#7B4BBF', days: [1, 2, 4, 5, 6, 0], start: 10, end: 18 },
  { match: /mahmoud/i, color: '#3E8E6E', days: [1, 2, 3, 4, 5, 0], start: 15, end: 22 },
]

type Draft = Record<string, { color: string; grid: Grid }>

function draftFrom(rules: RosterRule[]): Draft {
  const out: Draft = {}
  rules.forEach((r, i) => { out[r.user._id] = { color: r.color || PALETTE[i % PALETTE.length], grid: gridFrom(r) } })
  return out
}

const rangeGrid = (days: number[], start: number, end: number) => {
  const g = emptyGrid()
  for (const d of days) {
    if (start < end) for (let h = start; h < end; h++) g[d][h] = true
    else { // past midnight: evening on the day, small hours on the next
      for (let h = start; h < 24; h++) g[d][h] = true
      for (let h = 0; h < end; h++) g[(d + 1) % 7][h] = true
    }
  }
  return g
}

export default function CoverageCalendar({ rules, saving, saveError, savedAt, onSave }: {
  rules: RosterRule[]
  saving: boolean
  saveError?: string
  savedAt?: number
  onSave: (changes: { userId: string; color: string; weeklyShifts: Shift[] }[]) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rules))
  const [dirty, setDirty] = useState(false)
  const [brush, setBrush] = useState<string>(rules[0]?.user._id ?? '')
  // Bumped whenever the whole roster is replaced (fill, discard, reload), so
  // each rep's quick setter re-reads its days and hours from the calendar.
  const [version, setVersion] = useState(0)
  useEffect(() => { if (!dirty) { setDraft(draftFrom(rules)); setVersion((v) => v + 1) } }, [rules, dirty])
  useEffect(() => { if (!rules.some((r) => r.user._id === brush)) setBrush(rules[0]?.user._id ?? '') }, [rules, brush])

  const grids = useMemo(() => rules.map((r) => draft[r.user._id]?.grid ?? emptyGrid()), [rules, draft])
  const gap = useMemo(() => longestGap(grids), [grids])

  const update = (userId: string, fn: (d: Draft[string]) => Draft[string]) => {
    setDraft((prev) => (prev[userId] ? { ...prev, [userId]: fn(prev[userId]) } : prev))
    setDirty(true)
  }

  /* Painting: press on a cell to give the chosen rep that hour (or take it
     away if they had it), keep the button down and drag to do the same to
     every cell passed over. Works with a finger too. */
  const paint = useRef<{ on: boolean; seen: Set<string> } | null>(null)
  const applyCell = (day: number, hour: number) => {
    const p = paint.current
    if (!p || !brush) return
    const key = `${day}:${hour}`
    if (p.seen.has(key)) return
    p.seen.add(key)
    update(brush, (d) => {
      const grid = d.grid.map((row) => [...row])
      grid[day][hour] = p.on
      return { ...d, grid }
    })
  }
  const cellAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-cell]') as HTMLElement | null
    if (!el) return null
    return { day: Number(el.dataset.day), hour: Number(el.dataset.hour) }
  }
  useEffect(() => {
    const stop = () => { paint.current = null }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [])

  const applyPreset = () => {
    setDraft((prev) => {
      const next = { ...prev }
      for (const r of rules) {
        const p = PRESET.find((x) => x.match.test(r.user.name))
        if (p) next[r.user._id] = { color: p.color, grid: rangeGrid(p.days, p.start, p.end) }
      }
      return next
    })
    setDirty(true)
    setVersion((v) => v + 1)
  }

  const clearEveryone = () => {
    setDraft((prev) => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, { ...d, grid: emptyGrid() }])))
    setDirty(true)
    setVersion((v) => v + 1)
  }

  const undo = () => { setDraft(draftFrom(rules)); setDirty(false); setVersion((v) => v + 1) }

  const save = () => {
    onSave(rules.filter((r) => draft[r.user._id]).map((r) => ({
      userId: r.user._id,
      color: draft[r.user._id].color,
      weeklyShifts: shiftsFrom(draft[r.user._id].grid),
    })))
    setDirty(false)
  }

  const brushRule = rules.find((r) => r.user._id === brush)
  const cellBase = { borderRight: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, height: 26, padding: 0 } as const

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>Weekly Lead Coverage Calendar</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
              New leads only go to whoever is on here at that hour — a rep with no hours gets none. Pink GAP hours follow the out-of-hours setting. New sales reps appear here by themselves, with no hours.
            </div>
          </div>
          {/* Reset: nothing is saved until "Save roster", and "Undo changes"
              in the save bar goes back to what was saved. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyPreset} disabled={saving}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer' }}>
              Reset to coverage calendar
            </button>
            <button type="button" onClick={() => { if (confirm('Clear every rep\'s hours? Nothing is saved until you press Save roster.')) clearEveryone() }} disabled={saving}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: '#B91C1C', cursor: 'pointer' }}>
              Clear everyone
            </button>
          </div>
        </div>

        {/* Step 1: who you are editing */}
        <div className="rounded-lg p-3" style={{ background: '#F6F7F9' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
            1. Pick a rep &nbsp;·&nbsp; 2. Click or drag on the calendar to add or remove their hours &nbsp;·&nbsp; 3. Save
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rules.map((r) => {
              const d = draft[r.user._id]
              const active = r.user._id === brush
              return (
                <button key={r.user._id} type="button" onClick={() => setBrush(r.user._id)}
                  className="inline-flex items-center gap-2"
                  style={{
                    padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${active ? d?.color : LINE}`,
                    background: active ? d?.color : '#fff', color: active ? '#fff' : '#111827',
                  }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: active ? '#fff' : d?.color }} />
                  {r.user.name}
                </button>
              )
            })}
            <span className="inline-flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 700, marginLeft: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: GAP_FG }} /> NO COVERAGE
            </span>
          </div>
        </div>

        {/* The calendar — also the editor */}
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', border: `1px solid ${LINE}`, tableLayout: 'fixed', userSelect: 'none', touchAction: 'none', cursor: brush ? 'cell' : 'default' }}
            onPointerDown={(e) => {
              const c = cellAt(e.clientX, e.clientY)
              if (!c || !brush) return
              e.preventDefault()
              const had = draft[brush]?.grid[c.day][c.hour]
              paint.current = { on: !had, seen: new Set() }
              applyCell(c.day, c.hour)
            }}
            onPointerMove={(e) => {
              if (!paint.current) return
              const c = cellAt(e.clientX, e.clientY)
              if (c) applyCell(c.day, c.hour)
            }}
          >
            <thead>
              <tr>
                <th style={{ background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700, padding: '9px 4px', width: 78 }}>TIME</th>
                {WEEK.map(([label]) => (
                  <th key={label} style={{ background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700, padding: '9px 4px' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((h) => (
                <tr key={h}>
                  <td style={{ ...cellBase, fontSize: 11, color: '#374151', textAlign: 'center', background: '#fff' }}>{hourLabel(h)}</td>
                  {WEEK.map(([label, day]) => {
                    const on = rules.filter((r) => draft[r.user._id]?.grid[day][h])
                    const title = `${DAY_NAME[day]} ${hourLabel(h)} — ${on.length ? on.map((r) => r.user.name).join(', ') : 'nobody'}${brushRule ? `. Click to ${draft[brush]?.grid[day][h] ? 'remove' : 'add'} ${brushRule.user.name}` : ''}`
                    if (!on.length) {
                      return (
                        <td key={label} data-cell data-day={day} data-hour={h} title={title}
                          style={{ ...cellBase, background: GAP_BG, color: GAP_FG, fontSize: 9.5, fontWeight: 600, textAlign: 'center' }}>GAP</td>
                      )
                    }
                    return (
                      <td key={label} data-cell data-day={day} data-hour={h} title={title} style={cellBase}>
                        <div style={{ display: 'flex', height: '100%', pointerEvents: 'none' }}>
                          {on.map((r) => (
                            <div key={r.user._id}
                              style={{
                                flex: 1, background: draft[r.user._id]?.color || NAVY, color: '#fff',
                                fontSize: on.length > 2 ? 8.5 : 10, fontWeight: 700, display: 'flex',
                                alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                                borderLeft: '1px solid rgba(255,255,255,.35)',
                                outline: r.user._id === brush ? '2px solid rgba(255,255,255,.55)' : undefined, outlineOffset: -3,
                              }}>
                              {shortName(r.user.name)}
                            </div>
                          ))}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-between gap-2" style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: gap ? '#111827' : '#047857' }}>{gap ?? 'Covered around the clock.'}</span>
          <span style={{ color: MUTED }}>Times are Dubai time.</span>
        </div>

        {/* The quick way: same hours on several days */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {rules.map((r) => <QuickShift key={`${r.user._id}-${version}`} rule={r} d={draft[r.user._id]} onChange={(fn) => update(r.user._id, fn)} />)}
        </div>

        {/* Save bar */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5"
          style={{ background: dirty ? '#FEF3C7' : '#F6F7F9', border: `1px solid ${dirty ? '#F59E0B' : LINE}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: dirty ? '#92400E' : saveError ? '#B91C1C' : '#047857' }}>
            {dirty ? 'Unsaved changes — distribution still follows the old hours until you save.'
              : saveError ? `Not saved: ${saveError}`
                : savedAt ? 'Roster saved. New leads follow it from now.' : 'Up to date.'}
          </span>
          <span className="flex-1" />
          {dirty && (
            <button type="button" disabled={saving} onClick={undo}
              style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer' }}>
              Undo changes
            </button>
          )}
          <button type="button" disabled={!dirty || saving} onClick={save}
            style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: dirty ? 'pointer' : 'default', background: dirty ? '#5B2BC9' : '#C4B5FD', color: '#fff' }}>
            {saving ? 'Saving…' : 'Save roster'}
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

/* One rep: colour, a plain-English summary, and "these days, these hours". */
function QuickShift({ rule, d, onChange }: {
  rule: RosterRule
  d?: Draft[string]
  onChange: (fn: (d: Draft[string]) => Draft[string]) => void
}) {
  // Prefill from their current hours: the days they work, and the most common start/end.
  const initial = useMemo(() => {
    const days: number[] = []
    let start = 9
    let end = 18
    if (d) {
      for (let day = 0; day < 7; day++) if (d.grid[day].some(Boolean)) days.push(day)
      // The longest block on any working day is the usual shift.
      let best = 0
      for (const day of days) {
        const row = d.grid[day]
        let h = 0
        while (h < 24) {
          if (!row[h]) { h++; continue }
          const s = h
          while (h < 24 && row[h]) h++
          if (h - s > best) { best = h - s; start = s; end = h }
        }
      }
    }
    return { days, start, end }
    // Read once per mount; the parent remounts this when the roster is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [days, setDays] = useState<number[]>(initial.days)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  if (!d) return null

  return (
    <div className="rounded-lg p-3 space-y-2.5" style={{ border: `1px solid ${LINE}`, borderLeft: `5px solid ${d.color}` }}>
      <div className="flex items-center justify-between gap-2">
        <div style={{ fontWeight: 700, fontSize: 14 }}>{rule.user.name}</div>
        <label className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: MUTED, cursor: 'pointer' }}>
          Colour
          <input type="color" value={d.color} onChange={(e) => onChange((x) => ({ ...x, color: e.target.value }))}
            style={{ width: 24, height: 24, border: 'none', padding: 0, background: 'none', cursor: 'pointer' }} />
        </label>
      </div>
      <div style={{ fontSize: 12.5, color: '#374151' }}>{describe(d.grid)}</div>

      <div className="flex flex-wrap gap-1">
        {WEEK.map(([label, day]) => {
          const on = days.includes(day)
          return (
            <button key={label} type="button" onClick={() => setDays(on ? days.filter((x) => x !== day) : [...days, day])}
              style={{
                width: 38, height: 30, borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? d.color : LINE}`, background: on ? d.color : '#fff', color: on ? '#fff' : MUTED,
              }}>
              {label.slice(0, 3)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
        <select value={start} onChange={(e) => setStart(Number(e.target.value))} style={{ padding: '5px 6px', borderRadius: 6, border: `1px solid ${LINE}` }}>
          {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
        to
        <select value={end} onChange={(e) => setEnd(Number(e.target.value))} style={{ padding: '5px 6px', borderRadius: 6, border: `1px solid ${LINE}` }}>
          {[...HOURS.slice(1), 24].map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
        <button type="button" disabled={start === end}
          onClick={() => onChange((x) => ({ ...x, grid: rangeGrid(days, start, end % 24 === 0 ? 24 : end) }))}
          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#111827', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          Apply
        </button>
        <button type="button" onClick={() => onChange((x) => ({ ...x, grid: emptyGrid() }))}
          style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: GAP_FG, fontWeight: 600, cursor: 'pointer' }}>
          Clear hours
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED }}>
        Apply sets exactly these days to these hours (other days off). Fine-tune single hours on the calendar.
      </div>
    </div>
  )
}
