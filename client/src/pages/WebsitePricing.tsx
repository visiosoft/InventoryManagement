import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { api, apiError, apiUrl } from '../lib/api'
import type { Unit } from '../lib/types'
import { PageHeader } from '../components/ui'

/* Settings → Website Prices.
 *
 * One row per unit size: the price and the discount the marketing website
 * shows. They are written onto the units themselves — the same price and
 * discount a booking is quoted from — so the website can never advertise
 * something other than what is charged. The public API below reads the same
 * fields back out. */

type SizeRow = {
  size: number
  count: number
  free: number
  price: number | null      // null = units of this size are priced differently
  priceSpread: string
  anyPriced: boolean
  pricedCount: number
  discount: number | null   // null = mixed
}

const aed = (n: number) => `AED ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

function SizeControl({ row, onSaved }: { row: SizeRow; onSaved: () => void }) {
  const [price, setPrice] = useState(row.price != null ? String(row.price) : '')
  const [discount, setDiscount] = useState(row.discount != null ? String(row.discount) : '')
  const [override, setOverride] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const priceChanged = price !== '' && Number(price) !== row.price
  const discountChanged = discount !== '' && Number(discount) !== row.discount
  const dirty = priceChanged || discountChanged

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/units/size-pricing', body).then((r) => r.data),
    onSuccess: (d) => {
      const bits = []
      if (d.priceUpdated) bits.push(`price set on ${d.priceUpdated}`)
      if (d.discountUpdated) bits.push(`discount set on ${d.discountUpdated}`)
      if (d.priceSkipped) bits.push(`${d.priceSkipped} already-priced left unchanged`)
      setMsg({ ok: true, text: bits.join(', ') || 'No change' })
      onSaved()
    },
    onError: (e) => setMsg({ ok: false, text: apiError(e) }),
  })

  const p = Number(price)
  const d = Number(discount)
  const showPreview = p > 0 && d > 0 && d <= 100
  const offer = showPreview ? Math.round(p * (1 - d / 100) * 100) / 100 : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2.5">
      <div className="w-24 shrink-0">
        <div className="text-sm font-bold">{row.size} sq ft</div>
        <div className="text-[11px] text-muted-foreground">{row.free} free of {row.count}</div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Price
        <input
          type="number" min="0" value={price}
          onChange={(e) => { setPrice(e.target.value); setMsg(null) }}
          placeholder={row.price == null ? (row.anyPriced ? 'Mixed' : 'Price') : undefined}
          className="w-24 min-w-0 rounded border px-2 py-1 text-sm bg-white text-foreground"
        />
      </label>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Discount
        <input
          type="number" min="0" max="100" value={discount}
          onChange={(e) => { setDiscount(e.target.value); setMsg(null) }}
          placeholder={row.discount == null ? 'Mixed' : '0'}
          className="w-16 min-w-0 rounded border px-2 py-1 text-sm bg-white text-foreground"
        />
        %
      </label>

      {/* What a visitor will see on the website. */}
      <div className="min-w-[150px] text-sm">
        {showPreview ? (
          <span>
            <s className="text-muted-foreground">{aed(p)}</s>{' '}
            <strong>{aed(offer!)}</strong>
            <span className="ml-1 text-xs font-semibold" style={{ color: '#16A34A' }}>−{d}%</span>
          </span>
        ) : p > 0 ? (
          <strong>{aed(p)}</strong>
        ) : (
          <span className="text-xs text-muted-foreground">{row.price == null && row.priceSpread ? `Now: ${row.priceSpread}` : '—'}</span>
        )}
      </div>

      <button
        type="button"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate({
          sizeSqf: row.size,
          ...(priceChanged ? { price: p, override } : {}),
          ...(discountChanged ? { discountPct: d } : {}),
        })}
        className="ml-auto shrink-0 px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 cursor-pointer"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>

      {priceChanged && row.anyPriced && (
        <label className="basis-full flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Also change the {row.pricedCount} unit{row.pricedCount === 1 ? '' : 's'} that already have a price (otherwise only unpriced units change)
        </label>
      )}
      {msg && <span className="basis-full text-xs" style={{ color: msg.ok ? '#16A34A' : '#B91C1C' }}>{msg.text}</span>}
    </div>
  )
}

function ApiPanel() {
  const [copied, setCopied] = useState(false)
  const base = apiUrl('/public/pricing')
  const url = base.startsWith('http') ? base : `${window.location.origin}${base}`
  const snippet = `fetch('${url}')
  .then((r) => r.json())
  .then(({ sizes }) => {
    sizes.forEach((s) => {
      // s.price (before), s.offerPrice (after), s.discountPct, s.hasDiscount
      const html = s.hasDiscount
        ? '<s>AED ' + s.price + '</s> <b>AED ' + s.offerPrice + '</b>'
        : '<b>AED ' + s.price + '</b>';
      document.querySelector('#price-' + s.sizeSqf).innerHTML = html;
    });
  });`

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="text-sm font-bold">Website API — no token needed</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="shrink-0 inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold cursor-pointer"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Anyone can read it; it only returns sizes, prices, discounts and how many units are free. Add <code>?sizes=10,25,35</code> to get only some sizes.
        Prices are per 4 weeks, and the discount applies to the first 4 weeks.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">Example for your website</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed">{snippet}</pre>
      </details>
    </div>
  )
}

export default function WebsitePricing({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient()
  const { data: units = [], isLoading } = useQuery<Unit[]>({
    queryKey: ['units-for-website-pricing'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })

  const rows = useMemo<SizeRow[]>(() => {
    const by = new Map<number, Unit[]>()
    for (const u of units) {
      const s = Number(u.sizeSqf)
      if (!(s > 0) || u.status === 'maintenance') continue
      if (!by.has(s)) by.set(s, [])
      by.get(s)!.push(u)
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([size, us]) => {
      const prices = us.map((u) => u.price).filter((p): p is number => p != null)
      const uniformPrice = prices.length === us.length && prices.every((p) => p === prices[0]) ? prices[0] : null
      const discounts = us.map((u) => Number(u.discountPct || 0))
      const uniformDiscount = discounts.every((d) => d === discounts[0]) ? discounts[0] : null
      const distinct = [...new Set(prices)].sort((a, b) => a - b)
      return {
        size, count: us.length, free: us.filter((u) => u.status === 'available').length,
        price: uniformPrice, priceSpread: distinct.length > 1 ? `${distinct[0]}–${distinct[distinct.length - 1]}` : '',
        anyPriced: prices.length > 0, pricedCount: prices.length, discount: uniformDiscount,
      }
    })
  }, [units])

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader title="Website Prices" subtitle="The prices and discounts shown on the website" />}
      <p className="text-sm text-muted-foreground">
        Set the price and discount for each size. The website shows the old price struck through beside the discounted one.
        Changes apply to every unit of that size, and the website picks them up within a minute.
      </p>
      <ApiPanel />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <SizeControl key={`${r.size}:${r.price}:${r.discount}`} row={r} onSaved={() => qc.invalidateQueries({ queryKey: ['units-for-website-pricing'] })} />
          ))}
        </div>
      )}
    </div>
  )
}
