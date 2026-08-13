import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th, Input } from '../../../components/ui'
import { CHART_STYLE, StatCard, downloadCsv } from './shared'

interface PaymentRow {
  invoiceId: string; invoiceNo: string; customer: string; amount: number; date: string; notes: string
}
interface MonthRow { month: string; count: number; total: number }
interface StripePaymentsData {
  rows: PaymentRow[]
  monthly: MonthRow[]
  summary: { count: number; totalAmount: number }
}

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export default function MovingStripePaymentsReport() {
  const [months, setMonths] = useState('12')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const useCustomRange = !!(from && to)

  const { data, isLoading } = useQuery<StripePaymentsData>({
    queryKey: ['moving-report-stripe-payments', months, from, to],
    queryFn: () => api.get('/moving-reports/stripe-payments', {
      params: useCustomRange ? { from, to } : { months },
    }).then(r => r.data),
  })

  const rows = data?.rows ?? []
  const monthly = (data?.monthly ?? []).map(m => ({ ...m, label: monthLabel(m.month) }))
  const summary = data?.summary

  return (
    <div className="space-y-6">
      <PageHeader title="Stripe Payments" subtitle="Payments received online via Stripe Checkout, by month" />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Quick range" className="max-w-[200px]">
          <Select value={months} onChange={e => { setMonths(e.target.value); setFrom(''); setTo('') }} disabled={useCustomRange}>
            <option value="1">This month</option>
            <option value="3">Last 3 months</option>
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
            <option value="24">Last 24 months</option>
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        {useCustomRange && <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear dates</Button>}
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Payments received" value={String(summary.count)} />
          <StatCard label="Total collected" value={money(summary.totalAmount)} tone="green" />
          <StatCard label="Average payment" value={summary.count > 0 ? money(summary.totalAmount / summary.count) : money(0)} />
        </div>
      )}

      <Card>
        <CardHeader title="Monthly total" />
        <CardBody>
          {isLoading ? <Spinner /> : monthly.length === 0 ? <EmptyState message="No Stripe payments in this range" /> : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis tick={CHART_STYLE.axisStyle} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="total" name="Collected" fill="#5B2BC9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${rows.length} payment${rows.length !== 1 ? 's' : ''}`}
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('stripe-payments.csv', [
              ['Date', 'Invoice', 'Customer', 'Amount'],
              ...rows.map(r => [new Date(r.date).toLocaleDateString(), r.invoiceNo, r.customer, r.amount]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No Stripe payments in this range" /> : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr><Th>Date</Th><Th>Invoice</Th><Th>Customer</Th><Th className="text-right">Amount</Th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.invoiceId}-${i}`} className="hover:bg-muted/30">
                      <Td className="text-muted-foreground">{new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                      <Td><Link to={`/moving/invoices/${r.invoiceId}`} className="text-primary font-medium hover:underline">{r.invoiceNo}</Link></Td>
                      <Td>{r.customer || '—'}</Td>
                      <Td className="text-right font-bold">{money(r.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
