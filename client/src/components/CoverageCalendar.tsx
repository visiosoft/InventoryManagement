import { useEffect, useMemo, useState } from 'react'
import { Button, Card, CardBody, CardHeader } from './ui'

/**
 * The weekly lead coverage calendar, and the roster behind it.
 *
 * Drawn the way the coverage review was laid out: a column per day, a row per
 * hour, each cell filled with the colour of whoever is taking leads then, and
 * a pink GAP where nobody is. The roster editor underneath is what the lead
 * distribution actually follows — the calendar redraws as it is edited, so a
 * gap shows up before it is saved.
 */

export type Shift = { day: number; start: string; end: string }
export type RosterRule = {
  user: { _id: string; name: string }
  color?: string
  weeklyShifts?: Shift[]
  workingHours?: { days?: number[]; start?: string; end?: string }
}

const NAVY = '#1B2238'
const GAP_BG = '#FBE5E5'
const GAP_FG = '#D9534F'
const LINE = '#D9DCE3'
const PALETTE = ['#1B2238', '#7B4BBF', '#3E8E6E', '#C2410C', '#0E7490', '#B91C77']

// Monday first, as the calendar reads. Values are Date.getDay() numbers.
const WEEK = [['MONDAY', 1], ['TUESDAY', 2], ['WEDNESDAY', 3], ['THURSDAY', 4], ['FRIDAY', 5], ['SATURDAY', 6], ['SUNDAY', 0]] as const
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const clock = (v?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 || h === 24 ? 'AM' : 'PM'}`
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`

/** The name on the calendar: "Mohamed Emad" is EMAD, as the team says it. */
export function shortName(name: string) {
  const words = String(name || '').trim().split(/\s+/)
  const first = /^m[ou]hamm?e?d$/i.test(words[0] || '') && words[1] ? words[1] : words[0]
  return (first || '').toUpperCase()
}

/** Same rule the server routes by (services/leadRouting.js onRosterShift). */
function onShift(rule: RosterRule, day: number, minute: number) {
  const shifts = rule.weeklyShifts ?? []
  if (shifts.length) {
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

/** The longest stretch of the week with nobody on, wrapping Sunday into Monday. */
function longestGap(rules: RosterRule[]) {
  const slots: boolean[] = []
  for (const [, day] of WEEK) for (const h of HOURS) slots.push(rules.some((r) => onShift(r, day, h * 60)))
  if (slots.every((x) => !x)) return null
  let best = { len: 0, from: 0 }
  const n = slots.length
  for (let i = 0; i < n; i++) {
    if (slots[i] || !slots[(i - 1 + n) % n]) continue // start of a gap
    let len = 0
    while (!slots[(i + len) % n] && len < n) len++
    if (len > best.len) best = { len, from: i }
  }
  if (!best.len) return null
  const at = (i: number) => {
    const idx = ((i % n) + n) % n
    return `${DAY_NAME[WEEK[Math.floor(idx / 24)][1]]} ${hourLabel(idx % 24)}`
  }
  return `${at(best.from)} - ${at(best.from + best.len)} = ${best.len} continuous hours without human lead coverage`
}

/* The Purplebox coverage calendar, as reviewed: matched to reps by name. */
const PRESET: { match: RegExp; color: string; days: number[]; start: string; end: string }[] = [
  { match: /emad/i, color: '#1B2238', days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '16:00' },
  { match: /randa/i, color: '#7B4BBF', days: [1, 2, 4, 5, 6, 0], start: '10:00', end: '18:00' },
  { match: /mahmoud/i, color: '#3E8E6E', days: [1, 2, 3, 4, 5, 0], start: '15:00', end: '22:00' },
]

type Draft = Record<string, { color: string; shifts: Record<number, { start: string; end: string } | null> }>

function draftFrom(rules: RosterRule[]): Draft {
  const out: Draft = {}
  rules.forEach((r, i) => {
    const shifts: Draft[string]['shifts'] = {}
    for (const [, day] of WEEK) shifts[day] = null
    if (r.weeklyShifts?.length) {
      for (const sh of r.weeklyShifts) shifts[sh.day] = { start: sh.start, end: sh.end }
    } else if (r.workingHours?.start && r.workingHours?.end) {
      // Today's single shift, shown per day so it can be edited day by day.
      const days = r.workingHours.days?.length ? r.workingHours.days : WEEK.map(([, d]) => d)
      for (const d of days) shifts[d] = { start: r.workingHours.start, end: r.workingHours.end }
    }
    out[r.user._id] = { color: r.color || PALETTE[i % PALETTE.length], shifts }
  })
  return out
}

const toRule = (r: RosterRule, d: Draft[string]): RosterRule => ({
  ...r,
  color: d.color,
  weeklyShifts: Object.entries(d.shifts).filter(([, v]) => v).map(([day, v]) => ({ day: Number(day), start: v!.start, end: v!.end })),
})

export default function CoverageCalendar({ rules, saving, onSave }: {
  rules: RosterRule[]
  saving: boolean
  onSave: (changes: { userId: string; color: string; weeklyShifts: Shift[] }[]) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rules))
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setDraft(draftFrom(rules)) }, [rules, dirty])

  const shown = useMemo(() => rules.map((r) => (draft[r.user._id] ? toRule(r, draft[r.user._id]) : r)), [rules, draft])
  const gap = useMemo(() => longestGap(shown), [shown])

  const edit = (userId: string, fn: (d: Draft[string]) => Draft[string]) => {
    setDraft((prev) => ({ ...prev, [userId]: fn(prev[userId]) }))
    setDirty(true)
  }

  const applyPreset = () => {
    setDraft((prev) => {
      const next = { ...prev }
      for (const r of rules) {
        const p = PRESET.find((x) => x.match.test(r.user.name))
        if (!p) continue
        const shifts: Draft[string]['shifts'] = {}
        for (const [, day] of WEEK) shifts[day] = p.days.includes(day) ? { start: p.start, end: p.end } : null
        next[r.user._id] = { color: p.color, shifts }
      }
      return next
    })
    setDirty(true)
  }

  const cellBase = { borderRight: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, height: 26, padding: 0 } as const

  return (
    <Card>
      <CardHeader
        title="Purplebox - Weekly Lead Coverage Calendar"
        subtitle="Who takes new leads, hour by hour. Leads are only distributed to whoever is on here; a GAP is out of hours."
      />
      <CardBody className="space-y-4">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2" style={{ fontSize: 12.5 }}>
          {rules.map((r) => (
            <span key={r.user._id} className="inline-flex items-center gap-2">
              <span style={{ width: 14, height: 14, borderRadius: 3, background: draft[r.user._id]?.color }} />
              {r.user.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-2" style={{ fontWeight: 700 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: GAP_FG }} /> NO COVERAGE
          </span>
        </div>

        {/* The calendar */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', border: `1px solid ${LINE}`, tableLayout: 'fixed' }}>
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
                <tr key={h} style={h === 8 || h === 18 || h === 22 ? { borderTop: `2px solid #9AA0AE` } : undefined}>
                  <td style={{ ...cellBase, fontSize: 11, color: '#374151', textAlign: 'center', background: '#fff' }}>{hourLabel(h)}</td>
                  {WEEK.map(([label, day]) => {
                    const on = shown.filter((r) => onShift(r, day, h * 60))
                    if (!on.length) {
                      return (
                        <td key={label} style={{ ...cellBase, background: GAP_BG, color: GAP_FG, fontSize: 9.5, fontWeight: 600, textAlign: 'center' }}>GAP</td>
                      )
                    }
                    return (
                      <td key={label} style={cellBase}>
                        <div style={{ display: 'flex', height: '100%' }}>
                          {on.map((r) => (
                            <div key={r.user._id} title={`${r.user.name} · ${DAY_NAME[day]} ${hourLabel(h)}`}
                              style={{
                                flex: 1, background: draft[r.user._id]?.color || NAVY, color: '#fff',
                                fontSize: on.length > 2 ? 8.5 : 10, fontWeight: 700, display: 'flex',
                                alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                                borderLeft: '1px solid rgba(255,255,255,.35)',
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
          <span style={{ fontWeight: 700, color: '#111827' }}>{gap ? `Key gap: ${gap}.` : 'Covered around the clock.'}</span>
          <span style={{ color: '#6B7280' }}>Purplebox | Lead Distribution Schedule</span>
        </div>

        {/* The roster that drives it */}
        <div className="rounded-lg" style={{ border: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#F6F7F9' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>Rep</th>
                {WEEK.map(([label]) => <th key={label} style={{ padding: '8px 4px', fontSize: 11 }}>{label.slice(0, 3)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const d = draft[r.user._id]
                if (!d) return null
                return (
                  <tr key={r.user._id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="color" value={d.color} onChange={(e) => edit(r.user._id, (x) => ({ ...x, color: e.target.value }))}
                          style={{ width: 22, height: 22, border: 'none', padding: 0, background: 'none', cursor: 'pointer' }} />
                        <span style={{ fontWeight: 600 }}>{r.user.name}</span>
                      </label>
                    </td>
                    {WEEK.map(([label, day]) => {
                      const sh = d.shifts[day]
                      const set = (v: { start: string; end: string } | null) => edit(r.user._id, (x) => ({ ...x, shifts: { ...x.shifts, [day]: v } }))
                      return (
                        <td key={label} style={{ padding: '6px 4px', textAlign: 'center' }}>
                          {sh ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <select value={sh.start} onChange={(e) => set({ ...sh, start: e.target.value })} style={{ fontSize: 11.5 }}>
                                {HOURS.map((h) => <option key={h} value={pad(h)}>{hourLabel(h)}</option>)}
                              </select>
                              <select value={sh.end} onChange={(e) => set({ ...sh, end: e.target.value })} style={{ fontSize: 11.5 }}>
                                {[...HOURS.slice(1), 24].map((h) => <option key={h} value={pad(h)}>{h === 24 ? '12:00 AM' : hourLabel(h)}</option>)}
                              </select>
                              <button type="button" onClick={() => set(null)} style={{ fontSize: 10.5, color: GAP_FG, cursor: 'pointer', background: 'none', border: 'none' }}>Day off</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => set({ start: '09:00', end: '18:00' })}
                              style={{ fontSize: 11, color: '#6B7280', cursor: 'pointer', background: 'none', border: `1px dashed ${LINE}`, borderRadius: 6, padding: '4px 8px' }}>
                              Off · add
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!dirty || saving}
            onClick={() => {
              onSave(rules.filter((r) => draft[r.user._id]).map((r) => {
                const x = toRule(r, draft[r.user._id])
                return { userId: r.user._id, color: x.color || '', weeklyShifts: x.weeklyShifts || [] }
              }))
              setDirty(false)
            }}
          >
            {saving ? 'Saving…' : 'Save roster'}
          </Button>
          {dirty && <Button variant="outline" disabled={saving} onClick={() => { setDraft(draftFrom(rules)); setDirty(false) }}>Discard changes</Button>}
          <Button variant="outline" disabled={saving} onClick={applyPreset}>Fill from coverage calendar</Button>
          <span style={{ fontSize: 12, color: '#6B7280' }}>
            Times are Dubai time. A shift ending before it starts runs past midnight. Leads arriving in a GAP follow the out-of-hours setting below.
          </span>
        </div>
      </CardBody>
    </Card>
  )
}
