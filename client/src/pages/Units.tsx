import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ArrowDown, ArrowRight, ArrowUp, CalendarRange, ChevronsUpDown, Database,
  LayoutGrid, Rows3, Search, ShieldCheck, Sparkles,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useSite, unitInSite, type Site } from '../lib/site'
import type { Unit, Contract } from '../lib/types'
import { Badge, Card, EmptyState, Spinner, Table, Td, Th, statusLabel, unitStatusTone } from '../components/ui'
import { compareUnitNumbers, formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const
const FONT = "'Manrope', system-ui, sans-serif"
const PAGE = '#FBF8F2'
const INK = '#14081F'
const MUTED = '#756E80'
const SECONDARY = '#4A4357'
const PURPLE = '#5B2BC9'
const DEEP = '#4A1FA0'
const LINE = 'rgba(20,8,31,0.10)'
const TRACK = '#EDE3CF'
const CARD_SHADOW = '0 1px 2px rgba(20,8,31,.06), 0 2px 8px rgba(20,8,31,.04)'

/* Prices here are whole dirhams — 1,300 not 1,300.00. The decimals are noise on
   a card being scanned, and every unit price is a round figure anyway. */
const wholeAed = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })


const GREEN = '#22c55e'
const AMBER = '#D98A1A'

/* How free a unit is across the *chosen window* — deliberately not the same
   thing as Unit.status, which only describes today. */
type AvailState = 'free' | 'partial' | 'taken' | 'maintenance'

const STATE_STYLE: Record<AvailState, { bg: string; border: string; dot: string; text: string }> = {
  free: { bg: '#F3FBF6', border: '#BBEBCD', dot: GREEN, text: '#1D8A46' },
  partial: { bg: '#FEF9F0', border: '#F5DFB8', dot: AMBER, text: '#B45309' },
  taken: { bg: '#F4F0FF', border: '#DDD0FF', dot: PURPLE, text: DEEP },
  maintenance: { bg: '#F5F4F6', border: 'rgba(20,8,31,.12)', dot: MUTED, text: MUTED },
}
const STATE_RANK: Record<AvailState, number> = { free: 0, partial: 1, taken: 2, maintenance: 3 }

/* ── Dates ──────────────────────────────────────────────────────────────
   Everything here works on plain `YYYY-MM-DD` strings so a window never
   drifts by a timezone hour. Booking dates arrive as ISO datetimes, so they
   are sliced to their date part before comparing. */
const DAY_MS = 86_400_000
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const addDays = (s: string, n: number) => {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}
const daysBetween = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DAY_MS)
const dayOnly = (s?: string | null) => (s ? String(s).slice(0, 10) : '')
const shortDate = (s: string) => fromISO(dayOnly(s)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/* ── Plain-English phrase parser ────────────────────────────────────────
   There is no language model in this project. This is a deterministic
   pattern reader: it recognises a fixed vocabulary of date, size and floor
   phrasings and turns them into the same filters the form above sets.
   Anything it does not recognise is reported, never silently dropped. */

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_WORD = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/

type Parsed = {
  from: string | null
  to: string | null
  size: number | null
  floor: string | null
  problems: string[]
}

function parsePhrase(input: string, sizes: number[], floors: string[]): Parsed {
  const out: Parsed = { from: null, to: null, size: null, floor: null, problems: [] }
  const text = ` ${input.toLowerCase().replace(/[,/]/g, ' ').replace(/\s+/g, ' ')} `
  if (!input.trim()) return out

  const now = new Date()
  const today = toISO(now)
  const thisYear = now.getFullYear()

  /* explicit dates, in the order they appear */
  const hits: { at: number; iso: string }[] = []
  const add = (at: number, y: number, mo: number, d: number, assumedYear: boolean) => {
    const dt = new Date(y, mo, d)
    if (dt.getMonth() !== mo || dt.getDate() !== d) return
    let iso = toISO(dt)
    // A bare "3 Oct" that already passed this year means next year.
    if (assumedYear && iso < today) iso = toISO(new Date(y + 1, mo, d))
    hits.push({ at, iso })
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(m.index, +m[1], +m[2] - 1, +m[3], false)
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/g)) {
    const mo = MON.indexOf(m[2].slice(0, 3))
    if (mo < 0) continue
    add(m.index, m[3] ? +m[3] : thisYear, mo, +m[1], !m[3])
  }
  for (const m of text.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/g)) {
    const mo = MON.indexOf(m[1].slice(0, 3))
    if (mo < 0) continue
    add(m.index, m[3] ? +m[3] : thisYear, mo, +m[2], !m[3])
  }
  const dates = [...new Map(hits.map((h) => [h.iso, h])).values()].sort((a, b) => a.at - b.at)
  if (dates.length >= 2) {
    const [a, b] = [dates[0].iso, dates[1].iso].sort()
    out.from = a
    out.to = b
  } else if (dates.length === 1) {
    out.from = dates[0].iso
  }

  /* "in N days/weeks/months" is an offset; anything else is a length */
  let work = text
  const offset = work.match(/\bin\s+(\d{1,3})\s*(day|week|month)s?\b/)
  if (offset) work = work.replace(offset[0], ' ')
  const unitDays = (u: string) => (u === 'day' ? 1 : u === 'week' ? 7 : 28) // a month is 28 days here
  const durM = work.match(/\bfor\s+(\d{1,3})\s*(day|week|month)s?\b/) || work.match(/\b(\d{1,3})\s*(day|week|month)s?\b/)
  const durDays = durM ? Math.min(730, +durM[1] * unitDays(durM[2])) : null

  const dow = now.getDay()
  if (!out.from) {
    if (/\b(this|next|the) weekend\b/.test(text) || /\bweekend\b/.test(text)) {
      // The next Saturday to arrive; if it is already the weekend, the following one.
      let sat = addDays(today, (6 - dow + 7) % 7)
      if (dow === 6 || dow === 0) sat = addDays(today, dow === 6 ? 7 : 6)
      out.from = sat
      out.to = addDays(sat, 1)
    } else if (/\bnext week\b/.test(text)) {
      const mon = addDays(today, (8 - dow) % 7 || 7)
      out.from = mon
      out.to = addDays(mon, 6)
    } else if (/\bnext month\b/.test(text)) {
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      out.from = toISO(first)
      out.to = toISO(new Date(now.getFullYear(), now.getMonth() + 2, 0))
    } else if (/\bthis month\b/.test(text)) {
      out.from = today
      out.to = toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    } else if (/\btomorrow\b/.test(text)) {
      out.from = addDays(today, 1)
    } else if (/\b(today|now|asap|straight away|right away)\b/.test(text)) {
      out.from = today
    } else if (offset) {
      out.from = addDays(today, +offset[1] * unitDays(offset[2]))
    } else {
      const mw = text.match(MONTH_WORD)
      if (mw) {
        const mo = MON.indexOf(mw[1].slice(0, 3))
        let y = thisYear
        if (toISO(new Date(y, mo + 1, 0)) < today) y += 1
        out.from = toISO(new Date(y, mo, 1))
        out.to = toISO(new Date(y, mo + 1, 0))
      }
    }
  }

  // "for 2 months" with no start named means starting now.
  if (!out.from && durDays) {
    out.from = today
    out.problems.push('No start date in that phrase — assumed it starts today.')
  }
  if (out.from && durDays) out.to = addDays(out.from, durDays)
  if (out.from && !out.to) {
    out.to = addDays(out.from, 28)
    out.problems.push('No length in that phrase — assumed a 28-day stay.')
  }
  if (!out.from) out.problems.push('Could not read a date from that.')

  /* size */
  const sq = text.match(/\b(\d{1,4})\s*(?:sq\.?\s*ft|sqft|sqf|square\s*(?:feet|foot|ft))\b/)
  if (sq && sizes.length) {
    const want = +sq[1]
    if (sizes.includes(want)) out.size = want
    else {
      const near = sizes.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), sizes[0])
      out.size = near
      out.problems.push(`No ${want} sq ft units here — used the closest size, ${near} sq ft.`)
    }
  } else if (sq && !sizes.length) {
    out.problems.push('No unit sizes are recorded, so the size in that phrase was ignored.')
  } else if (sizes.length) {
    if (/\b(small|smallest|tiny|compact)\b/.test(text)) out.size = sizes[0]
    else if (/\b(large|largest|big|biggest|huge)\b/.test(text)) out.size = sizes[sizes.length - 1]
    else if (/\b(medium|mid|mid-?size|average)\b/.test(text)) out.size = sizes[Math.floor((sizes.length - 1) / 2)]
  }

  /* floor */
  let floor: string | null = null
  const fm = text.match(/\bf\s?-?\s?([1-9])\b/) || text.match(/\bfloor\s*([1-9])\b/) || text.match(/\b([1-9])(?:st|nd|rd|th)?\s+floor\b/)
  if (fm) floor = `F${fm[1]}`
  else if (/\bfirst floor\b/.test(text)) floor = 'F1'
  else if (/\bsecond floor\b/.test(text)) floor = 'F2'
  else if (/\bthird floor\b/.test(text)) floor = 'F3'
  else if (/\bshed\b/.test(text)) floor = 'Shed'
  else if (/\bground\b/.test(text)) floor = 'F1'
  if (floor) {
    if (floors.includes(floor)) out.floor = floor
    else out.problems.push(`There is no floor ${floor} in this site.`)
  }

  if (!out.from && !out.size && !out.floor) out.problems.push('Nothing else in that phrase was recognised either.')
  return out
}

/* Small shared bits of the new layout */
const labelStyle = { fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 6 } as const
const controlStyle = {
  height: 40, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff',
  padding: '0 10px', fontSize: 13, color: INK, outline: 'none', fontFamily: FONT,
} as const

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

export default function Units() {
  // Sales reps and accounts can look units up. Changing the inventory is an
  // admin setup job and lives in Settings → Unit Pricing, so this page only
  // points admins at it.
  const { user } = useAuth()
  const canEditUnits = user?.role === 'admin'
  const [view, setView] = useState<'list' | 'timeline' | 'table'>('list')
  const [statusFilter, setStatusFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Unit | null>(null)
  const [onlyFree, setOnlyFree] = useState(false)

  // "Free between these dates" — a unit occupied today may be free later if
  // its contract ends in the window, and vice versa, so this cannot be derived
  // from the current status.
  const [availFrom, setAvailFrom] = useState(() => toISO(new Date()))
  const [availTo, setAvailTo] = useState(() => addDays(toISO(new Date()), 28))
  const [windowTouched, setWindowTouched] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [phrase, setPhrase] = useState('')

  const today = useMemo(() => toISO(new Date()), [])
  const rangeInvalid = Boolean(availFrom && availTo && availTo <= availFrom)
  const usingDefaultWindow = !windowTouched
  // With no dates chosen the page still has to be useful, so it looks at the
  // next 28 days by default.
  const winFrom = rangeInvalid ? today : (availFrom || today)
  const winTo = rangeInvalid ? addDays(today, 28) : (availTo || addDays(availFrom || today, 28))

  type Booking = { kind: string; ref: string; customer: string; startDate: string; endDate: string; status: string }
  type AvailUnit = { _id: string; bookedInPeriod?: boolean; bookings?: Booking[] }
  const availability = useQuery<AvailUnit[]>({
    queryKey: ['unit-availability', winFrom, winTo],
    // `all=true` returns every unit flagged, not only the ones free today.
    queryFn: () => api
      .get('/quotes/available-units', { params: { from: winFrom, to: winTo, all: 'true' } })
      .then((r) => r.data ?? []),
    enabled: !rangeInvalid,
    staleTime: 60_000,
  })

  const bookedInWindow = useMemo(() => {
    const m = new Map<string, AvailUnit>()
    for (const u of availability.data ?? []) m.set(u._id, u)
    return m
  }, [availability.data])

  // Table sorting. Default is the natural unit order; clicking a header sorts
  // by that column, clicking again reverses it.
  type SortKey = 'unit' | 'floor' | 'size' | 'price' | 'tenant' | 'checkout' | 'status' | 'shared'
  const [sortKey, setSortKey] = useState<SortKey>('unit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  const { data: allSiteUnits, isLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })

  // Who holds each unit right now. A shared unit can carry several active
  // contracts, so this is a list per unit, not a single tenant.
  type UnitActiveContract = { contractId: string; contractNo: string; customerName: string; endDate: string | null }
  const { data: activeByUnit = {} } = useQuery<Record<string, UnitActiveContract[]>>({
    queryKey: ['unit-active-contracts'],
    queryFn: () => api.get('/units/active-contracts').then((r) => r.data?.byUnit ?? {}),
    staleTime: 60_000,
  })

  // Scope to the selected site (units without a site belong to the default site)
  const { siteId } = useSite()
  const { data: sitesList = [] } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then((r) => r.data),
  })
  const units = useMemo(
    () => (allSiteUnits || []).filter((u) => unitInSite((u as Unit & { site?: string | null }).site, siteId, sitesList)),
    [allSiteUnits, siteId, sitesList],
  )

  // A unit with no site of its own belongs to the default site.
  const siteNameOf = (u: Unit) => {
    const raw = (u as Unit & { site?: string | { _id: string; name?: string } | null }).site
    if (raw && typeof raw === 'object') return raw.name || sitesList.find((s) => s._id === raw._id)?.name || '—'
    const id = raw ?? sitesList.find((s) => s.isDefault)?._id
    return sitesList.find((s) => s._id === id)?.name || '—'
  }

  // The size and floor dropdowns are built from the data, not a fixed list.
  const sizes = useMemo(
    () => [...new Set((units || []).map((u) => u.sizeSqf).filter((s): s is number => s != null))].sort((a, b) => a - b),
    [units],
  )
  const floors = useMemo(() => [...new Set((units || []).map((u) => u.floor).filter(Boolean))].sort(), [units])

  /* How free a unit is across the chosen window. This is worked out from the
     bookings that overlap the window — never from Unit.status, which only
     describes today and would hide exactly the cases this page exists for. */
  const availOf = useMemo(() => {
    return (u: Unit): { state: AvailState; line: string; detail: string } => {
      if (u.status === 'maintenance') {
        return { state: 'maintenance', line: 'Maintenance', detail: u.notes?.trim() || 'Out of service' }
      }
      const bookings = bookedInWindow.get(u._id)?.bookings ?? []
      // Clip every overlapping booking to the window, then merge the ones that
      // touch, so a back-to-back pair does not read as a gap.
      const spans = bookings
        .map((b) => ({ b, s: dayOnly(b.startDate), e: dayOnly(b.endDate) }))
        .filter((x) => x.s && x.e && x.s <= winTo && x.e >= winFrom)
        .map((x) => ({ b: x.b, s: x.s < winFrom ? winFrom : x.s, e: x.e > winTo ? winTo : x.e }))
        .sort((a, b) => a.s.localeCompare(b.s))

      if (!spans.length) {
        return { state: 'free', line: 'Free entire window', detail: `${shortDate(winFrom)} – ${shortDate(winTo)}` }
      }

      const merged: { s: string; e: string }[] = []
      for (const sp of spans) {
        const last = merged[merged.length - 1]
        if (last && sp.s <= addDays(last.e, 1)) { if (sp.e > last.e) last.e = sp.e }
        else merged.push({ s: sp.s, e: sp.e })
      }

      const coversAll = merged.length === 1 && merged[0].s <= winFrom && merged[0].e >= winTo
      if (coversAll) {
        // Name the tenant from the booking that runs longest into the future,
        // preferring a contract over a quote hold.
        const ranked = [...spans].sort((a, b) =>
          (a.b.kind === 'quote' ? 1 : 0) - (b.b.kind === 'quote' ? 1 : 0) ||
          dayOnly(b.b.endDate).localeCompare(dayOnly(a.b.endDate)))
        const lead = ranked[0]?.b
        const who = lead?.customer || (activeByUnit[u._id] ?? [])[0]?.customerName || lead?.ref || ''
        const until = dayOnly(lead?.endDate) || dayOnly((activeByUnit[u._id] ?? [])[0]?.endDate)
        return {
          state: 'taken',
          line: 'Occupied entire window',
          detail: who && until ? `${who} · until ${shortDate(until)}`
            : who ? who
            : until ? `Until ${shortDate(until)}`
            : 'Booked for the whole window',
        }
      }

      if (merged[0].s > winFrom) {
        return {
          state: 'partial',
          line: `Free until ${shortDate(addDays(merged[0].s, -1))}`,
          detail: merged.length > 1
            ? `Then occupied across ${merged.length} periods`
            : 'Then occupied for part of the window',
        }
      }
      return {
        state: 'partial',
        line: `Free from ${shortDate(addDays(merged[0].e, 1))}`,
        detail: merged.length > 1
          ? 'Occupied at the start, and again later in the window'
          : 'Occupied at the start of the window',
      }
    }
  }, [bookedInWindow, winFrom, winTo, activeByUnit])

  const filtered = useMemo(
    () =>
      (units || [])
        .filter(
          (u) =>
            (!statusFilter || u.status === statusFilter) &&
            (!floorFilter || u.floor === floorFilter) &&
            (!sizeFilter || u.sizeSqf === Number(sizeFilter)) &&
            (!search || u.unitNumber.toLowerCase().includes(search.toLowerCase()) || String(u.sizeSqf ?? '') === search)
        )
        .sort(compareUnitNumbers),
    [units, statusFilter, floorFilter, sizeFilter, search]
  )

  // Units genuinely free for the whole window. Maintenance units are never
  // bookable, whatever the contracts say.
  const freeUnits = useMemo(() => filtered.filter((u) => availOf(u).state === 'free'), [filtered, availOf])
  // "Only free units" narrows every view; off by default so the colour-coded
  // cards can show the whole picture. What can be sold sorts first.
  const shown = useMemo(() => {
    const list = onlyFree ? freeUnits : filtered
    return [...list].sort((a, b) =>
      STATE_RANK[availOf(a).state] - STATE_RANK[availOf(b).state] || compareUnitNumbers(a, b))
  }, [onlyFree, freeUnits, filtered, availOf])

  // Sorted view for the table.
  const sortedRows = useMemo(() => {
    // Tenant and check-out come from the active contracts, so a unit with
    // none has no value to sort on; those sort last in both directions rather
    // than jumping to the top on a descending sort.
    const firstContract = (u: Unit) => (activeByUnit[u._id] ?? [])[0]
    const dir = sortDir === 'asc' ? 1 : -1
    const text = (v?: string | null) => (v ?? '').toLowerCase()

    const cmp = (a: Unit, b: Unit): number => {
      switch (sortKey) {
        case 'floor': return text(a.floor).localeCompare(text(b.floor)) || compareUnitNumbers(a, b)
        case 'size': return (a.sizeSqf ?? -1) - (b.sizeSqf ?? -1)
        case 'price': return (a.price ?? -1) - (b.price ?? -1)
        case 'status': return text(a.status).localeCompare(text(b.status))
        case 'shared': return Number(Boolean(a.shared)) - Number(Boolean(b.shared))
        case 'tenant': {
          const ta = text(firstContract(a)?.customerName)
          const tb = text(firstContract(b)?.customerName)
          if (!ta && !tb) return 0
          if (!ta) return 1 * dir   // cancels the dir applied below: always last
          if (!tb) return -1 * dir
          return ta.localeCompare(tb)
        }
        case 'checkout': {
          const da = firstContract(a)?.endDate
          const db = firstContract(b)?.endDate
          if (!da && !db) return 0
          if (!da) return 1 * dir
          if (!db) return -1 * dir
          return new Date(da).getTime() - new Date(db).getTime()
        }
        default: return compareUnitNumbers(a, b)
      }
    }
    return [...shown].sort((a, b) => cmp(a, b) * dir || compareUnitNumbers(a, b))
  }, [shown, sortKey, sortDir, activeByUnit])

  /* Timeline span: 28 days, starting at today or at the window start if that
     is earlier, and stretched if the chosen window runs past the 28th day so
     the shaded band is always visible. */
  const tlStart = winFrom < today ? winFrom : today
  const tlDays = Math.max(28, daysBetween(tlStart, winTo) + 1)
  const pct = (isoDate: string) => (daysBetween(tlStart, isoDate) / tlDays) * 100
  const clamp = (n: number) => Math.max(0, Math.min(100, n))

  // The built-in reader runs instantly on every keystroke and is what the
  // chips show while typing. Asking the model is a deliberate step, so a
  // key is not spent on every character typed.
  const localParsed = useMemo(() => parsePhrase(phrase, sizes, floors), [phrase, sizes, floors])
  const [aiParsed, setAiParsed] = useState<Parsed | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const parsed = aiParsed ?? localParsed

  // Clear a model reading as soon as the phrase changes, or the chips would
  // describe a sentence that is no longer on screen.
  useEffect(() => { setAiParsed(null) }, [phrase])

  const { data: integrationStatus } = useQuery<{ openai?: { configured: boolean; model: string } }>({
    queryKey: ['integrations-status'],
    queryFn: () => api.get('/integrations/status').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const aiConfigured = Boolean(integrationStatus?.openai?.configured)

  async function askAi() {
    if (!phrase.trim()) return
    setAiBusy(true)
    try {
      const r = await api.post('/integrations/ai/parse-availability', {
        text: phrase, sizes, floors,
      }).then((x) => x.data)
      const f = r?.filters ?? {}
      setAiParsed({
        from: f.from ?? null,
        to: f.to ?? null,
        size: f.sizeSqf ?? null,
        floor: f.floor ?? null,
        problems: [r?.unreadable, `Read by ${r?.model || 'the model'}`].filter(Boolean) as string[],
      })
    } catch (e) {
      // Fall back to the built-in reader rather than leaving the user stuck.
      setAiParsed({
        ...localParsed,
        problems: [...localParsed.problems, `Could not reach the model (${apiError(e)}) — read here instead`],
      })
    } finally {
      setAiBusy(false)
    }
  }

  function applyParsed() {
    if (parsed.from && parsed.to) { setAvailFrom(parsed.from); setAvailTo(parsed.to) }
    if (parsed.size != null) setSizeFilter(String(parsed.size))
    if (parsed.floor) setFloorFilter(parsed.floor)
  }

  const windowLabel = `${formatDate(winFrom)} – ${formatDate(winTo)}${usingDefaultWindow ? ' (next 28 days, by default)' : ''}`

  if (isLoading) return <Spinner />

  return (
    // No outer padding or max-width: the app layout already wraps every page
    // in p-3 sm:p-4.
    <div style={{ background: PAGE, fontFamily: FONT, color: INK }}>
      {/* The page sits on one rounded white card, matching Contracts and the
          contract detail page. The slide-over and modal stay outside it —
          they are fixed overlays. */}
      <div
        className="p-5 sm:p-7"
        style={{
          background: '#fff',
          border: '1px solid rgba(20,8,31,0.10)',
          borderRadius: 24,
          boxShadow: '0 1px 2px rgba(20,8,31,.05), 0 2px 8px rgba(20,8,31,.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: DEEP }}>
            PurpleBox · Operations
          </div>
          <h1 style={{ ...HEADING, fontWeight: 700, fontSize: 36, margin: '6px 0 0' }}>Unit availability</h1>
          <p style={{ fontSize: 14, color: SECONDARY, marginTop: 6 }}>
            Units free for a chosen window — contracts, tenancies and sent quotes all counted.
          </p>
        </div>
        {/* The phrase box sits up here — it is how you start. The unit search
            stays down with the other filters, where it belongs. */}
        <div className="flex flex-wrap items-center gap-2" style={{ flexShrink: 0 }}>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            data-tour="units-phrase"
            placeholder='e.g. "a small unit on F2 for 3 weeks from 1 Oct"'
            style={{ height: 40, borderRadius: 10, border: `1px solid ${LINE}`, background: PAGE, padding: '0 12px', fontSize: 13, color: INK, minWidth: 300, flex: '1 1 300px' }}
          />
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            style={{ height: 40, borderRadius: 999, background: '#fff', border: `1px solid ${PURPLE}`, color: PURPLE, fontSize: 13, fontWeight: 600, padding: '0 16px', flexShrink: 0 }}
            className="flex items-center gap-1.5 hover:bg-violet-50 transition"
          >
            <Sparkles size={15} /> Ask PurpleBox AI
          </button>
        </div>
      </div>

      {/* Phrase reader */}
      {askOpen && (
        <div style={{ background: PAGE, border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px' }}>
          <p style={{ fontSize: 11.5, color: MUTED }}>
            Type the request in the box beside <strong>Ask PurpleBox AI</strong> above. A phrase
            reader in your browser interprets it; <strong>Ask the model</strong> sends it to
            OpenAI instead. It recognises a
            fixed set of wordings — dates ("today", "next week", "in 2 weeks", "for 3 months",
            "1 Oct", "2026-10-01"), sizes ("small", "large", "50 sq ft") and floors ("F2",
            "first floor", "shed").
          </p>
          {phrase.trim() && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginTop: 12, marginBottom: 6 }}>Read as:</div>
              <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                {parsed.from && parsed.to && (
                  <span style={{ background: '#EDE9FE', color: DEEP, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600 }}>
                    {formatDate(parsed.from)} → {formatDate(parsed.to)}
                  </span>
                )}
                {parsed.size != null && (
                  <span style={{ background: '#EDE9FE', color: DEEP, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600 }}>
                    {parsed.size} sq ft
                  </span>
                )}
                {parsed.floor && (
                  <span style={{ background: '#EDE9FE', color: DEEP, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600 }}>
                    Floor {parsed.floor}
                  </span>
                )}
                {parsed.problems.map((p) => (
                  <span key={p} style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 999, padding: '5px 12px', fontSize: 12.5 }}>
                    {p}
                  </span>
                ))}
                {aiConfigured && (
                  <button
                    type="button"
                    onClick={askAi}
                    disabled={aiBusy}
                    title="Send this phrase to the language model for a second reading"
                    style={{ height: 32, borderRadius: 999, background: 'transparent', color: DEEP, border: `1px solid ${DEEP}33`, fontSize: 12.5, fontWeight: 600, padding: '0 14px', opacity: aiBusy ? 0.5 : 1 }}
                  >
                    {aiBusy ? 'Asking…' : 'Ask the model'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={applyParsed}
                  disabled={!parsed.from && parsed.size == null && !parsed.floor}
                  style={{ height: 32, borderRadius: 999, background: PURPLE, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '0 14px', opacity: (!parsed.from && parsed.size == null && !parsed.floor) ? 0.4 : 1 }}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Search card ────────────────────────────────────────────── */}
      {/* Tinted: a white panel on the white page card would have no edge. */}
      <div data-tour="units-search-card" style={{ background: PAGE, border: `1px solid ${LINE}`, borderRadius: 18, padding: '22px 24px' }}>
        <div className="flex flex-wrap" style={{ gap: 16, alignItems: 'end' }}>
          <Control label="Free from">
            <input type="date" value={availFrom} max={availTo || undefined}
              onChange={(e) => { setAvailFrom(e.target.value); setWindowTouched(true) }} style={controlStyle} />
          </Control>
          <ArrowRight size={16} color={MUTED} style={{ marginBottom: 12 }} />
          <Control label="Until">
            <input type="date" value={availTo} min={availFrom || undefined}
              onChange={(e) => { setAvailTo(e.target.value); setWindowTouched(true) }} style={controlStyle} />
          </Control>
          <Control label="Floor">
            <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} style={{ ...controlStyle, minWidth: 120 }}>
              <option value="">All floors</option>
              {floors.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Control>
          <Control label="Size">
            <select value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} style={{ ...controlStyle, minWidth: 120 }}>
              <option value="">Any size</option>
              {sizes.map((s) => <option key={s} value={s}>{s} sq ft</option>)}
            </select>
          </Control>
          <Control label="Status">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...controlStyle, minWidth: 130 }}>
              <option value="">All statuses</option>
              {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </Control>
          <Control label="Unit number">
            <span style={{ ...controlStyle, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
              <Search size={14} color={MUTED} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit / size…"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: 130, color: INK }} />
            </span>
          </Control>

          <button
            type="button"
            onClick={() => { setOnlyFree(true); availability.refetch() }}
            title="Results update as you change the dates — this re-checks availability now and hides units that are taken."
            style={{ height: 40, borderRadius: 999, background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 600, padding: '0 18px' }}
            className="hover:brightness-110 transition"
          >
            Find available units
          </button>
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, color: SECONDARY, height: 40 }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} data-tour="units-only-free" className="h-4 w-4 rounded" />
            Only free units
          </label>
        </div>

        {(availFrom || availTo || floorFilter || sizeFilter || statusFilter || search || onlyFree) && (
          <button
            type="button"
            onClick={() => { setAvailFrom(''); setAvailTo(''); setFloorFilter(''); setSizeFilter(''); setStatusFilter(''); setSearch(''); setOnlyFree(false) }}
            style={{ marginTop: 12, fontSize: 12, color: MUTED, textDecoration: 'underline' }}
          >
            Clear all filters
          </button>
        )}

        {rangeInvalid && (
          <div className="rounded-xl px-4 py-2.5 text-[13px]" style={{ background: '#FEF3C7', color: '#92400E', marginTop: 14 }}>
            The end date must be after the start date — showing the next 28 days instead.
          </div>
        )}

      </div>

      {/* ── Results header ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div style={{ fontSize: 14, color: SECONDARY }}>
          {availability.isLoading ? (
            'Checking availability…'
          ) : availability.isError ? (
            <span style={{ color: '#92400E' }}>Could not check availability for those dates.</span>
          ) : (
            <>
              <strong style={{ color: INK, fontWeight: 700 }}>{freeUnits.length}</strong>
              {' '}of {filtered.length} units free for the whole window · {windowLabel}
            </>
          )}
        </div>
        <div data-tour="units-view" style={{ background: TRACK, borderRadius: 999, padding: 4 }} className="flex items-center gap-1 self-start">
          {([['list', 'List', LayoutGrid], ['timeline', 'Timeline', CalendarRange], ['table', 'Table', Rows3]] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                height: 30, borderRadius: 999, padding: '0 14px', fontSize: 12.5, fontWeight: 600,
                background: view === v ? '#fff' : 'transparent',
                color: view === v ? INK : SECONDARY,
                boxShadow: view === v ? '0 1px 2px rgba(20,8,31,.10)' : 'none',
              }}
              className="flex items-center gap-1.5 transition"
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── List view ──────────────────────────────────────────────── */}
      {view === 'list' && (
        <div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {shown.map((u) => {
              const a = availOf(u)
              const s = STATE_STYLE[a.state]
              return (
                <button
                  key={u._id}
                  onClick={() => setSelected(u)}
                  title={u.notes}
                  style={{
                    position: 'relative', textAlign: 'left', background: s.bg,
                    border: `1px solid ${s.border}`,
                    borderRadius: 16, padding: '16px 18px', boxShadow: CARD_SHADOW, cursor: 'pointer',
                  }}
                  className="hover:-translate-y-0.5 transition-transform"
                >
                  <span style={{ position: 'absolute', top: 16, right: 16, width: 10, height: 10, borderRadius: 999, background: s.dot }} />
                  <div style={{ ...HEADING, fontWeight: 700, fontSize: 18, paddingRight: 18 }}>{u.unitNumber}</div>
                  <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
                    {u.sizeSqf != null ? `${u.sizeSqf} sqft` : 'size not set'} · Floor {u.floor}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: s.text, marginTop: 12 }}>{a.line}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 2, paddingRight: 66 }}>{a.detail}</div>

                  {/* Bottom right, in the brand purple rather than the card's
                      availability colour — the price is a different kind of
                      fact from whether the unit is free, and reading as part of
                      the green would make it look like part of the answer to
                      "is it available". */}
                  <span
                    title={u.price != null ? 'Price for 4 weeks' : 'No price set for this unit'}
                    style={{
                      position: 'absolute', bottom: 14, right: 16,
                      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                      color: u.price != null ? PURPLE : MUTED,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {u.price != null ? `AED ${wholeAed(u.price)}` : 'no price'}
                  </span>
                  {(u.discountPct || u.shared) && (
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 8 }}>
                      {u.discountPct ? <span style={{ fontSize: 10, fontWeight: 600, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '2px 8px' }}>{u.discountPct}% 1st 4wk</span> : null}
                      {u.shared ? <span style={{ fontSize: 10, fontWeight: 600, color: '#075985', background: '#E0F2FE', borderRadius: 999, padding: '2px 8px' }}>Shared</span> : null}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          {shown.length === 0 && <EmptyState message="No units match the filters." />}
        </div>
      )}

      {/* ── Timeline view ──────────────────────────────────────────── */}
      {view === 'timeline' && (
        <div style={{ background: PAGE, border: `1px solid ${LINE}`, borderRadius: 18, padding: '20px 22px' }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Showing {tlDays} days from {formatDate(tlStart)} · shaded band = your selected window
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((u) => {
              const bookings = bookedInWindow.get(u._id)?.bookings ?? []
              return (
                <div key={u._id} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'center' }}>
                  <button onClick={() => setSelected(u)} style={{ textAlign: 'left' }} className="cursor-pointer">
                    <div style={{ ...HEADING, fontWeight: 700, fontSize: 14 }}>{u.unitNumber}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{u.sizeSqf != null ? `${u.sizeSqf} sqft` : '—'}</div>
                  </button>
                  <div style={{ position: 'relative', height: 34, background: TRACK, borderRadius: 8, overflow: 'hidden' }}>
                    {/* selected window */}
                    <div
                      style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: `${clamp(pct(winFrom))}%`,
                        width: `${clamp(pct(addDays(winTo, 1))) - clamp(pct(winFrom))}%`,
                        background: 'rgba(91,43,201,0.10)',
                        borderLeft: `2px dashed ${PURPLE}`,
                        borderRight: `2px dashed ${PURPLE}`,
                      }}
                    />
                    {bookings.map((b, i) => {
                      const s = clamp(pct(dayOnly(b.startDate)))
                      const e = clamp(pct(addDays(dayOnly(b.endDate), 1)))
                      if (e <= 0 || s >= 100 || e <= s) return null
                      return (
                        <div
                          key={`${b.ref}-${i}`}
                          title={`${b.kind === 'quote' ? 'Quote' : 'Contract'} ${b.ref} · ${b.customer || 'no name'} · ${formatDate(b.startDate)} – ${formatDate(b.endDate)}`}
                          style={{
                            position: 'absolute', top: 6, bottom: 6, left: `${s}%`, width: `${Math.max(e - s, 1)}%`,
                            background: b.kind === 'quote' ? AMBER : PURPLE,
                            borderRadius: 6, opacity: 0.9,
                          }}
                        />
                      )
                    })}
                    {u.status === 'maintenance' && (
                      <div title="Under maintenance" style={{ position: 'absolute', inset: 0, background: 'rgba(117,110,128,0.35)' }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {shown.length === 0 && <EmptyState message="No units match the filters." />}
        </div>
      )}

      {/* ── Table view (unchanged columns, incl. Tenant / Check out) ── */}
      {view === 'table' && (
        <Card>
          <Table>
            <thead>
              <tr>
                {([
                  ['unit', 'Unit'], ['floor', 'Floor'], ['size', 'Size'], ['price', '4wk (AED)'],
                  ['tenant', 'Tenant'], ['checkout', 'Check out'], ['status', 'Status'], ['shared', 'Shared'],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <Th key={k}>
                    <button type="button" onClick={() => toggleSort(k)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                      title={`Sort by ${label}`}>
                      {label}
                      {sortKey === k
                        ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                        : <ChevronsUpDown size={11} className="opacity-30" />}
                    </button>
                  </Th>
                ))}
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((u) => (
                <tr key={u._id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(u)}>
                  <Td className="font-medium">{u.unitNumber}</Td>
                  <Td>{u.floor}</Td>
                  <Td>{u.sizeSqf != null ? `${u.sizeSqf} sq ft` : '—'}</Td>
                  <Td>{u.price != null ? formatMoney(u.price) : '—'}</Td>
                  <Td>
                    {(activeByUnit[u._id] ?? []).length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {activeByUnit[u._id].map((c) => (
                          <div key={c.contractId} className="truncate max-w-48" title={`${c.customerName} · ${c.contractNo}`}>
                            {c.customerName || '(no name)'}
                          </div>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {(activeByUnit[u._id] ?? []).length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {activeByUnit[u._id].map((c) => (
                          <div key={c.contractId} className="whitespace-nowrap">
                            {c.endDate ? formatDate(c.endDate) : '—'}
                          </div>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td><Badge tone={unitStatusTone[u.status]}>{statusLabel(u.status)}</Badge></Td>
                  <Td>{u.shared ? <Badge tone="blue">Shared</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="text-muted-foreground max-w-60 truncate">{u.notes}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {sortedRows.length === 0 && <EmptyState message="No units match the filters." />}
        </Card>
      )}

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center" style={{ gap: 16, fontSize: 12, color: MUTED }}>
        <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 999, background: GREEN }} /> Free entire window</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 999, background: AMBER }} /> Partly free (also a quote hold on the timeline)</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 999, background: PURPLE }} /> Occupied entire window</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 999, background: MUTED }} /> Maintenance</span>
      </div>

      {/* ── How this runs efficiently ──────────────────────────────── */}
      <div style={{ background: INK, color: '#fff', borderRadius: 22, padding: '32px 36px' }}>
        <div style={{ ...HEADING, fontWeight: 700, fontSize: 20 }}>How this runs efficiently</div>
        <div className="grid gap-6 mt-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {([
            [Database, 'One availability query', 'The whole page runs off a single availability call for the chosen window. Contracts, live tenancies and sent quotes are resolved server-side, so the list, the timeline and the table all read the same answer instead of each asking again.'],
            [ShieldCheck, 'Quotes hold the unit', 'A unit under a sent or accepted quote counts as taken for that period, so two people cannot be promised the same unit. Units in maintenance are never offered, whatever the contracts say.'],
            [Sparkles, 'Plain English, read locally', 'The phrase box is a small parser running in this browser — no model, no API call, no data leaving the page. It shows you exactly what it understood before anything is applied, and says so when it cannot read a date.'],
          ] as const).map(([Icon, title, body]) => (
            <div key={title}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: PURPLE, display: 'grid', placeItems: 'center' }}>
                <Icon size={17} color="#fff" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 12 }}>{title}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.72)', marginTop: 6 }}>{body}</p>
            </div>
          ))}
        </div>
      </div>
      </div>

      {/* Unit detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold">Unit {selected.unitNumber}</h2>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-muted rounded cursor-pointer text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="p-5">
              <UnitDetail
                unit={selected}
                siteName={siteNameOf(selected)}
                canEdit={canEditUnits}
                bookFrom={winFrom}
                bookTo={winTo}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* A read-only record of the unit. Creating, editing and deleting units moved
   to Settings → Unit Pricing, so this panel only reports. */
function UnitDetail({ unit, siteName, canEdit, bookFrom, bookTo }: { unit: Unit; siteName: string; canEdit: boolean; bookFrom: string; bookTo: string }) {
  const { data, isLoading: contractsLoading } = useQuery<{ unit: Unit; contracts: Contract[] }>({
    queryKey: ['unit', unit._id],
    queryFn: () => api.get(`/units/${unit._id}`).then((r) => r.data),
  })

  const allContracts = (data?.contracts ?? []).filter(c => !['expired', 'terminated', 'cancelled'].includes(c.status))
  const contractStatusTone: Record<string, string> = {
    active: 'green', draft: 'blue', pending_signature: 'amber',
    expired: 'default', terminated: 'red', cancelled: 'red',
  }

  return (
    <div className="space-y-4">
      {/* Contracts section — all contracts for this unit */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Contracts{allContracts.length > 0 ? ` · ${allContracts.length}` : ''}
          </span>
        </div>
        {contractsLoading ? (
          <p className="px-3 py-3 text-xs text-muted-foreground animate-pulse">Loading contracts…</p>
        ) : allContracts.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No contracts yet.</p>
        ) : (
          <ul className="divide-y">
            {allContracts.map(c => (
              <li key={c._id} className="px-3 py-2 text-sm hover:bg-muted/20">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/contracts/${c._id}`}
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                  >
                    View
                  </Link>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{c.contractNo}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.customer?.fullName}</p>
                  </div>
                  <Badge tone={contractStatusTone[c.status] as Parameters<typeof Badge>[0]['tone'] ?? 'default'} className="shrink-0 text-xs capitalize">
                    {c.status.replace(/_/g, ' ')}
                  </Badge>
                </div>

                {/* Term on its own row — the dates are what people come here
                    to check, and they were previously squeezed into the
                    customer line as "· until 10 Sept". */}
                <div className="grid grid-cols-3 gap-2 mt-1.5 pl-[3.25rem] text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Checked in</div>
                    <div className="font-medium">{c.startDate ? formatDate(c.startDate) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Check out</div>
                    <div className="font-medium">{c.endDate ? formatDate(c.endDate) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {(() => {
                        if (!c.endDate) return 'Term'
                        const days = Math.round((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                        return days < 0 ? 'Ended' : 'Remaining'
                      })()}
                    </div>
                    <div className="font-medium">
                      {(() => {
                        if (!c.startDate || !c.endDate) return '—'
                        const days = Math.round((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                        const weeks = Math.ceil(
                          Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7
                        )
                        // For a live contract the useful number is days left;
                        // for a finished one, how long it ran.
                        if (c.status !== 'active') return `${weeks} wk${weeks === 1 ? '' : 's'}`
                        return days < 0 ? `${Math.abs(days)}d ago` : `${days}d`
                      })()}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The unit's own facts, reported rather than edited. */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit record</span>
        </div>
        <dl className="divide-y">
          {([
            ['Site', siteName],
            ['Floor', unit.floor || '—'],
            ['Size', unit.sizeSqf != null ? `${unit.sizeSqf} sq ft` : '—'],
            ['4 weeks price', unit.price != null ? formatMoney(unit.price) : 'not set'],
            ['Length × width', unit.lengthFt != null || unit.widthFt != null
              ? `${unit.lengthFt ?? '—'} × ${unit.widthFt ?? '—'} ft`
              : '—'],
            ['First month discount', unit.discountPct ? `${unit.discountPct}% — first 28 days` : 'none'],
            ['Shared', unit.shared ? 'Yes' : 'No'],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3 px-3 py-2">
              <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-right">{value}</dd>
            </div>
          ))}
          <div className="flex items-start justify-between gap-3 px-3 py-2">
            <dt className="text-xs text-muted-foreground shrink-0">Status</dt>
            <dd><Badge tone={unitStatusTone[unit.status]}>{statusLabel(unit.status)}</Badge></dd>
          </div>
          <div className="px-3 py-2">
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="text-sm mt-0.5 whitespace-pre-wrap">
              {unit.notes?.trim() || <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        </dl>
      </div>

      {/* Changing the inventory is an admin setup job, and it happens in one
          place next to the pricing matrix that governs unit prices. */}
      {/* Booking usually starts from here, so skip the trip to the wizard and
          re-picking the unit. Carries the searched window, so the dates do not
          have to be typed again. */}
      <Link
        to={`/quotes/new?unit=${unit._id}${bookFrom ? `&from=${bookFrom}` : ''}${bookTo ? `&to=${bookTo}` : ''}`}
        className="flex items-center justify-center gap-1.5 w-full h-10 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        style={{ background: PURPLE, textDecoration: 'none' }}
      >
        <CalendarRange size={15} /> Book this unit
      </Link>

      {canEdit && (
        <p className="text-xs text-muted-foreground">
          Edit this unit in{' '}
          <Link to="/settings?tab=pricing" className="text-primary hover:underline font-medium">
            Settings → Unit Pricing
          </Link>
        </p>
      )}
    </div>
  )
}
