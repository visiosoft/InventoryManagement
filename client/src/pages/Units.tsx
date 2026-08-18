import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, CalendarRange, ChevronsUpDown, LayoutGrid, List, Plus, Search } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useSite, unitInSite, type Site } from '../lib/site'
import type { Unit, Contract } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Th, Textarea, statusLabel, unitStatusTone } from '../components/ui'
import { cn, compareUnitNumbers, formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const CREAM = '#FDFCFA'
const CHIP_BG = '#F3F0EA'

const statusColor: Record<string, string> = {
  available: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25',
  occupied: 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25',
  reserved: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25',
  maintenance: 'bg-muted border-border text-muted-foreground hover:bg-muted/70',
}

const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v))

type UnitBody = {
  unitNumber: string
  floor: string
  sizeSqf: number | null
  price: number | null
  lengthFt: number | null
  widthFt: number | null
  status: string
  discountPct: number | null
  shared: boolean
  notes: string
  site: string | null
}

function UnitFormFields({ initial }: { initial?: Partial<Unit> }) {
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then((r) => r.data),
  })
  const rawSite = (initial as { site?: string | { _id: string } | null } | undefined)?.site
  const initialSite = typeof rawSite === 'object' && rawSite ? rawSite._id : rawSite
  return (
    <>
      {sites.length > 1 && (
        <Field label="Site">
          <Select name="site" defaultValue={initialSite || sites.find((s) => s.isDefault)?._id || ''}>
            {sites.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit number"><Input name="unitNumber" defaultValue={initial?.unitNumber} placeholder="F1-45" required /></Field>
        <Field label="Floor">
          <Select name="floor" defaultValue={initial?.floor || 'F1'}>
            <option value="F1">F1</option>
            <option value="F2">F2</option>
            <option value="F3">F3</option>
            <option value="Shed">Shed</option>
          </Select>
        </Field>
        <Field label="Size (sq ft)"><Input name="sizeSqf" type="number" step="1" defaultValue={initial?.sizeSqf ?? ''} /></Field>
        <Field label="4 Weeks price (AED)">
          {initial?.price != null ? (
            <>
              {/* Disabled inputs don't submit — a hidden field keeps the unchanged
                  value in the form so saving other fields doesn't trip the price lock. */}
              <input type="hidden" name="price" value={initial.price} />
              <Input type="number" step="0.01" defaultValue={initial.price} disabled className="opacity-60 cursor-not-allowed" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Locked — set from <Link to="/settings?tab=pricing" className="text-primary hover:underline">Settings → Unit Pricing</Link>
              </p>
            </>
          ) : (
            <Input name="price" type="number" step="0.01" defaultValue={initial?.price ?? ''} />
          )}
        </Field>
        <Field label="Length (ft)"><Input name="lengthFt" type="number" step="0.1" defaultValue={initial?.lengthFt ?? ''} /></Field>
        <Field label="Width (ft)"><Input name="widthFt" type="number" step="0.1" defaultValue={initial?.widthFt ?? ''} /></Field>
        <Field label="First month discount (%) — 28 days">
          <Input name="discountPct" type="number" min={0} max={100} step="0.01"
            defaultValue={initial?.discountPct ?? ''} placeholder="0" />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer mt-1">
        <input
          type="checkbox"
          name="shared"
          defaultChecked={initial?.shared ?? false}
          className="h-4 w-4 rounded"
        />
        <span className="text-sm text-foreground">Shared unit</span>
      </label>
    </>
  )
}

function readUnitForm(f: FormData): UnitBody {
  return {
    unitNumber: String(f.get('unitNumber')),
    floor: String(f.get('floor')),
    sizeSqf: num(f.get('sizeSqf')),
    price: num(f.get('price')),
    lengthFt: num(f.get('lengthFt')),
    widthFt: num(f.get('widthFt')),
    status: String(f.get('status') || 'available'),
    discountPct: num(f.get('discountPct')),
    shared: f.get('shared') === 'on',
    notes: String(f.get('notes') || ''),
    site: (f.get('site') as string) || null,
  }
}

export default function Units() {
  const qc = useQueryClient()
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [statusFilter, setStatusFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Unit | null>(null)

  // "Free between these dates" — a unit occupied today may be free later if
  // its contract ends in the window, and vice versa, so this cannot be derived
  // from the current status.
  const [availFrom, setAvailFrom] = useState('')
  const [availTo, setAvailTo] = useState('')
  const windowActive = Boolean(availFrom && availTo && availTo > availFrom)

  type AvailUnit = {
    _id: string
    bookedInPeriod?: boolean
    bookings?: { kind: string; ref: string; customer: string; startDate: string; endDate: string; status: string }[]
  }
  const availability = useQuery<AvailUnit[]>({
    queryKey: ['unit-availability', availFrom, availTo],
    // `all=true` returns every unit flagged, not only the ones free today.
    queryFn: () => api
      .get('/quotes/available-units', { params: { from: availFrom, to: availTo, all: 'true' } })
      .then((r) => r.data ?? []),
    enabled: windowActive,
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
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

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

  const sizeBreakdown = useMemo(() => {
    const map = new Map<number, { available: number; total: number }>()
    for (const u of units || []) {
      if (u.sizeSqf == null) continue
      const entry = map.get(u.sizeSqf) ?? { available: 0, total: 0 }
      entry.total += 1
      if (u.status === 'available') entry.available += 1
      map.set(u.sizeSqf, entry)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([sqf, counts]) => ({ sqf, ...counts }))
  }, [units])

  const filtered = useMemo(
    () =>
      (units || [])
        .filter(
          (u) =>
            (!statusFilter || u.status === statusFilter) &&
            (!floorFilter || u.floor === floorFilter) &&
            (!sizeFilter || u.sizeSqf === Number(sizeFilter)) &&
            (!search || u.unitNumber.toLowerCase().includes(search.toLowerCase()) || String(u.sizeSqf ?? '') === search) &&
            // With a date window set, show only units genuinely free for the
            // whole of it. Maintenance units are never bookable, whatever the
            // contracts say.
            (!windowActive || !availability.data || (
              u.status !== 'maintenance' && !bookedInWindow.get(u._id)?.bookedInPeriod
            ))
        )
        .sort(compareUnitNumbers),
    [units, statusFilter, floorFilter, sizeFilter, search, windowActive, availability.data, bookedInWindow]
  )

  // Sorted view for the table. The card view keeps the natural unit order,
  // since it is grouped by floor and has no headers to sort by.
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
    return [...filtered].sort((a, b) => cmp(a, b) * dir || compareUnitNumbers(a, b))
  }, [filtered, sortKey, sortDir, activeByUnit])

  const grouped = useMemo(() => {
    const map = new Map<string, Unit[]>()
    for (const u of filtered) {
      if (!map.has(u.floor)) map.set(u.floor, [])
      map.get(u.floor)!.push(u)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['units'] })

  const createUnit = useMutation({
    mutationFn: (body: UnitBody) => api.post('/units', body),
    onSuccess: () => { invalidate(); setAdding(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<UnitBody>) => api.put(`/units/${id}`, body),
    onSuccess: () => { invalidate(); setSelected(null); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteUnit = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: () => { invalidate(); setSelected(null); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  if (isLoading) return <Spinner />

  return (
    <div style={{ background: CREAM, borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Units</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
            {filtered.length} units · {filtered.filter((u) => u.status === 'available').length} available · {filtered.filter((u) => u.status === 'maintenance').length} maintenance
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div style={{ height: 40, borderRadius: 10, background: CHIP_BG }} className="flex items-center p-0.5">
            <button onClick={() => setView('grid')} className="h-8 w-8 grid place-items-center rounded-lg transition-colors" style={{ background: view === 'grid' ? 'white' : 'transparent' }}><LayoutGrid size={15} color={view === 'grid' ? INK : MUTED} /></button>
            <button onClick={() => setView('table')} className="h-8 w-8 grid place-items-center rounded-lg transition-colors" style={{ background: view === 'table' ? 'white' : 'transparent' }}><List size={15} color={view === 'table' ? INK : MUTED} /></button>
          </div>
          <button onClick={() => setAdding(true)} style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 13, fontWeight: 600 }} className="px-4 flex items-center gap-1.5 hover:brightness-110 transition">
            <Plus size={15} /> Add unit
          </button>
        </div>
      </div>

      {/* Size summary cards */}
      {sizeBreakdown.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {sizeBreakdown.map(({ sqf, available, total }) => {
            const active = sizeFilter === String(sqf)
            return (
              <button
                key={sqf}
                type="button"
                onClick={() => setSizeFilter(active ? '' : String(sqf))}
                style={{
                  background: active ? `${PURPLE}10` : 'white',
                  border: `1.5px solid ${active ? PURPLE : 'rgba(20,8,31,0.08)'}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{sqf} sq ft</div>
                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: available === 0 ? MUTED : '#047857' }}>
                  {available} / {total}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>available</div>
              </button>
            )
          })}
          {sizeFilter && (
            <button
              type="button"
              onClick={() => setSizeFilter('')}
              style={{ borderRadius: 12, border: `1.5px dashed rgba(20,8,31,0.15)`, padding: '10px 14px', fontSize: 12, color: MUTED, cursor: 'pointer', alignSelf: 'center', background: 'transparent' }}
            >
              Show all
            </button>
          )}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="flex items-center gap-2 px-3">
          <Search size={14} color={MUTED} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search unit / size…"
            style={{ background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, width: 130 }}
          />
        </div>
        <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="px-1">
          <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} style={{ height: 36, background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, fontWeight: 500, paddingRight: 8, paddingLeft: 8 }}>
            <option value="">All floors</option>
            <option value="F1">Floor F1</option>
            <option value="F2">Floor F2</option>
            <option value="F3">Floor F3</option>
            <option value="Shed">Shed</option>
          </select>
        </div>
        <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="px-1">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ height: 36, background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, fontWeight: 500, paddingRight: 8, paddingLeft: 8 }}>
            <option value="">All statuses</option>
            {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
        {/* Availability window */}
        <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="flex items-center gap-1.5 px-3">
          <CalendarRange size={14} color={MUTED} />
          <span style={{ fontSize: 12, color: MUTED }}>Free</span>
          <input type="date" value={availFrom} max={availTo || undefined}
            onChange={(e) => setAvailFrom(e.target.value)}
            title="Available from"
            style={{ background: 'transparent', outline: 'none', border: 'none', fontSize: 12.5, color: INK }} />
          <span style={{ fontSize: 12, color: MUTED }}>→</span>
          <input type="date" value={availTo} min={availFrom || undefined}
            onChange={(e) => setAvailTo(e.target.value)}
            title="Available until"
            style={{ background: 'transparent', outline: 'none', border: 'none', fontSize: 12.5, color: INK }} />
          {(availFrom || availTo) && (
            <button type="button" onClick={() => { setAvailFrom(''); setAvailTo('') }}
              title="Clear the date window"
              className="cursor-pointer hover:opacity-70" style={{ color: MUTED, fontSize: 14, lineHeight: 1 }}>
              ×
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3" style={{ fontSize: 11, color: MUTED }}>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Available</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Occupied</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Reserved</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Maintenance</span>
        </div>
      </div>

      {availFrom && availTo && availTo <= availFrom && (
        <div className="mb-4 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: '#FEF3C7', color: '#92400E' }}>
          The end date must be after the start date.
        </div>
      )}
      {windowActive && (
        <div className="mb-4 rounded-xl px-4 py-2.5 text-[13px] flex flex-wrap items-center gap-x-2 gap-y-1"
          style={{ background: '#EDE9FE', color: '#4A1FA0' }}>
          {availability.isLoading ? (
            <span>Checking availability…</span>
          ) : availability.isError ? (
            <span>Could not check availability for those dates.</span>
          ) : (
            <>
              <strong>{filtered.length}</strong>
              <span>of {units.length} units are free for the whole period</span>
              <span style={{ opacity: 0.75 }}>
                {formatDate(availFrom)} – {formatDate(availTo)}
              </span>
              <span style={{ opacity: 0.75 }}>
                · counts contracts and sent quotes that overlap it
              </span>
            </>
          )}
        </div>
      )}

      {view === 'grid' ? (
        <div className="space-y-6">
          {grouped.map(([floor, list]) => (
            <div key={floor}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Floor {floor} — {list.length} units
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                {list.map((u) => (
                  <button
                    key={u._id}
                    onClick={() => setSelected(u)}
                    title={u.notes}
                    className={cn('rounded-lg border px-2 py-2.5 text-center transition-colors cursor-pointer', statusColor[u.status])}
                  >
                    <div className="text-xs font-bold">{u.unitNumber}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{u.sizeSqf != null ? `${u.sizeSqf} sqf` : '—'}</div>
                    {u.discountPct ? <div className="text-[9px] mt-0.5 font-medium text-amber-600">{u.discountPct}% 1st 4wk</div> : null}
                    {u.shared ? <div className="text-[9px] mt-0.5 font-medium text-sky-600 dark:text-sky-400">Shared</div> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyState message="No units match the filters." />}
        </div>
      ) : (
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

      {/* Unit detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => { setSelected(null); setError('') }} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold">Unit {selected.unitNumber}</h2>
              <button onClick={() => { setSelected(null); setError('') }} className="p-1 hover:bg-muted rounded cursor-pointer text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="p-5">
              <UnitDetail
                unit={selected}
                onUpdate={(body) => updateUnit.mutate({ id: selected._id, ...body })}
                onDelete={() => deleteUnit.mutate(selected._id)}
                error={error}
                busy={updateUnit.isPending || deleteUnit.isPending}
              />
            </div>
          </div>
        </div>
      )}

      {/* Add unit modal */}
      <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add unit">
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); createUnit.mutate(readUnitForm(new FormData(e.currentTarget))) }}
          className="space-y-4"
        >
          <UnitFormFields />
          <Field label="Status">
            <Select name="status" defaultValue="available">
              {['available', 'reserved', 'occupied', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea name="notes" /></Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={createUnit.isPending}>Create unit</Button>
        </form>
      </Modal>
    </div>
  )
}

function UnitDetail({ unit, onUpdate, onDelete, error, busy }: { unit: Unit; onUpdate: (b: Partial<UnitBody>) => void; onDelete: () => void; error: string; busy: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data, isLoading: contractsLoading } = useQuery<{ unit: Unit; contracts: Contract[] }>({
    queryKey: ['unit', unit._id],
    queryFn: () => api.get(`/units/${unit._id}`).then((r) => r.data),
  })
  const openContract = data?.contracts.find((c) => ['active', 'pending_signature', 'draft'].includes(c.status))
  const statusLocked = unit.status === 'occupied' && !!openContract

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = readUnitForm(new FormData(e.currentTarget))
    if (statusLocked) delete (body as Partial<UnitBody>).status
    onUpdate(body)
  }

  const allContracts = (data?.contracts ?? []).filter(c => !['expired', 'terminated', 'cancelled'].includes(c.status))
  const contractStatusTone: Record<string, string> = {
    active: 'green', draft: 'blue', pending_signature: 'amber',
    expired: 'default', terminated: 'red', cancelled: 'red',
  }

  return (
    <form onSubmit={submit} className="space-y-4">
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
              <li key={c._id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/20">
                <Link
                  to={`/contracts/${c._id}`}
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                >
                  View
                </Link>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.contractNo}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.customer?.fullName}
                    {c.endDate ? ` · until ${formatDate(c.endDate)}` : ''}
                  </p>
                </div>
                <Badge tone={contractStatusTone[c.status] as Parameters<typeof Badge>[0]['tone'] ?? 'default'} className="shrink-0 text-xs capitalize">
                  {c.status.replace(/_/g, ' ')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <UnitFormFields initial={unit} />

      <Field label="Status">
        <Select name="status" defaultValue={unit.status} disabled={statusLocked}>
          {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        {statusLocked && <p className="text-[11px] text-muted-foreground mt-1">Status is managed by the contract lifecycle.</p>}
      </Field>
      <Field label="Notes"><Textarea name="notes" defaultValue={unit.notes} /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>Save changes</Button>
      {!openContract && (
        confirmDelete ? (
          <div className="flex gap-2 mt-2">
            <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete} disabled={busy}>
              Yes, delete
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="w-full mt-2 text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setConfirmDelete(true)}>
            Delete unit
          </Button>
        )
      )}
    </form>
  )
}
