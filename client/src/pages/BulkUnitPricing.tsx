import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader } from '../components/ui'
import type { MatrixUnit } from './UnitPricing'

function BulkSizeControl({ floor, sizeSqf, count, currentPrice, spread, pricedCount, isAdmin, onSaved }: { floor: string; sizeSqf: number; count: number; currentPrice: number | null; spread: { price: number | null; n: number }[]; pricedCount: number; isAdmin: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(currentPrice != null ? String(currentPrice) : '')
  const [override, setOverride] = useState(false)
  const [result, setResult] = useState<{ updated: number; skipped: number } | null>(null)
  const [err, setErr] = useState('')

  const apply = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/units/bulk-price', body).then((r) => r.data),
    onSuccess: (data) => { setResult({ updated: data.updated, skipped: data.skipped }); setErr(''); onSaved() },
    onError: (e) => { setErr(apiError(e)); setResult(null) },
  })

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
      <span className="text-sm font-bold shrink-0 w-20">{sizeSqf} sqf</span>
      <span className="text-xs text-muted-foreground shrink-0 w-16">{count} units</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => { setValue(e.target.value); setResult(null) }}
        placeholder={currentPrice == null ? 'Price' : undefined}
        className="w-28 min-w-0 rounded border px-2 py-1 text-sm bg-white"
      />
      <button
        type="button"
        disabled={apply.isPending || value === ''}
        onClick={() => apply.mutate({ floor, sizeSqf, price: Number(value), override })}
        className="shrink-0 px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 cursor-pointer"
      >
        {apply.isPending ? 'Applying…' : 'Apply to all'}
      </button>
      {!override && pricedCount === count && count > 0 && (
        <span className="text-[11px] shrink-0" style={{ color: '#92400E' }} title="Every unit of this size already has a price, so applying without override would change nothing">
          all priced
        </span>
      )}
      {isAdmin && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 cursor-pointer" title="Overwrite units that already have a price set">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          override existing
        </label>
      )}
      {/* A blank box means the units do not share one price, which otherwise
          reads as "this row is broken". Say what they actually are. */}
      {currentPrice == null && spread.length > 1 && (
        <span className="text-xs text-muted-foreground basis-full">
          Mixed: {spread.map((x) => `${x.price == null ? 'no price' : x.price} × ${x.n}`).join(' · ')}
        </span>
      )}
      {result && (
        result.updated === 0 && result.skipped > 0 ? (
          /* The commonest confusion here: applying without "override existing"
             skips every unit that already has a price, so nothing changes and
             the page looks stuck. */
          <span className="text-xs basis-full" style={{ color: '#92400E' }}>
            Nothing changed — all {result.skipped} already have a price. Tick <strong>override existing</strong> to replace them.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {result.updated} set{result.skipped > 0 ? `, ${result.skipped} already priced (skipped)` : ''}
          </span>
        )
      )}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  )
}

export default function BulkUnitPricing({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data, isLoading } = useQuery<{ units: MatrixUnit[] }>({
    queryKey: ['unit-pricing-matrix'],
    queryFn: () => api.get('/units/pricing-matrix').then((r) => r.data),
  })

  const units = data?.units ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['unit-pricing-matrix'] })

  const groupedSizes = useMemo(() => {
    const byFloor = new Map<string, Map<number, MatrixUnit[]>>()
    for (const u of units) {
      if (u.sizeSqf == null) continue
      const floor = u.floor || ''
      if (!byFloor.has(floor)) byFloor.set(floor, new Map())
      const bySize = byFloor.get(floor)!
      if (!bySize.has(u.sizeSqf)) bySize.set(u.sizeSqf, [])
      bySize.get(u.sizeSqf)!.push(u)
    }
    return [...byFloor.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([floor, bySize]) => ({
        floor,
        sizes: [...bySize.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([size, us]) => {
            const prices = us.map((u) => u.price).filter((p): p is number => p != null)
            const uniform = prices.length > 0 && prices.every((p) => p === prices[0]) ? prices[0] : null
            // What the prices actually are, most common first, so a blank
            // field can explain itself.
            const counts = new Map<number | null, number>()
            for (const u of us) counts.set(u.price ?? null, (counts.get(u.price ?? null) ?? 0) + 1)
            const spread = [...counts.entries()]
              .map(([price, n]) => ({ price, n }))
              .sort((a, b) => b.n - a.n)
            return { size, count: us.length, currentPrice: uniform, spread, pricedCount: prices.length }
          }),
      }))
  }, [units])

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Bulk Pricing"
          subtitle="Set one price for every unit of a given floor and size at once, instead of editing units one by one." />
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        groupedSizes.map(({ floor, sizes }) => (
          <div key={floor || '—'}>
            <h2 className="text-sm font-bold uppercase tracking-wide mb-2">{floor || '—'}</h2>
            <div className="space-y-2">
              {sizes.map(({ size, count, currentPrice, spread, pricedCount }) => (
                <BulkSizeControl key={size} floor={floor} sizeSqf={size} count={count} currentPrice={currentPrice}
                  spread={spread} pricedCount={pricedCount} isAdmin={isAdmin} onSaved={invalidate} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
