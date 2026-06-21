import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, Download, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../lib/api'
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { CHART_STYLE, downloadCsv, StatCard, type ForecastData } from './shared'

export default function ForecastReport() {
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [syncMsg, setSyncMsg]     = useState<string | null>(null)
  const hasSynced                 = useRef(false)
  const qc                        = useQueryClient()

  const { data, isLoading } = useQuery<ForecastData>({
    queryKey: ['forecast'],
    queryFn: () => api.get('/reports/forecast', { params: { months: 6 } }).then(r => r.data),
  })

  const sync = useMutation({
    mutationFn: () => api.post('/contracts/auto-invoices', null, { params: { months: 3 } }).then(r => r.data),
    onSuccess: (result) => {
      if (result.generated > 0) {
        setSyncMsg(`Generated ${result.generated} new invoice${result.generated !== 1 ? 's' : ''} for upcoming periods.`)
        qc.invalidateQueries({ queryKey: ['forecast'] })
      } else {
        setSyncMsg('All upcoming invoices are up to date.')
      }
      setTimeout(() => setSyncMsg(null), 5000)
    },
  })

  // Auto-sync once on first load
  useEffect(() => {
    if (!hasSynced.current) {
      hasSynced.current = true
      sync.mutate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="Payment Forecast"
        subtitle="Expected income per month from active contracts"
        action={
          <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw size={13} className={sync.isPending ? 'animate-spin' : ''} />
            {sync.isPending ? 'Syncing…' : 'Sync invoices'}
          </Button>
        }
      />

      {/* Sync result banner */}
      {syncMsg && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary flex items-center gap-2">
          <RefreshCw size={13} />
          {syncMsg}
        </div>
      )}

      {isLoading ? <Spinner /> : data && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Active Contracts" value={String(data.activeContracts)}
              sub="currently running" icon={Users} />
            <StatCard label="Monthly Run Rate" value={`AED ${formatMoney(data.monthlyRunRate)}`}
              sub="expected per month from active contracts" tone="green" icon={TrendingUp} />
            <StatCard label="Outstanding Balance" value={`AED ${formatMoney(data.overdueBalance)}`}
              sub="pending + overdue payments"
              tone={data.overdueBalance > 0 ? 'red' : 'default'} icon={AlertTriangle} />
          </div>

          {/* Chart */}
          <Card>
            <CardHeader title="Expected vs Actual" subtitle="2 months history + 6 months forecast" />
            <CardBody>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.forecast} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} width={72}
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle}
                    formatter={(v, name) => {
                      const amount = typeof v === 'number' ? v : Number(v ?? 0)
                      const label = String(name ?? '')
                      return [`AED ${formatMoney(amount)}`, label]
                    }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="expected" name="Expected" fill="#8b5cf6" radius={[4, 4, 0, 0]} opacity={0.7} />
                  <Bar dataKey="actual" name="Actual Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Expandable month breakdown */}
          <Card>
            <CardHeader
              title="Month-by-month breakdown"
              subtitle="Click a row to see which contracts contribute"
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv('forecast.csv', [
                    ['Month', 'Active Contracts', 'Expected (AED)', 'Actual Collected (AED)', 'Variance (AED)'],
                    ...data.forecast.map(f => [
                      f.month, f.contractCount, f.expected,
                      f.actual ?? '', f.actual != null ? f.actual - f.expected : '',
                    ]),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th className="w-8" />
                  <Th>Month</Th>
                  <Th>Active Contracts</Th>
                  <Th>Expected</Th>
                  <Th>Actual Collected</Th>
                  <Th>Variance</Th>
                </tr>
              </thead>
              <tbody>
                {data.forecast.map((f) => {
                  const isExpanded = expanded === f.monthISO
                  const variance = f.actual != null ? f.actual - f.expected : null
                  return (
                    <>
                      <tr
                        key={f.monthISO}
                        className={`cursor-pointer hover:bg-muted/50 ${f.isCurrent ? 'bg-primary/5' : ''}`}
                        onClick={() => setExpanded(isExpanded ? null : f.monthISO)}
                      >
                        <Td className="w-8">
                          {isExpanded
                            ? <ChevronDown size={14} className="text-muted-foreground" />
                            : <ChevronRight size={14} className="text-muted-foreground" />}
                        </Td>
                        <Td className="font-medium">
                          {f.month}
                          {f.isCurrent && (
                            <span className="ml-2 rounded-full bg-primary/20 text-primary text-[10px] font-semibold px-1.5 py-0.5">
                              Current
                            </span>
                          )}
                          {f.isPast && !f.isCurrent && (
                            <span className="ml-2 text-[10px] text-muted-foreground">Past</span>
                          )}
                        </Td>
                        <Td className="text-muted-foreground">{f.contractCount}</Td>
                        <Td className="font-medium">AED {formatMoney(f.expected)}</Td>
                        <Td className={f.actual != null ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                          {f.actual != null ? `AED ${formatMoney(f.actual)}` : '—'}
                        </Td>
                        <Td className={variance != null
                          ? variance >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-red-500 font-medium'
                          : 'text-muted-foreground'}>
                          {variance != null ? `${variance >= 0 ? '+' : ''}AED ${formatMoney(variance)}` : '—'}
                        </Td>
                      </tr>

                      {isExpanded && (
                        f.contracts.length === 0
                          ? (
                            <tr key={`${f.monthISO}-empty`} className="bg-muted/20">
                              <Td /><Td colSpan={5} className="text-xs text-muted-foreground pl-8 py-2">
                                No active contracts this month.
                              </Td>
                            </tr>
                          )
                          : f.contracts.map((c) => (
                            <tr key={`${f.monthISO}-${c._id}`} className="bg-muted/20 hover:bg-muted/30">
                              <Td />
                              <Td className="pl-8 text-xs">
                                <Link to={`/contracts/${c._id}`} className="text-primary hover:underline font-medium">
                                  {c.contractNo}
                                </Link>
                                <span className="text-muted-foreground"> — {c.customer} · Unit {c.unit}</span>
                              </Td>
                              <Td />
                              <Td className="text-xs text-muted-foreground">AED {formatMoney(c.monthlyRate)}/mo</Td>
                              <Td />
                              <Td className="text-xs text-muted-foreground">ends {formatDate(c.endDate)}</Td>
                            </tr>
                          ))
                      )}
                    </>
                  )
                })}

                {/* Totals row */}
                <tr className="bg-muted/40 font-semibold border-t">
                  <Td /><Td>Total (forecast)</Td><Td />
                  <Td>AED {formatMoney(data.forecast.filter(f => !f.isPast || f.isCurrent).reduce((s, f) => s + f.expected, 0))}</Td>
                  <Td className="text-emerald-700 dark:text-emerald-400">
                    AED {formatMoney(data.forecast.filter(f => f.actual != null).reduce((s, f) => s + (f.actual ?? 0), 0))}
                  </Td>
                  <Td />
                </tr>
              </tbody>
            </Table>
          </Card>

          {/* Outstanding balance callout */}
          {data.overdueBalance > 0 && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                  AED {formatMoney(data.overdueBalance)} outstanding
                </div>
                <div className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">
                  Pending and overdue payments not yet collected. Visit the Payments page to record or follow up.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
