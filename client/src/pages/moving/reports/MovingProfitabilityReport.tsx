import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'

interface ProfitRow {
  _id: string; jobNo: string; customer: string; scheduledDate: string; status: string
  invoiceNo?: string; invoiceStatus?: string
  revenue: number; cost: number; profit: number; margin: number
  costs: { labor?: number; truck?: number; materials?: number; packing?: number; extras?: number; externalHires?: number }
}

interface Summary { totalRevenue: number; totalCost: number; totalProfit: number; avgMargin: number; jobCount: number }

export default function MovingProfitabilityReport() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, isLoading } = useQuery<{ rows: ProfitRow[]; summary: Summary }>({
    queryKey: ['moving-report-profitability', from, to],
    queryFn: () => api.get('/moving-reports/profitability', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data),
  })

  const rows = data?.rows ?? []
  const s = data?.summary

  return (
    <div className="space-y-6">
      <PageHeader title="Job Profitability" subtitle="Revenue vs cost per completed job" />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        {(from || to) && <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>}
      </div>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="p-4"><div className="text-xs text-muted-foreground">Jobs</div><div className="text-2xl font-bold">{s.jobCount}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Revenue</div><div className="text-2xl font-bold text-blue-600">AED {s.totalRevenue.toLocaleString()}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Total Cost</div><div className="text-2xl font-bold text-amber-600">AED {s.totalCost.toLocaleString()}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Profit</div><div className={`text-2xl font-bold ${s.totalProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}>AED {s.totalProfit.toLocaleString()}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Avg Margin</div><div className={`text-2xl font-bold ${s.avgMargin >= 0 ? 'text-green-600' : 'text-destructive'}`}>{s.avgMargin}%</div></Card>
        </div>
      )}

      <Card>
        <CardHeader title={`${rows.length} jobs`} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No completed/invoiced jobs found" /> : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Job</Th><Th>Customer</Th><Th>Date</Th><Th>Invoice</Th>
                    <Th className="text-right">Revenue</Th><Th className="text-right">Cost</Th>
                    <Th className="text-right">Profit</Th><Th className="text-right">Margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r._id} className="hover:bg-muted/30">
                      <Td><Link to={`/moving/jobs/${r._id}`} className="text-primary font-medium hover:underline">{r.jobNo}</Link></Td>
                      <Td>{r.customer || '—'}</Td>
                      <Td>{r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : '—'}</Td>
                      <Td>{r.invoiceNo ? <Badge tone={r.invoiceStatus === 'paid' ? 'green' : 'amber'}>{r.invoiceNo}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="text-right font-medium">AED {r.revenue.toLocaleString()}</Td>
                      <Td className="text-right">AED {r.cost.toLocaleString()}</Td>
                      <Td className={`text-right font-bold ${r.profit >= 0 ? 'text-green-600' : 'text-destructive'}`}>AED {r.profit.toLocaleString()}</Td>
                      <Td className="text-right">
                        <Badge tone={r.margin >= 30 ? 'green' : r.margin >= 10 ? 'amber' : 'red'}>{r.margin}%</Badge>
                      </Td>
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
