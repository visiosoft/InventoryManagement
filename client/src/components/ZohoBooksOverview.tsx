import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { api } from '../lib/api'
import { formatMoney } from '../lib/utils'

type Split = { total: number; current: number; overdue: number; count: number }
type Month = { month: string; value: number }
type Data = {
  configured: boolean; error?: string; year: number; orgId?: string
  receivables: Split | null; payables: Split | null
  bank: { total: number; accounts: { name: string; type: string; balance: number }[] } | null
  cashFlow: { moneyIn: Month[] | null; moneyOut: Month[] | null; totalIn: number | null; totalOut: number | null } | null
  incomeExpense: { income: Month[] | null; expense: Month[] | null; totalIncome: number | null; totalExpense: number | null } | null
  topExpenses: { account: string; total: number }[] | null
  problems: string[]; fetchedAt: string
}

const INK = '#14081F'
const MUTED = '#756E80'
const CARD = { background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '18px 20px' } as const
const HEAD = { fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontWeight: 700, fontSize: 15 } as const
const aed = (n: number | null | undefined) => (n == null ? '—' : `AED ${formatMoney(n)}`)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : String(v))

/** Receivables / Payables card in Zoho's own layout: total, bar, current vs overdue. */
function OwedCard({ title, sub, s }: { title: string; sub: string; s: Split | null }) {
  const overduePct = s && s.total > 0 ? (s.overdue / s.total) * 100 : 0
  return (
    <div style={CARD}>
      <div style={HEAD}>{title}</div>
      {!s ? <div className="text-sm mt-2" style={{ color: MUTED }}>Not available</div> : <>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>{sub} ({s.count})</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: INK }}>{aed(s.total)}</div>
        <div style={{ height: 8, borderRadius: 8, background: '#3B82F6', overflow: 'hidden', margin: '10px 0' }}>
          <div style={{ height: '100%', width: `${overduePct}%`, background: '#F97316', marginLeft: 'auto' }} />
        </div>
        <div className="flex flex-wrap gap-4" style={{ fontSize: 12.5 }}>
          <span><span style={{ color: '#3B82F6' }}>■</span> Current: <b>{aed(s.current)}</b></span>
          <span><span style={{ color: '#F97316' }}>■</span> Overdue: <b style={{ color: s.overdue ? '#C2410C' : INK }}>{aed(s.overdue)}</b></span>
        </div>
      </>}
    </div>
  )
}

function MonthBars({ a, b, aLabel, bLabel, aColor, bColor }: { a: Month[] | null; b: Month[] | null; aLabel: string; bLabel: string; aColor: string; bColor: string }) {
  const rows = MON.map((m, i) => ({ m, [aLabel]: a?.[i]?.value ?? 0, [bLabel]: b?.[i]?.value ?? 0 }))
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(20,8,31,.08)" />
          <XAxis dataKey="m" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={kfmt} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v) => aed(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={aLabel} fill={aColor} radius={[4, 4, 0, 0]} />
          <Bar dataKey={bLabel} fill={bColor} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Zoho Books' home dashboard, inside the CRM: receivables, payables, bank
 * balance, money in and out, income vs expense and top expenses for this
 * year. Worked out on the server from Zoho's documents (Zoho has no API for
 * its own dashboard), cached ten minutes.
 */
export default function ZohoBooksOverview() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery<Data>({
    queryKey: ['zoho-books-dashboard'],
    queryFn: () => api.get('/accounts-dashboard/zoho-books').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const refresh = async () => {
    const fresh = await api.get('/accounts-dashboard/zoho-books', { params: { refresh: '1' } }).then((r) => r.data)
    qc.setQueryData(['zoho-books-dashboard'], fresh)
  }

  if (isLoading) return <div style={CARD} className="text-sm"><span style={{ color: MUTED }}>Loading Zoho Books… (this can take a few seconds)</span></div>
  if (!data?.configured) return <div style={CARD} className="text-sm" ><span style={{ color: MUTED }}>Zoho Books is not connected.</span></div>
  if (data.error) return <div style={CARD} className="text-sm"><span style={{ color: '#B91C1C' }}>Zoho Books could not be read: {data.error}</span></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span style={{ ...HEAD, fontSize: 17 }}>Zoho Books · {data.year}</span>
        <span style={{ fontSize: 12, color: MUTED }}>as of {new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        <button type="button" onClick={refresh} disabled={isFetching} className="inline-flex items-center gap-1 text-xs font-semibold cursor-pointer" style={{ color: '#4A1FA0' }}>
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
        {data.orgId && (
          <a href={`https://books.zoho.com/app/${data.orgId}#/home/dashboard`} target="_blank" rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#4A1FA0' }}>
            Open in Zoho Books <ExternalLink size={12} />
          </a>
        )}
      </div>

      {data.problems?.length > 0 && (
        <div className="text-xs" style={{ background: '#FFF7E6', color: '#7A4B00', padding: '8px 10px', borderRadius: 10 }}>
          Some figures could not be fetched from Zoho: {data.problems.join(' · ')}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <OwedCard title="Total Receivables" sub="Unpaid invoices" s={data.receivables} />
        <OwedCard title="Total Payables" sub="Unpaid bills" s={data.payables} />
        <div style={CARD}>
          <div style={HEAD}>Cash in bank</div>
          {!data.bank ? <div className="text-sm mt-2" style={{ color: MUTED }}>Not available</div> : <>
            <div style={{ fontSize: 24, fontWeight: 800, color: data.bank.total < 0 ? '#B91C1C' : INK, marginTop: 10 }}>{aed(data.bank.total)}</div>
            <div className="space-y-1 mt-2" style={{ fontSize: 12.5 }}>
              {data.bank.accounts.slice(0, 4).map((a) => (
                <div key={a.name} className="flex justify-between gap-3"><span style={{ color: MUTED }} className="truncate">{a.name}</span><b>{aed(a.balance)}</b></div>
              ))}
            </div>
          </>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div style={CARD}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span style={HEAD}>Cash flow</span>
            <span style={{ fontSize: 12, color: MUTED }}>money in: customer payments · money out: vendor payments + expenses</span>
          </div>
          {data.cashFlow ? <>
            <div className="flex gap-5 my-2" style={{ fontSize: 12.5 }}>
              <span>In <b style={{ color: '#059669' }}>{aed(data.cashFlow.totalIn)}</b></span>
              <span>Out <b style={{ color: '#DC2626' }}>{aed(data.cashFlow.totalOut)}</b></span>
              {data.cashFlow.totalIn != null && data.cashFlow.totalOut != null && (
                <span>Net <b>{aed(Math.round((data.cashFlow.totalIn - data.cashFlow.totalOut) * 100) / 100)}</b></span>
              )}
            </div>
            <MonthBars a={data.cashFlow.moneyIn} b={data.cashFlow.moneyOut} aLabel="Money in" bLabel="Money out" aColor="#10B981" bColor="#F87171" />
          </> : <div className="text-sm mt-2" style={{ color: MUTED }}>Not available</div>}
        </div>

        <div style={CARD}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span style={HEAD}>Income and expense</span>
            <span style={{ fontSize: 12, color: MUTED }}>invoiced vs expenses + bills</span>
          </div>
          {data.incomeExpense ? <>
            <div className="flex gap-5 my-2" style={{ fontSize: 12.5 }}>
              <span>Income <b style={{ color: '#059669' }}>{aed(data.incomeExpense.totalIncome)}</b></span>
              <span>Expense <b style={{ color: '#DC2626' }}>{aed(data.incomeExpense.totalExpense)}</b></span>
            </div>
            <MonthBars a={data.incomeExpense.income} b={data.incomeExpense.expense} aLabel="Income" bLabel="Expense" aColor="#4A1FA0" bColor="#F59E0B" />
          </> : <div className="text-sm mt-2" style={{ color: MUTED }}>Not available</div>}
        </div>
      </div>

      <div style={CARD}>
        <div style={HEAD}>Top expenses · {data.year}</div>
        {!data.topExpenses?.length ? <div className="text-sm mt-2" style={{ color: MUTED }}>No expenses recorded this year.</div> : (
          <div className="space-y-2 mt-3">
            {data.topExpenses.map((e) => {
              const max = data.topExpenses![0].total || 1
              return (
                <div key={e.account} style={{ fontSize: 13 }}>
                  <div className="flex justify-between"><span>{e.account}</span><b>{aed(e.total)}</b></div>
                  <div style={{ height: 6, borderRadius: 6, background: '#F3F0F7', marginTop: 3 }}>
                    <div style={{ height: '100%', width: `${(e.total / max) * 100}%`, background: '#F59E0B', borderRadius: 6 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
