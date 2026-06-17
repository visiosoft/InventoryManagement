import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, TrendingUp, Wallet } from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../../lib/api'
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { CHART_STYLE, downloadCsv, PIE_COLORS, StatCard, type ExpensesData, type ForecastData, type RevenueMonth } from './shared'

export default function FinancesReport() {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  const { data: revenue, isLoading: revLoading } = useQuery<RevenueMonth[]>({
    queryKey: ['revenue', 12],
    queryFn: () => api.get('/reports/revenue', { params: { months: 12 } }).then(r => r.data),
  })
  const { data: expenses, isLoading: expLoading } = useQuery<ExpensesData>({
    queryKey: ['expenses-breakdown', selectedYear],
    queryFn: () => api.get('/reports/expenses-breakdown', { params: { year: selectedYear } }).then(r => r.data),
  })
  const { data: forecast } = useQuery<ForecastData>({
    queryKey: ['forecast'],
    queryFn: () => api.get('/reports/forecast', { params: { months: 6 } }).then(r => r.data),
  })

  const totalRevenue12 = revenue?.reduce((s, r) => s + r.total, 0) ?? 0
  const netProfit = totalRevenue12 - (expenses?.totalExpenses ?? 0)

  return (
    <div>
      <PageHeader title="Finances" subtitle="Revenue, expenses, and profit overview" />

      {/* Year selector */}
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm text-muted-foreground">Expense year:</label>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* P&L summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Revenue (12 mo)" value={`AED ${formatMoney(totalRevenue12)}`}
          sub="collected payments" tone="green" icon={TrendingUp} />
        <StatCard label={`Expenses (${selectedYear})`} value={`AED ${formatMoney(expenses?.totalExpenses ?? 0)}`}
          sub={`${selectedYear} total`} tone="amber" icon={Wallet} />
        <StatCard label="Est. Net Profit" value={`AED ${formatMoney(netProfit)}`}
          sub="revenue minus expenses"
          tone={netProfit >= 0 ? 'green' : 'red'} icon={TrendingUp} />
        <StatCard label="Outstanding Balance" value={`AED ${formatMoney(forecast?.overdueBalance ?? 0)}`}
          sub="pending + overdue" tone={(forecast?.overdueBalance ?? 0) > 0 ? 'red' : 'default'} icon={AlertTriangle} />
      </div>

      {/* Revenue trend */}
      <Card className="mb-5">
        <CardHeader
          title="Revenue trend — last 12 months"
          subtitle="Collected payments by month"
          action={
            <Button size="sm" variant="outline" onClick={() =>
              revenue && downloadCsv('revenue-12mo.csv', [
                ['Month', 'Revenue (AED)', 'Payments'],
                ...revenue.map(r => [r.month, r.total, r.payments]),
              ])}>
              <Download size={13} /> CSV
            </Button>
          }
        />
        <CardBody>
          {revLoading ? <Spinner /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} width={70}
                  tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={CHART_STYLE.contentStyle}
                  formatter={(v) => {
                    const amount = typeof v === 'number' ? v : Number(v ?? 0)
                    return [`AED ${formatMoney(amount)}`, 'Revenue']
                  }} />
                <Line type="monotone" dataKey="total" name="Revenue" stroke="#8b5cf6" strokeWidth={2.5}
                  dot={{ r: 3, fill: '#8b5cf6' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      {/* Revenue table */}
      {revenue && (
        <Card className="mb-5">
          <CardHeader title="Monthly revenue detail" />
          <Table>
            <thead><tr><Th>Month</Th><Th>Revenue (AED)</Th><Th>Payments</Th><Th>Avg per Payment</Th></tr></thead>
            <tbody>
              {revenue.map(r => (
                <tr key={r.month} className="hover:bg-muted/50">
                  <Td className="font-medium">{r.month}</Td>
                  <Td className="font-semibold">{r.total > 0 ? `AED ${formatMoney(r.total)}` : <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="text-muted-foreground">{r.payments || '—'}</Td>
                  <Td className="text-muted-foreground">
                    {r.payments > 0 ? `AED ${formatMoney(r.total / r.payments)}` : '—'}
                  </Td>
                </tr>
              ))}
              <tr className="bg-muted/40 font-semibold">
                <Td>Total (12 mo)</Td>
                <Td>AED {formatMoney(totalRevenue12)}</Td>
                <Td>{revenue.reduce((s, r) => s + r.payments, 0)}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        </Card>
      )}

      {/* Expenses section */}
      {expLoading ? <Spinner /> : expenses && (
        <>
          {/* Charts row */}
          <div className="grid gap-4 lg:grid-cols-2 mb-5">
            <Card>
              <CardHeader title={`Expenses by month (${selectedYear})`} />
              <CardBody>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={expenses.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                    <YAxis tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} width={60}
                      tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={CHART_STYLE.contentStyle}
                      formatter={(v) => {
                        const amount = typeof v === 'number' ? v : Number(v ?? 0)
                        return [`AED ${formatMoney(amount)}`, 'Expenses']
                      }} />
                    <Bar dataKey="total" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Expenses by category" />
              <CardBody>
                {expenses.byCategory.length === 0
                  ? <EmptyState message="No expenses recorded." />
                  : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="50%" height={200}>
                        <PieChart>
                          <Pie data={expenses.byCategory} dataKey="total" nameKey="category"
                            cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                            {expenses.byCategory.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={CHART_STYLE.contentStyle}
                            formatter={(v) => {
                              const amount = typeof v === 'number' ? v : Number(v ?? 0)
                              return `AED ${formatMoney(amount)}`
                            }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-1.5 text-xs overflow-auto max-h-48">
                        {expenses.byCategory.map((c, i) => (
                          <div key={c.category} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="truncate text-muted-foreground">{c.category}</span>
                            </div>
                            <span className="font-medium shrink-0">AED {formatMoney(c.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </CardBody>
            </Card>
          </div>

          {/* Expense category table */}
          <Card className="mb-5">
            <CardHeader
              title={`Expense breakdown (${selectedYear})`}
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv(`expenses-${selectedYear}.csv`, [
                    ['Category', 'Entries', 'Total (AED)', '% of Total'],
                    ...expenses.byCategory.map(c => [
                      c.category, c.count, c.total,
                      expenses.totalExpenses ? Math.round(c.total / expenses.totalExpenses * 100) : 0,
                    ]),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            {expenses.byCategory.length === 0
              ? <EmptyState message="No expenses for this year." />
              : (
                <Table>
                  <thead><tr><Th>Category</Th><Th>Entries</Th><Th>Total</Th><Th>% of Total</Th></tr></thead>
                  <tbody>
                    {expenses.byCategory.map((c) => {
                      const pct = expenses.totalExpenses ? Math.round(c.total / expenses.totalExpenses * 100) : 0
                      return (
                        <tr key={c.category} className="hover:bg-muted/50">
                          <Td className="font-medium">{c.category}</Td>
                          <Td className="text-muted-foreground">{c.count}</Td>
                          <Td className="font-semibold">AED {formatMoney(c.total)}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">{pct}%</span>
                            </div>
                          </Td>
                        </tr>
                      )
                    })}
                    <tr className="bg-muted/40 font-semibold">
                      <Td>Total</Td>
                      <Td>{expenses.byCategory.reduce((s, c) => s + c.count, 0)}</Td>
                      <Td>AED {formatMoney(expenses.totalExpenses)}</Td>
                      <Td>100%</Td>
                    </tr>
                  </tbody>
                </Table>
              )}
          </Card>

          {/* Recent expenses */}
          {expenses.recent.length > 0 && (
            <Card>
              <CardHeader title="Recent expenses" subtitle="Last 20 recorded entries" />
              <Table>
                <thead><tr><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th>Vendor</Th><Th>Amount</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {expenses.recent.map((e) => (
                    <tr key={e._id} className="hover:bg-muted/50">
                      <Td className="text-muted-foreground text-xs">{formatDate(e.date)}</Td>
                      <Td className="font-medium">{e.description || '—'}</Td>
                      <Td className="text-xs text-muted-foreground">{e.category}</Td>
                      <Td className="text-xs">{e.vendor || '—'}</Td>
                      <Td className="font-semibold">AED {formatMoney(e.total)}</Td>
                      <Td><span className="capitalize text-xs text-muted-foreground">{e.status}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
