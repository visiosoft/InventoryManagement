import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, FileText, Files, Layers, Plus, X } from 'lucide-react'
import { api, apiError, unitTypeApi } from '../lib/api'
import type { Contract, Customer, Unit, UnitType } from '../lib/types'
import { Badge, Button, Card, CardBody, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { AddCustomerModal } from '../components/AddCustomerModal'
import { cn, formatMoney } from '../lib/utils'

type Mode = 'single' | 'combined' | 'multi'

const DAYS_PER_PERIOD = { weekly: 7, monthly: 28 } as const

function estimatePeriods(start: string, end: string, billing: 'weekly' | 'monthly'): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / (DAYS_PER_PERIOD[billing] * 86400000))
}

// rate = monthly price. Weekly payment = rate/4. Ceiling billing (any leftover day = full week).
// Discount applies to first 4 weekly payments (= first month).
function computeContractTotal(
  startDate: string, endDate: string,
  billing: 'weekly' | 'monthly',
  rate: number,
  applyDiscount: boolean,
  discountPct: number,
): number {
  const totalDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
  if (totalDays <= 0 || rate <= 0) return 0
  const dpp = DAYS_PER_PERIOD[billing]
  const totalPeriods = Math.ceil(totalDays / dpp)
  const discountPeriods = billing === 'weekly' ? 4 : 1
  const discountCount = applyDiscount && discountPct > 0 ? Math.min(discountPeriods, totalPeriods) : 0
  const fullCount = totalPeriods - discountCount
  const periodRate = billing === 'weekly' ? rate / 4 : rate
  const discountedPeriodRate = Math.round(periodRate * (1 - discountPct / 100) * 100) / 100
  return Math.round((discountCount * discountedPeriodRate + fullCount * periodRate) * 100) / 100
}

type BreakdownSection = { label: string; detail: string; amount: number; accent?: boolean }

function computeBreakdown(
  startDate: string, endDate: string,
  billing: 'weekly' | 'monthly',
  rate: number,
  discountPct: number,
): BreakdownSection[] {
  const totalDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
  if (totalDays <= 0 || rate <= 0) return []
  const dpp    = DAYS_PER_PERIOD[billing]
  const fmt    = (n: number) => formatMoney(Math.round(n * 100) / 100)

  // Any leftover day = one more full week (ceiling, no proration)
  const totalWeeks     = Math.ceil(totalDays / dpp)
  const discountWeeks  = billing === 'weekly' ? 4 : 1
  const firstCount = Math.min(discountWeeks, totalWeeks)

  // rate = monthly price; weekly payment = rate/4
  const weeklyRate     = Math.round((rate / 4) * 100) / 100
  const discountedRate = Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100

  const rows: BreakdownSection[] = []

  // ── Month 1 (first 4 weeks, possibly discounted) ──
  if (discountPct > 0) {
    const month1Full = Math.round(weeklyRate * firstCount * 100) / 100
    const month1Disc = Math.round(discountedRate * firstCount * 100) / 100
    const saved      = Math.round((month1Full - month1Disc) * 100) / 100
    const detail = firstCount === 4
      ? `${fmt(rate)}/mo × ${100 - discountPct}% = ${fmt(month1Disc)}`
      : `${firstCount} wks × ${fmt(weeklyRate)} × ${100 - discountPct}% = ${fmt(month1Disc)}`
    rows.push({
      label: `Month 1 — ${firstCount} wk${firstCount !== 1 ? 's' : ''} (${discountPct}% off · save ${fmt(saved)})`,
      detail,
      amount: month1Disc,
      accent: true,
    })
  } else {
    const month1Amt = Math.round(weeklyRate * firstCount * 100) / 100
    const detail = firstCount === 4
      ? `${fmt(rate)}/mo`
      : `${firstCount} wks × ${fmt(weeklyRate)}`
    rows.push({ label: `Month 1 — ${firstCount} wk${firstCount !== 1 ? 's' : ''}`, detail, amount: month1Amt })
  }

  // ── Remaining weeks grouped into months of 4 ──
  let remaining  = totalWeeks - firstCount
  let monthNum   = 2
  let weekOffset = firstCount

  while (remaining > 0) {
    const weeksThisMonth = Math.min(4, remaining)
    const isPartial      = weeksThisMonth < 4
    const wkStart        = weekOffset + 1
    const wkEnd          = weekOffset + weeksThisMonth
    const monthAmt       = Math.round(weeklyRate * weeksThisMonth * 100) / 100
    const detail         = isPartial
      ? `Wk ${wkStart}${wkEnd > wkStart ? `–${wkEnd}` : ''} · ${weeksThisMonth} × ${fmt(weeklyRate)}`
      : `Wk ${wkStart}–${wkEnd} · ${fmt(rate)}/mo`
    rows.push({
      label: `Month ${monthNum}${isPartial ? ' (partial)' : ''} — ${weeksThisMonth} wk${weeksThisMonth !== 1 ? 's' : ''}`,
      detail,
      amount: monthAmt,
    })
    remaining  -= weeksThisMonth
    weekOffset += weeksThisMonth
    monthNum++
  }

  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  rows.push({
    label: 'Total',
    detail: `${totalWeeks} wk${totalWeeks !== 1 ? 's' : ''}`,
    amount: total,
  })
  return rows
}

function hasDateOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aS = new Date(aStart), aE = new Date(aEnd)
  const bS = new Date(bStart), bE = new Date(bEnd)
  if ([aS, aE, bS, bE].some((d) => Number.isNaN(d.getTime()))) return false
  return aS < bE && aE > bS
}

const SIZES = [10, 25, 35, 50, 100, 150, 200]

// ── Searchable customer combobox ──────────────────────────────────────────────
function CustomerCombobox({
  customers,
  value,
  onChange,
  onAddNew,
}: {
  customers: Customer[]
  value: string
  onChange: (id: string) => void
  onAddNew: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickingRef = useRef(false)   // prevents blur from resetting during a pick

  // Sync display text whenever the selected value or customer list changes.
  // This covers (a) URL pre-populate where customers load async after mount,
  // (b) returning to step 0 after navigating away.
  useEffect(() => {
    const found = value ? customers.find((c) => c._id === value) : null
    // Only overwrite query if it's currently blank OR matches another customer's name
    // (i.e. the user hasn't started a fresh search)
    if (found) setQuery(found.fullName)
    else if (!value) setQuery('')
  }, [value, customers])

  // Close dropdown on outside mousedown — more reliable than onBlur+timeout
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        // Restore display text to the selected customer name if user clicked away mid-search
        const found = value ? customers.find((c) => c._id === value) : null
        if (found) setQuery(found.fullName)
        else if (!value) setQuery('')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, value, customers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // When a customer is selected and the input still shows their name, list all customers
    const selected = value ? customers.find((c) => c._id === value) : null
    if (!q || (selected && selected.fullName.toLowerCase() === q)) return customers.slice(0, 50)
    return customers
      .filter((c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.clientId?.toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [customers, query, value])

  function pick(c: Customer) {
    pickingRef.current = true
    onChange(c._id)
    setQuery(c.fullName)
    setOpen(false)
    requestAnimationFrame(() => { pickingRef.current = false })
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(true)
    inputRef.current?.focus()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    if (value) onChange('')   // clear selection when user starts re-typing
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pr-16"
          placeholder="Type to search customers…"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {(value || query) && (
            <button type="button" onMouseDown={clear} className="text-muted-foreground hover:text-foreground p-0.5">
              <X size={13} />
            </button>
          )}
          <ChevronDown size={13} className="text-muted-foreground" />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white dark:bg-zinc-900 shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground flex items-center justify-between">
              <span>No customers found.</span>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onAddNew() }}
                className="flex items-center gap-1 text-primary hover:underline font-medium">
                <Plus size={11} /> Add new
              </button>
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c._id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(c) }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between gap-2',
                  c._id === value && 'bg-accent/60'
                )}
              >
                <span className="min-w-0">
                  <span className="font-medium">{c.fullName}</span>
                  {c.clientId && <span className="ml-1.5 text-[11px] text-muted-foreground">{c.clientId}</span>}
                  {(c.phone || c.email) && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground truncate">
                      {c.phone || c.email}
                    </span>
                  )}
                </span>
                {c._id === value && <Check size={13} className="text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Mode picker ───────────────────────────────────────────────────────────────
function ModePicker({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {([
        { mode: 'single' as Mode, Icon: FileText, title: 'Single unit', desc: 'One contract · one unit. Standard rental agreement.' },
        { mode: 'combined' as Mode, Icon: Layers, title: 'Single contract · multiple units', desc: 'One contract number covers several units. One combined payment per period.' },
        { mode: 'multi' as Mode, Icon: Files, title: 'Separate contracts · multiple units', desc: 'Pick several units — creates one contract per unit with the same terms.' },
      ]).map(({ mode, Icon, title, desc }) => (
        <button
          key={mode}
          onClick={() => onPick(mode)}
          className="group rounded-xl border-2 border-border bg-card p-5 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Icon size={20} />
          </div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </button>
      ))}
    </div>
  )
}

// ── Unit availability card ────────────────────────────────────────────────────
type UnitAvail = 'available' | 'prebookable' | 'booked' | 'maintenance'

function unitAvailability(u: Unit, contracts: Contract[], startDate: string, endDate: string): UnitAvail {
  if (u.status === 'maintenance') return 'maintenance'
  const conflict = contracts.find(
    (c) =>
      c.unit?._id === u._id &&
      ['draft', 'pending_signature', 'active'].includes(c.status) &&
      hasDateOverlap(startDate, endDate, c.startDate, c.endDate)
  )
  if (conflict) return 'booked'
  if (u.status === 'available') return 'available'
  return 'prebookable'
}

const availStyle: Record<UnitAvail, string> = {
  available: 'border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20',
  prebookable: 'border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20',
  booked: 'border-rose-400/60 bg-rose-500/10 opacity-60',
  maintenance: 'border-border bg-muted opacity-40 cursor-not-allowed',
}
const availLabel: Record<UnitAvail, string> = {
  available: 'Available',
  prebookable: 'Pre-bookable',
  booked: 'Booked',
  maintenance: 'Construction',
}
const availLabelColor: Record<UnitAvail, string> = {
  available: 'text-emerald-600 dark:text-emerald-400',
  prebookable: 'text-amber-600 dark:text-amber-400',
  booked: 'text-rose-500',
  maintenance: 'text-muted-foreground',
}

const availOrder: Record<UnitAvail, number> = { available: 0, prebookable: 1, booked: 2, maintenance: 3 }

// ── Main component ────────────────────────────────────────────────────────────
export default function NewContract() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [mode, setMode] = useState<Mode | null>(params.get('unit') ? 'single' : null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  const [customerId, setCustomerId] = useState(params.get('customer') || '')
  const [unitIds, setUnitIds] = useState<string[]>(params.get('unit') ? [params.get('unit')!] : [])
  const [addCustOpen, setAddCustOpen] = useState(false)

  const billing = 'weekly' as const
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10)
  })
  const [rate, setRate] = useState<number | ''>('')
  const [deposit, setDeposit] = useState<number | ''>('')
  const [autoRenew, setAutoRenew] = useState(false)
  const [notes, setNotes] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [showBooked, setShowBooked] = useState(false)

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers', ''],
    queryFn: () => api.get('/customers').then((r) => r.data),
  })
  const { data: units = [], isLoading: unitsLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data),
  })
  const { data: unitTypes = [] } = useQuery<UnitType[]>({
    queryKey: ['unit-types'],
    queryFn: () => unitTypeApi.list(),
  })

  const periods = useMemo(() => estimatePeriods(startDate, endDate, billing), [startDate, endDate, billing])

  // Per-unit availability for selected date range
  const unitAvailMap = useMemo(() => {
    const map = new Map<string, UnitAvail>()
    for (const u of units) map.set(u._id, unitAvailability(u, contracts, startDate, endDate))
    return map
  }, [units, contracts, startDate, endDate])

  // Conflict contract for booked units (for tooltip / label)
  const conflictMap = useMemo(() => {
    const map = new Map<string, Contract>()
    for (const u of units) {
      const c = contracts.find(
        (c) =>
          c.unit?._id === u._id &&
          ['draft', 'pending_signature', 'active'].includes(c.status) &&
          hasDateOverlap(startDate, endDate, c.startDate, c.endDate)
      )
      if (c) map.set(u._id, c)
    }
    return map
  }, [units, contracts, startDate, endDate])

  // Filtered + sorted units for the grid
  const displayUnits = useMemo(() => {
    return units
      .filter((u) =>
        u.status !== 'maintenance' &&
        (!sizeFilter || u.sizeSqf === Number(sizeFilter)) &&
        (!floorFilter || u.floor === floorFilter) &&
        (showBooked || unitAvailMap.get(u._id) !== 'booked')
      )
      .sort((a, b) => {
        const ao = availOrder[unitAvailMap.get(a._id) ?? 'maintenance']
        const bo = availOrder[unitAvailMap.get(b._id) ?? 'maintenance']
        if (ao !== bo) return ao - bo
        return a.unitNumber.localeCompare(b.unitNumber)
      })
  }, [units, sizeFilter, floorFilter, showBooked, unitAvailMap])

  const groupedUnits = useMemo(() => {
    const map = new Map<string, Unit[]>()
    for (const u of displayUnits) {
      if (!map.has(u.floor)) map.set(u.floor, [])
      map.get(u.floor)!.push(u)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [displayUnits])

  const selectedUnits = useMemo(() => units.filter((u) => unitIds.includes(u._id)), [units, unitIds])
  const selectedCustomer = useMemo(() => customers.find((c) => c._id === customerId), [customers, customerId])

  function getUnitRate(u: Unit): number {
    if (rate !== '') return Number(rate)
    // unit.price is the monthly price — weekly payment = rate / 4
    return u.price ?? 0
  }

  const [discountMap, setDiscountMap] = useState<Record<string, string>>({})

  // When a unit is (de)selected, seed its discount from unit.discountPct if not already set
  useEffect(() => {
    setDiscountMap((prev) => {
      const next = { ...prev }
      for (const u of selectedUnits) {
        const key = mode === 'combined' ? 'combined' : u._id
        if (!(key in next) && u.discountPct) next[key] = String(u.discountPct)
      }
      return next
    })
  }, [selectedUnits])

  // For combined mode all units share one rate, so we key the discount on 'combined'
  function discountKey(u: Unit) { return mode === 'combined' ? 'combined' : u._id }
  function unitDiscount(u: Unit) { return Math.min(100, Math.max(0, Number(discountMap[discountKey(u)] || 0))) }

  const overlappingUnitIds = useMemo(
    () => unitIds.filter((uid) => unitAvailMap.get(uid) === 'booked'),
    [unitIds, unitAvailMap]
  )

  const totalValue = useMemo(() =>
    selectedUnits.reduce((sum, u) => {
      const r = getUnitRate(u)
      const pct = unitDiscount(u)
      return sum + computeContractTotal(startDate, endDate, billing, r, pct > 0, pct)
    }, 0),
    [selectedUnits, rate, billing, startDate, endDate, discountMap, unitTypes]
  )

  const combinedRate = useMemo(
    () => selectedUnits.reduce((sum, u) => sum + getUnitRate(u), 0),
    [selectedUnits, rate, billing, unitTypes]
  )

  const toggleUnit = (uid: string) => {
    const avail = unitAvailMap.get(uid)
    if (avail === 'maintenance') return
    if (mode === 'single') setUnitIds((prev) => prev.includes(uid) ? [] : [uid])
    else setUnitIds((prev) => prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid])
  }

  const isMultiUnit = mode === 'combined' || mode === 'multi'

  const create = useMutation({
    mutationFn: () => {
      if (mode === 'combined') {
        const r = rate !== '' ? Number(rate) : combinedRate
        const pct = Number(discountMap['combined'] || 0)
        return api.post('/contracts', {
          customer: customerId, unit: selectedUnits[0]._id,
          units: selectedUnits.map((u) => u._id),
          billingPeriod: billing, rate: r,
          deposit: deposit === '' ? 0 : deposit,
          startDate, endDate, autoRenew, notes,
          firstMonthDiscountPct: pct,
        }).then((res) => [res])
      }
      return Promise.all(selectedUnits.map((u) => {
        const r = getUnitRate(u)
        const pct = unitDiscount(u)
        return api.post('/contracts', {
          customer: customerId, unit: u._id,
          billingPeriod: billing, rate: r,
          deposit: deposit === '' ? 0 : deposit,
          startDate, endDate, autoRenew, notes,
          firstMonthDiscountPct: pct,
        })
      }))
    },
    onSuccess: (results) => {
      if (results.length === 1) navigate(`/contracts/${results[0].data._id}`)
      else navigate('/contracts')
    },
    onError: (e) => { setError(apiError(e)); setStep(2) },
  })

  const steps = ['Customer', mode === 'single' ? 'Unit' : 'Units', 'Terms', 'Review']
  const canNext = [
    Boolean(customerId),
    unitIds.length > 0 && overlappingUnitIds.length === 0,
    Boolean(startDate && endDate > startDate && selectedUnits.every((u) => getUnitRate(u) > 0) && overlappingUnitIds.length === 0),
    true,
  ][step]

  // Availability counts
  const availCount = useMemo(() => [...unitAvailMap.values()].filter((v) => v === 'available').length, [unitAvailMap])
  const bookedCount = useMemo(() => [...unitAvailMap.values()].filter((v) => v === 'booked').length, [unitAvailMap])

  // Per-size availability summary for the clickable summary cards
  const sizeBreakdown = useMemo(() => {
    const map = new Map<number, { available: number; total: number }>()
    for (const u of units) {
      if (u.sizeSqf == null || u.status === 'maintenance') continue
      const avail = unitAvailMap.get(u._id) ?? 'maintenance'
      if (avail === 'maintenance') continue
      const entry = map.get(u.sizeSqf) ?? { available: 0, total: 0 }
      entry.total += 1
      if (avail === 'available' || avail === 'prebookable') entry.available += 1
      map.set(u.sizeSqf, entry)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sqf, counts]) => ({ sqf, ...counts }))
  }, [units, unitAvailMap])

  if (unitsLoading) return <Spinner />
  if (!mode) return (
    <div className="max-w-2xl">
      <PageHeader title="New contract" subtitle="Choose the type of contract to create" />
      <ModePicker onPick={(m) => setMode(m)} />
    </div>
  )

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New contract"
        subtitle={
          <span>
            {mode === 'single' ? 'Single unit contract'
              : mode === 'combined' ? 'Single contract · multiple units'
                : 'Separate contracts · multiple units'}
            <button
              onClick={() => { setMode(null); setStep(0); setUnitIds([]); setError('') }}
              className="ml-2 text-xs text-primary hover:underline cursor-pointer"
            >
              Change
            </button>
          </span>
        }
      />

      {/* Stepper */}
      <div className="mb-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-full px-3 text-xs font-medium cursor-pointer',
                i === step ? 'bg-primary text-primary-foreground'
                  : i < step ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}. {s}
            </button>
            {i < steps.length - 1 && <div className="h-px w-5 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardBody className="pt-4 space-y-4">

          {/* ── Step 0: Customer ─────────────────────────────────── */}
          {step === 0 && (
            <>
              <Field label="Customer">
                <CustomerCombobox customers={customers} value={customerId} onChange={setCustomerId} onAddNew={() => setAddCustOpen(true)} />
              </Field>
              {selectedCustomer && (
                <div className="rounded-lg border bg-accent/50 px-3 py-2 text-xs space-y-0.5">
                  <p className="font-medium">{selectedCustomer.fullName}</p>
                  {selectedCustomer.clientId && <p className="text-muted-foreground">{selectedCustomer.clientId}</p>}
                  {selectedCustomer.phone && <p className="text-muted-foreground">{selectedCustomer.phone}</p>}
                  {selectedCustomer.email && <p className="text-muted-foreground">{selectedCustomer.email}</p>}
                </div>
              )}
              <button type="button" onClick={() => setAddCustOpen(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Plus size={12} /> Add new customer
              </button>
            </>
          )}

          {/* ── Step 1: Unit(s) ──────────────────────────────────── */}
          {step === 1 && (
            <>
              {/* Date range for availability check */}
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Check availability for dates</p>
                <div className="flex flex-wrap gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Start</p>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-36 h-7 text-xs" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">End</p>
                    <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="w-36 h-7 text-xs" />
                  </div>
                  <div className="flex items-end gap-3 pb-0.5 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-muted-foreground">{availCount} available</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
                      <span className="text-muted-foreground">{bookedCount} booked</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Size summary cards */}
              {sizeBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sizeBreakdown.map(({ sqf, available, total }) => {
                    const active = sizeFilter === String(sqf)
                    const none = available === 0
                    return (
                      <button
                        key={sqf}
                        type="button"
                        onClick={() => setSizeFilter(active ? '' : String(sqf))}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition-all text-xs',
                          active
                            ? 'border-primary bg-primary/10 ring-1 ring-primary'
                            : none
                              ? 'border-border bg-muted/40 opacity-60 cursor-default'
                              : 'border-border bg-card hover:border-primary/60 hover:bg-accent cursor-pointer'
                        )}
                      >
                        <div className="font-semibold text-foreground">{sqf} sq ft</div>
                        <div className={cn('mt-0.5 font-medium tabular-nums', none ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400')}>
                          {available} / {total}
                        </div>
                        <div className="text-[10px] text-muted-foreground">available</div>
                      </button>
                    )
                  })}
                  {sizeFilter && (
                    <button
                      type="button"
                      onClick={() => setSizeFilter('')}
                      className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors self-center"
                    >
                      Show all
                    </button>
                  )}
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <Select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} className="w-32">
                  <option value="">All floors</option>
                  <option value="F1">Floor F1</option>
                  <option value="F2">Floor F2</option>
                </Select>
                <Select value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} className="w-36">
                  <option value="">All sizes</option>
                  {SIZES.map((s) => <option key={s} value={s}>{s} sq ft</option>)}
                </Select>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={showBooked} onChange={(e) => setShowBooked(e.target.checked)} className="accent-rose-500" />
                  Show booked units
                </label>
                {unitIds.length > 0 && (
                  <span className="text-xs font-medium text-primary">
                    {unitIds.length} unit{unitIds.length !== 1 ? 's' : ''} selected
                  </span>
                )}
              </div>

              {/* Unit grid */}
              <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
                {groupedUnits.map(([floor, list]) => (
                  <div key={floor}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Floor {floor}
                    </p>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5">
                      {list.map((u) => {
                        const avail = unitAvailMap.get(u._id) ?? 'maintenance'
                        const selected = unitIds.includes(u._id)
                        const disabled = avail === 'maintenance' || avail === 'booked'
                        const conflict = conflictMap.get(u._id)
                        return (
                          <button
                            key={u._id}
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleUnit(u._id)}
                            title={conflict ? `Booked: ${conflict.contractNo} (${conflict.startDate?.slice(0, 10)} → ${conflict.endDate?.slice(0, 10)})` : undefined}
                            className={cn(
                              'relative rounded-lg border px-2 py-2 text-center transition-all',
                              selected
                                ? 'border-primary bg-primary/15 ring-1 ring-primary'
                                : availStyle[avail],
                              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                            )}
                          >
                            {selected && (
                              <span className="absolute top-1 right-1">
                                <Check size={10} className="text-primary" strokeWidth={3} />
                              </span>
                            )}
                            <div className="text-xs font-bold">{u.unitNumber}</div>
                            <div className="text-[10px] opacity-70 mt-0.5">
                              {u.sizeSqf != null ? `${u.sizeSqf} sqf` : '—'}
                            </div>
                            {u.price != null && (
                              <div className="text-[9px] opacity-60">{formatMoney(u.price)}</div>
                            )}
                            <div className={cn('text-[9px] mt-0.5 font-medium', availLabelColor[avail])}>
                              {availLabel[avail]}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {displayUnits.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No units match the filters.</p>
                )}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Available for your dates</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Occupied now · free for your dates</span>
                {showBooked && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Already booked</span>}
              </div>

              {/* Selected chips */}
              {unitIds.length > 0 && (
                <div className="rounded-lg border bg-accent/60 px-3 py-2 text-xs space-y-1">
                  <p className="font-medium text-accent-foreground">Selected:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUnits.map((u) => (
                      <button
                        key={u._id}
                        type="button"
                        onClick={() => toggleUnit(u._id)}
                        className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] hover:border-destructive hover:text-destructive transition-colors"
                      >
                        {u.unitNumber}{u.sizeSqf != null ? ` (${u.sizeSqf} sqf)` : ''} ×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {overlappingUnitIds.length > 0 && (
                <p className="text-xs text-destructive">
                  {overlappingUnitIds.map((id) => units.find((u) => u._id === id)?.unitNumber).join(', ')} {overlappingUnitIds.length === 1 ? 'is' : 'are'} already booked for these dates. Deselect or change dates.
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                {mode === 'single'
                  ? 'Click a unit to select it.'
                  : mode === 'combined'
                    ? 'Click units to select. All will be grouped under one contract.'
                    : 'Click units to select. One contract will be created per unit.'}
              </p>
            </>
          )}

          {/* ── Step 2: Terms ────────────────────────────────────── */}
          {step === 2 && (() => {
            const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
            const firstUnit = selectedUnits[0] ?? ({} as Unit)
            const displayRate = mode === 'combined'
              ? (rate !== '' ? Number(rate) : combinedRate)
              : getUnitRate(firstUnit)
            const weeklyRate = displayRate > 0 ? Math.round(displayRate / 4 * 100) / 100 : 0
            const firstDiscount = mode === 'combined'
              ? Math.min(100, Math.max(0, Number(discountMap['combined'] || 0)))
              : unitDiscount(firstUnit)
            const breakdown = displayRate > 0 && periods > 0
              ? computeBreakdown(startDate, endDate, billing, displayRate, firstDiscount)
              : []

            return (
              <div className="space-y-3">

                {/* ── Period ── */}
                <section className="rounded-xl border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/60 border-b">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contract Period</h3>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Start date">
                        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                      </Field>
                      <Field label="End date">
                        <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                      </Field>
                    </div>
                    {periods > 0 && startDate && endDate && (
                      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                        <div className="text-center min-w-[40px]">
                          <div className="text-3xl font-bold text-primary leading-none">{periods}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">weeks</div>
                        </div>
                        <div className="w-px h-8 bg-border" />
                        <div className="text-sm text-muted-foreground">
                          {fmtDate(startDate)}
                          <span className="mx-2 opacity-40">→</span>
                          {fmtDate(endDate)}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* ── Pricing ── */}
                <section className="rounded-xl border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/60 border-b">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pricing</h3>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={mode === 'combined' ? 'Combined monthly rate' : `Monthly rate${mode === 'multi' ? ' (all units)' : ''}`}>
                        <Input
                          type="number" min={0} step="0.01" value={rate}
                          placeholder={
                            mode === 'combined' ? String(combinedRate) + ' (sum of units)'
                              : mode === 'multi' ? "Each unit's own price"
                                : String(getUnitRate(firstUnit))
                          }
                          onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))}
                        />
                        {mode === 'combined' && <p className="mt-1 text-[11px] text-muted-foreground">Sum of unit prices. Override if needed.</p>}
                        {mode === 'multi' && <p className="mt-1 text-[11px] text-muted-foreground">Leave blank to use each unit's own rate.</p>}
                      </Field>
                      <Field label={`Security deposit${isMultiUnit ? ' (per unit)' : ''}`}>
                        <Input type="number" min={0} step="0.01" value={deposit} placeholder="0.00"
                          onChange={(e) => setDeposit(e.target.value === '' ? '' : Number(e.target.value))} />
                      </Field>
                    </div>
                    {weeklyRate > 0 && (
                      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                        <span className="font-semibold tabular-nums">{formatMoney(displayRate)}<span className="font-normal text-muted-foreground text-xs">/mo</span></span>
                        <span className="text-muted-foreground">÷ 4 weeks</span>
                        <span className="text-muted-foreground">=</span>
                        <span className="font-bold text-primary tabular-nums">{formatMoney(weeklyRate)}<span className="font-normal text-muted-foreground text-xs">/wk</span></span>
                      </div>
                    )}
                  </div>
                </section>

                {/* ── First month discount ── */}
                <section className="rounded-xl border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/60 border-b flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">First Month Discount</h3>
                    <span className="text-[11px] text-muted-foreground">Weeks 1–4 only (optional)</span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {mode === 'combined' ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm flex-1 text-muted-foreground">Combined rate</span>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={0} max={100} step="0.01"
                            value={discountMap['combined'] ?? ''}
                            onChange={(e) => setDiscountMap((p) => ({ ...p, combined: e.target.value }))}
                            placeholder="0" className="w-20 text-right" />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </div>
                    ) : (
                      selectedUnits.map((u) => (
                        <div key={u._id} className="flex items-center gap-3">
                          <span className="text-sm font-semibold w-16">{u.unitNumber}</span>
                          {u.sizeSqf != null && <span className="text-xs text-muted-foreground flex-1">{u.sizeSqf} sqft</span>}
                          {weeklyRate > 0 && Number(discountMap[u._id] || 0) > 0 && (
                            <span className="text-xs text-amber-600 ml-auto mr-2">
                              {formatMoney(Math.round(weeklyRate * (1 - Number(discountMap[u._id]) / 100) * 100) / 100)}/wk × 4
                            </span>
                          )}
                          <div className="flex items-center gap-1.5">
                            <Input type="number" min={0} max={100} step="0.01"
                              value={discountMap[u._id] ?? ''}
                              onChange={(e) => setDiscountMap((p) => ({ ...p, [u._id]: e.target.value }))}
                              placeholder="0" className="w-20 text-right" />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* ── Payment breakdown ── */}
                {breakdown.length > 0 && (
                  <section className="rounded-xl border overflow-hidden">
                    <div className="px-4 py-2 bg-muted/60 border-b flex items-center justify-between">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Breakdown</h3>
                      {mode === 'multi' && <span className="text-[11px] text-muted-foreground">Showing {firstUnit.unitNumber}</span>}
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {breakdown.map((row, i) => {
                          const isTotal = row.label === 'Total'
                          return (
                            <tr key={i} className={cn(
                              'border-b last:border-0',
                              row.accent && 'bg-amber-50 dark:bg-amber-950/20',
                              isTotal && 'bg-muted/40 font-semibold',
                            )}>
                              <td className="px-4 py-2.5 font-medium">{row.label}</td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.detail}</td>
                              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </section>
                )}

                {/* ── Other ── */}
                <section className="rounded-xl border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/60 border-b">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other</h3>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-(--primary)" />
                      Auto-renew at end of term
                    </label>
                    <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                  </div>
                </section>

                {overlappingUnitIds.length > 0 && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {overlappingUnitIds.map((id) => units.find((u) => u._id === id)?.unitNumber).join(', ')} {overlappingUnitIds.length === 1 ? 'is' : 'are'} already booked for this period.
                    Go back and choose different dates or units.
                  </div>
                )}

              </div>
            )
          })()}

          {/* ── Step 3: Review ───────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Customer</div>
                  {selectedCustomer?.fullName}
                  {selectedCustomer?.clientId && <span className="ml-1.5 text-xs text-muted-foreground">{selectedCustomer.clientId}</span>}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Term</div>
                  {startDate} → {endDate}
                  <span className="ml-1.5 text-muted-foreground text-xs">(≈ {periods} {billing === 'weekly' ? 'week' : 'month'}{periods !== 1 ? 's' : ''})</span>
                </div>
                <div><div className="text-xs text-muted-foreground">Billing</div><span className="capitalize">{billing}</span></div>
                <div><div className="text-xs text-muted-foreground">Deposit{mode === 'multi' ? ' per unit' : ''}</div>{formatMoney(Number(deposit || 0))}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1.5">
                  {mode === 'multi' ? `Units booked (${selectedUnits.length} separate contracts)` : mode === 'combined' ? `Units covered (1 combined contract)` : 'Unit'}
                  {' · '}{Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (7 * 86400000))} wks total
                </div>
                <div className="rounded-lg border divide-y divide-border text-xs">
                  {selectedUnits.map((u) => {
                    const r = mode === 'combined' ? (rate !== '' ? Number(rate) / selectedUnits.length : getUnitRate(u)) : getUnitRate(u)
                    const pct = unitDiscount(u)
                    const rows = computeBreakdown(startDate, endDate, billing, r, pct)
                    const unitTotal = rows[rows.length - 1]?.amount ?? 0
                    return (
                      <div key={u._id}>
                        {/* Unit header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 font-medium">
                          <span>{u.unitNumber}{u.sizeSqf != null ? <span className="ml-1.5 font-normal text-muted-foreground">{u.sizeSqf} sq ft</span> : null}</span>
                          <span className="text-muted-foreground font-normal">
                            {formatMoney(r)}/mo
                            <span className="ml-1.5 opacity-60 text-[10px]">({formatMoney(Math.round(r/4*100)/100)}/wk)</span>
                          </span>
                          <span>{formatMoney(unitTotal)}</span>
                        </div>
                        {/* Breakdown rows */}
                        {rows.map((row, i) => {
                          const isLast = i === rows.length - 1
                          return (
                            <div key={i} className={`flex items-center justify-between px-4 py-1.5 gap-4
                              ${isLast ? 'border-t font-semibold bg-accent/40' : ''}
                              ${row.accent ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
                              <span className={isLast ? 'text-foreground' : ''}>{row.label}</span>
                              <span className="flex-1 text-right text-[11px] opacity-70">{row.detail}</span>
                              <span className={isLast ? 'text-foreground' : 'text-foreground/80'}>{formatMoney(row.amount)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {mode === 'combined' && selectedUnits.length > 1 && (
                    <div className="flex items-center justify-between px-3 py-2 bg-accent/60 font-semibold">
                      <span>Combined total</span>
                      <span>{formatMoney(rate !== '' ? Number(rate) : combinedRate)}/mo</span>
                      <span>{formatMoney(totalValue)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-accent px-3 py-2 text-accent-foreground text-xs space-y-0.5">
                <div className="flex items-center justify-between">
                  <span>
                    {mode === 'multi' ? 'Combined value' : 'Contract value'}
                    {mode === 'multi' && ` · ${selectedUnits.length} contracts`}
                    {mode === 'combined' && ` · ${selectedUnits.length} units · 1 contract`}
                    {' '}· ≈ {periods} {billing === 'weekly' ? 'weekly' : 'monthly'} payment{periods !== 1 ? 's' : ''}
                    {autoRenew && <Badge tone="purple" className="ml-2">Auto-renew</Badge>}
                  </span>
                  <strong>{formatMoney(totalValue)}</strong>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => step === 0 ? navigate(-1) : setStep(step - 1)}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < 3 ? (
              <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button>
            ) : (
              <Button disabled={create.isPending || overlappingUnitIds.length > 0} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…'
                  : mode === 'multi' ? `Create ${selectedUnits.length} contract${selectedUnits.length !== 1 ? 's' : ''}`
                    : mode === 'combined' ? `Create 1 contract (${selectedUnits.length} units)`
                      : 'Create contract'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <AddCustomerModal
        open={addCustOpen}
        onClose={() => setAddCustOpen(false)}
        onCreated={(customer) => { setCustomerId(customer._id) }}
      />
    </div>
  )
}
