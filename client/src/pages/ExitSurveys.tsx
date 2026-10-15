import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardBody, CardHeader } from '../components/ui'

type Survey = {
  _id: string; submittedAt: string; reason: string; reasonLabel: string; rating: number | null
  comeBack: string; comeBackLabel: string; oneChange: string; whatWouldKeepYou: string; phoneNormalized: string
  customer?: { fullName: string; phone?: string }; unit?: { unitNumber: string }; contract?: { _id: string; contractNo: string }
}
type Data = {
  summary: {
    total: number; averageRating: number | null; rated: number
    byReason: { id: string; label: string; count: number }[]
    comeBack: { yes: number; maybe: number; no: number }
  }
  rows: Survey[]
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

function downloadCsv(rows: Survey[]) {
  const head = ['Submitted', 'Tenant', 'Phone', 'Unit', 'Contract', 'Reason', 'Rating', 'Would come back', 'One thing to change', 'What would keep them']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((r) => [
    r.submittedAt.slice(0, 10), r.customer?.fullName || '', r.customer?.phone || r.phoneNormalized, r.unit?.unitNumber || '',
    r.contract?.contractNo || '', r.reasonLabel, r.rating ?? '', r.comeBackLabel, r.oneChange, r.whatWouldKeepYou,
  ].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `exit-surveys-${day(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Move-out exit survey answers, from the EXIT_SURVEY WhatsApp Flow. */
export default function ExitSurveys() {
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 90 * 864e5)))
  const [to, setTo] = useState(() => day(new Date()))
  const { data, isLoading } = useQuery<Data>({
    queryKey: ['exit-surveys', from, to],
    queryFn: () => api.get('/exit-surveys', { params: { from, to, limit: 2000 } }).then((r) => r.data),
  })
  const s = data?.summary
  const rows = data?.rows ?? []
  const ratings = [5, 4, 3, 2, 1].map((n) => ({ n, count: rows.filter((r) => r.rating === n).length }))
  const maxReason = Math.max(1, ...(s?.byReason.map((r) => r.count) ?? [1]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold">Exit surveys</h1>
          <p className="text-sm text-muted-foreground">Why tenants leave, from the feedback form sent on WhatsApp. Send it from a chat (⋮ → Send exit survey) or from Renewals &amp; Move-outs.</p>
        </div>
        <label className="text-xs">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block h-9 rounded-md border bg-background px-2 text-sm" /></label>
        <label className="text-xs">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block h-9 rounded-md border bg-background px-2 text-sm" /></label>
        <button type="button" disabled={!rows.length} onClick={() => downloadCsv(rows)} className="h-9 inline-flex items-center gap-1 px-3 rounded-md border text-sm font-semibold disabled:opacity-40 cursor-pointer">
          <Download size={14} /> CSV
        </button>
      </div>

      {isLoading || !s ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Responses" value={String(s.total)} />
            <Tile label="Average rating" value={s.averageRating == null ? '—' : `${s.averageRating}/5`} hint={`${s.rated} rated`} />
            <Tile label="Would come back" value={pct(s.comeBack.yes, s.total)} hint={`${s.comeBack.yes} yes · ${s.comeBack.maybe} maybe`} />
            <Tile label="Would not come back" value={pct(s.comeBack.no, s.total)} hint={`${s.comeBack.no} no`} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Main reason for leaving" />
              <CardBody className="space-y-2">
                {s.byReason.length === 0 && <div className="text-sm text-muted-foreground">No answers in this period.</div>}
                {s.byReason.map((r) => (
                  <div key={r.id} className="text-sm">
                    <div className="flex justify-between"><span>{r.label}</span><span className="font-semibold">{r.count} · {pct(r.count, s.total)}</span></div>
                    <div className="h-2 rounded-full bg-muted mt-1"><div className="h-2 rounded-full" style={{ width: `${(r.count / maxReason) * 100}%`, background: '#4A1FA0' }} /></div>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Rating" />
              <CardBody className="space-y-2">
                {ratings.map((r) => (
                  <div key={r.n} className="text-sm">
                    <div className="flex justify-between"><span>{r.n} ★</span><span className="font-semibold">{r.count}</span></div>
                    <div className="h-2 rounded-full bg-muted mt-1"><div className="h-2 rounded-full" style={{ width: `${s.rated ? (r.count / s.rated) * 100 : 0}%`, background: '#047857' }} /></div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={`Responses (${rows.length})`} />
            <CardBody className="overflow-x-auto">
              {rows.length === 0 ? <div className="text-sm text-muted-foreground">No answers in this period.</div> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3">Date</th><th className="pr-3">Tenant</th><th className="pr-3">Unit</th><th className="pr-3">Reason</th>
                      <th className="pr-3">Rating</th><th className="pr-3">Come back</th><th className="pr-3">One thing to change</th><th>What would keep them</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id} className="border-b align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmt(r.submittedAt)}</td>
                        <td className="pr-3">
                          {r.contract ? <Link to={`/contracts/${r.contract._id}`} className="font-semibold hover:underline">{r.customer?.fullName || 'Tenant'}</Link>
                            : <span className="text-muted-foreground">{r.phoneNormalized} (no contract found)</span>}
                        </td>
                        <td className="pr-3">{r.unit?.unitNumber || '—'}</td>
                        <td className="pr-3">{r.reasonLabel || '—'}</td>
                        <td className="pr-3">{r.rating ?? '—'}</td>
                        <td className="pr-3">{r.comeBackLabel || '—'}</td>
                        <td className="pr-3 max-w-[240px]">{r.oneChange}</td>
                        <td className="max-w-[240px]">{r.whatWouldKeepYou}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
