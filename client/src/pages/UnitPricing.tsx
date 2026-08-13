import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Lock, Unlock, Check } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Spinner } from '../components/ui'
import { StatCard } from './reports/shared'

interface MatrixContract {
  _id: string
  contractNo: string
  customerName: string
  rate: number | null
  leasedPrice: number | null
  firstMonthDiscountPct: number
  status: string
}
interface MatrixUnit {
  _id: string
  unitNumber: string
  floor: string
  sizeSqf: number | null
  status: string
  price: number | null
  contract: MatrixContract | null
}

const statusDot: Record<string, string> = {
  available: '#10B981',
  occupied: '#8B5CF6',
  reserved: '#F59E0B',
  maintenance: '#94A3B8',
}

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`

// Same derivation the contract sidebar uses when leasedPrice is unset
function derivedLeased(c: MatrixContract): number | null {
  if (c.leasedPrice != null) return c.leasedPrice
  if (c.rate == null) return null
  return Math.round(c.rate * (1 - (c.firstMonthDiscountPct || 0) / 100) * 100) / 100
}

function PriceCell({ unit, onSaved }: { unit: MatrixUnit; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/units/${unit._id}`, body),
    onSuccess: () => { setUnlocked(false); setValue(''); setErr(''); onSaved() },
    onError: (e) => setErr(apiError(e)),
  })

  const locked = unit.price != null && !unlocked

  if (locked) {
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="text-[13px] font-bold">{money(unit.price!)}</span>
        <button
          type="button"
          title="Price is locked — admin unlock to correct a mistake"
          onClick={() => {
            if (confirm(`Unlock the price of ${unit.unitNumber}? The actual price should normally never change.`)) {
              setValue(String(unit.price ?? ''))
              setUnlocked(true)
            }
          }}
          className="p-0.5 rounded hover:bg-black/5 cursor-pointer text-muted-foreground">
          <Lock size={11} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        {unlocked && <Unlock size={11} className="text-amber-600 shrink-0" />}
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Set price"
          className="w-full min-w-0 rounded border px-1.5 py-0.5 text-[12px] bg-white"
        />
        <button
          type="button"
          disabled={save.isPending || value === ''}
          onClick={() => save.mutate(unlocked ? { price: Number(value), priceOverride: true } : { price: Number(value) })}
          className="p-1 rounded bg-emerald-600 text-white disabled:opacity-40 cursor-pointer shrink-0">
          <Check size={11} />
        </button>
      </div>
      {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
    </div>
  )
}

function LeasedCell({ unit, onSaved }: { unit: MatrixUnit; onSaved: () => void }) {
  const c = unit.contract!
  const current = derivedLeased(c)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: (leasedPrice: number) => api.put(`/contracts/${c._id}`, { leasedPrice }),
    onSuccess: () => { setEditing(false); setErr(''); onSaved() },
    onError: (e) => setErr(apiError(e)),
  })

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(current != null ? String(current) : ''); setEditing(true) }}
        className="text-[13px] font-bold text-left hover:underline cursor-pointer"
        title="Click to edit the leased amount">
        {current != null ? money(current) : 'Set'}
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min="0"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value !== '') save.mutate(Number(value)); if (e.key === 'Escape') setEditing(false) }}
          className="w-full min-w-0 rounded border px-1.5 py-0.5 text-[12px] bg-white"
        />
        <button
          type="button"
          disabled={save.isPending || value === ''}
          onClick={() => save.mutate(Number(value))}
          className="p-1 rounded bg-emerald-600 text-white disabled:opacity-40 cursor-pointer shrink-0">
          <Check size={11} />
        </button>
      </div>
      {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
    </div>
  )
}

export default function UnitPricing() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ units: MatrixUnit[] }>({
    queryKey: ['unit-pricing-matrix'],
    queryFn: () => api.get('/units/pricing-matrix').then((r) => r.data),
  })

  const units = data?.units ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['unit-pricing-matrix'] })

  const grouped = useMemo(() => {
    const map = new Map<string, MatrixUnit[]>()
    for (const u of units) {
      const key = u.floor || '—'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(u)
    }
    const norm = (s: string) => s.replace(/\s+/g, '')
    for (const list of map.values()) {
      list.sort((a, b) => norm(a.unitNumber).localeCompare(norm(b.unitNumber), undefined, { numeric: true }))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [units])

  const leased = units.filter((u) => u.contract)
  const totalActualLeased = leased.reduce((s, u) => s + (u.price ?? 0), 0)
  const totalLeased = leased.reduce((s, u) => s + (derivedLeased(u.contract!) ?? 0), 0)
  const diff = totalLeased - totalActualLeased
  const unpriced = units.filter((u) => u.price == null).length

  const floorTotals = (list: MatrixUnit[]) => {
    const occ = list.filter((u) => u.contract)
    const actual = occ.reduce((s, u) => s + (u.price ?? 0), 0)
    const leasedSum = occ.reduce((s, u) => s + (derivedLeased(u.contract!) ?? 0), 0)
    return { occ: occ.length, actual, leasedSum, diff: leasedSum - actual }
  }

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unit Pricing"
        subtitle="The actual price of every unit — set once, locked after. Leased shows what each tenant actually pays." />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Units" value={String(units.length)} sub={unpriced > 0 ? `${unpriced} without a price` : 'all priced'} tone={unpriced > 0 ? 'amber' : 'default'} />
        <StatCard label="Leased units" value={String(leased.length)} />
        <StatCard label="Actual (leased units)" value={money(totalActualLeased)} />
        <StatCard label="Leased total" value={money(totalLeased)} />
        <StatCard label="Difference" value={`${diff >= 0 ? '+' : ''}${money(diff)}`} tone={diff >= 0 ? 'green' : 'red'} sub={diff >= 0 ? 'leasing above actual' : 'leasing below actual'} />
      </div>

      {grouped.map(([floor, list]) => {
        const t = floorTotals(list)
        return (
          <div key={floor}>
            <div className="flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1 mb-2">
              <h2 className="text-sm font-bold uppercase tracking-wide">{floor} <span className="text-muted-foreground font-medium">({list.length} units)</span></h2>
              {t.occ > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t.occ} leased · actual {money(t.actual)} · leased {money(t.leasedSum)} ·{' '}
                  <span className={t.diff >= 0 ? 'text-emerald-600 font-semibold' : 'text-destructive font-semibold'}>
                    {t.diff >= 0 ? '+' : ''}{money(t.diff)}
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
              {list.map((u) => {
                const dl = u.contract ? derivedLeased(u.contract) : null
                const variance = u.contract && u.price != null && dl != null ? dl - u.price : null
                return (
                  <div key={u._id} className="rounded-xl border bg-card p-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[13px] font-bold truncate">{u.unitNumber}</span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        {u.sizeSqf != null && `${u.sizeSqf} sqf`}
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDot[u.status] ?? '#94A3B8' }} title={u.status} />
                      </span>
                    </div>

                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</div>
                    <PriceCell unit={u} onSaved={invalidate} />

                    {u.contract && (
                      <div className="mt-1.5 pt-1.5 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Leased</span>
                          {variance != null && variance !== 0 && (
                            <span className={`text-[10px] font-bold ${variance > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                              {variance > 0 ? '+' : ''}{variance.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <LeasedCell unit={u} onSaved={invalidate} />
                        <Link to={`/contracts/${u.contract._id}`} className="block text-[10px] text-primary hover:underline truncate mt-0.5">
                          {u.contract.contractNo} · {u.contract.customerName}
                        </Link>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
