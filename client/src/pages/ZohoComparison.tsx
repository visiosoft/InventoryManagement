import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RefreshCw, Search } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Spinner } from '../components/ui'

type ZohoContact = { id: string; name: string; company?: string; email?: string; phone?: string; mobile?: string; status?: string; outstanding?: number }
type ErpRow = { _id: string; fullName: string; email?: string; phone?: string; contracts: number }
type Comparison = {
  zohoTotal: number
  erpTotal: number
  matched: { zoho: ZohoContact; erp: ErpRow; matchedBy: 'name' | 'phone' }[]
  zohoOnly: ZohoContact[]
  erpOnly: ErpRow[]
}

/**
 * Side-by-side of Zoho Books customers and ERP tenants, matched on name or
 * phone (either counts), so the two systems can be reconciled by eye.
 */
export default function ZohoComparison() {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'matched' | 'zohoOnly' | 'erpOnly'>('matched')

  const { data, isLoading, isFetching, refetch, error } = useQuery<Comparison>({
    queryKey: ['zoho-comparison'],
    queryFn: () => api.get('/integrations/zoho-books/customer-comparison').then((r) => r.data),
    staleTime: 5 * 60_000,
    retry: 0,
  })

  const norm = (v: string) => v.toLowerCase()
  const filtered = useMemo(() => {
    if (!data) return { matched: [], zohoOnly: [], erpOnly: [] }
    const t = q.trim().toLowerCase()
    const hit = (...vals: (string | undefined)[]) => !t || vals.some((v) => v && norm(v).includes(t))
    return {
      matched: data.matched.filter((m) => hit(m.zoho.name, m.erp.fullName, m.zoho.phone, m.zoho.mobile, m.erp.phone, m.zoho.email, m.erp.email)),
      zohoOnly: data.zohoOnly.filter((z) => hit(z.name, z.company, z.phone, z.mobile, z.email)),
      erpOnly: data.erpOnly.filter((c) => hit(c.fullName, c.phone, c.email)),
    }
  }, [data, q])

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Zoho Comparison"
        subtitle={data ? `${data.zohoTotal} customers in Zoho Books · ${data.erpTotal} tenants in the ERP · matched on name or phone` : 'Comparing customers between Zoho Books and the ERP'}
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> {isFetching ? 'Comparing…' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <Card><CardBody><p className="text-sm text-destructive py-4">{apiError(error)}</p></CardBody></Card>
      ) : !data ? null : (
        <>
          {/* Summary tiles double as tabs */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {([
              ['matched', 'Matched', data.matched.length, 'text-emerald-600'],
              ['zohoOnly', 'Only in Zoho', data.zohoOnly.length, 'text-amber-600'],
              ['erpOnly', 'Only in ERP', data.erpOnly.length, 'text-blue-600'],
            ] as const).map(([key, label, count, color]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                className={`rounded-xl border px-4 py-3 text-left cursor-pointer transition-colors ${tab === key ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className={`text-2xl font-bold mt-0.5 ${color}`}>{count}</div>
              </button>
            ))}
          </div>

          <Card>
            <CardHeader
              title={tab === 'matched' ? 'Matched customers' : tab === 'zohoOnly' ? 'In Zoho Books, missing from the ERP' : 'In the ERP, missing from Zoho Books'}
              action={
                <div className="flex items-center gap-2 h-9 px-3 rounded-lg border bg-white w-72">
                  <Search size={14} className="text-muted-foreground" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, phone, email…"
                    className="flex-1 bg-transparent outline-none text-[13px]" />
                </div>
              }
            />
            <CardBody className="pt-0 overflow-x-auto">
              {tab === 'matched' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                      <th className="py-2 pr-3">Zoho customer</th>
                      <th className="py-2 pr-3">Zoho phone</th>
                      <th className="py-2 pr-3">ERP tenant</th>
                      <th className="py-2 pr-3">ERP phone</th>
                      <th className="py-2 pr-3">Matched by</th>
                      <th className="py-2 pr-3 text-right">Contracts</th>
                      <th className="py-2 text-right">Zoho outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.matched.map((m) => (
                      <tr key={m.zoho.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3 font-medium">{m.zoho.name}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{m.zoho.mobile || m.zoho.phone || '—'}</td>
                        <td className="py-2 pr-3">
                          <Link to={`/customers/${m.erp._id}`} className="text-primary hover:underline font-medium">{m.erp.fullName}</Link>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{m.erp.phone || '—'}</td>
                        <td className="py-2 pr-3"><Badge tone={m.matchedBy === 'name' ? 'blue' : 'green'}>{m.matchedBy}</Badge></td>
                        <td className="py-2 pr-3 text-right">{m.erp.contracts}</td>
                        <td className="py-2 text-right">{m.zoho.outstanding ? m.zoho.outstanding.toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {tab === 'zohoOnly' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Company</th>
                      <th className="py-2 pr-3">Phone</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.zohoOnly.map((z) => (
                      <tr key={z.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3 font-medium">{z.name}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{z.company || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{z.mobile || z.phone || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{z.email || '—'}</td>
                        <td className="py-2 pr-3">{z.status ? <Badge tone={z.status === 'active' ? 'green' : 'gray'}>{z.status}</Badge> : '—'}</td>
                        <td className="py-2 text-right">{z.outstanding ? z.outstanding.toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {tab === 'erpOnly' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                      <th className="py-2 pr-3">Tenant</th>
                      <th className="py-2 pr-3">Phone</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 text-right">Contracts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.erpOnly.map((c) => (
                      <tr key={c._id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3">
                          <Link to={`/customers/${c._id}`} className="text-primary hover:underline font-medium">{c.fullName}</Link>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{c.phone || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{c.email || '—'}</td>
                        <td className="py-2 text-right">{c.contracts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {((tab === 'matched' && !filtered.matched.length) || (tab === 'zohoOnly' && !filtered.zohoOnly.length) || (tab === 'erpOnly' && !filtered.erpOnly.length)) && (
                <p className="text-sm text-muted-foreground py-6 text-center">Nothing here{q ? ' matching the filter' : ''}.</p>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
