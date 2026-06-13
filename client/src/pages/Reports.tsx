import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import type { Contract, Summary, Unit } from '../lib/types'
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Reports() {
  const [minSize, setMinSize] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: summary } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  })
  const { data: revenue, isLoading: revLoading } = useQuery<{ month: string; total: number; payments: number }[]>({
    queryKey: ['revenue'],
    queryFn: () => api.get('/reports/revenue', { params: { months: 6 } }).then((r) => r.data),
  })
  const { data: availability } = useQuery<Unit[]>({
    queryKey: ['availability', minSize, from, to],
    queryFn: () => api.get('/reports/availability', { params: { minSize: minSize || undefined, from: from || undefined, to: to || undefined } }).then((r) => r.data),
  })
  const { data: vacancies } = useQuery<Contract[]>({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/reports/vacancies', { params: { days: 30 } }).then((r) => r.data),
  })

  return (
    <div>
      <PageHeader title="Reports" subtitle="Occupancy, revenue, and availability" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Revenue (last 6 months)"
            subtitle="Collected payments by month"
            action={
              <Button size="sm" variant="outline" onClick={() => revenue && downloadCsv('revenue.csv', [['Month', 'Total', 'Payments'], ...revenue.map((r) => [r.month, r.total, r.payments])])}>
                <Download size={13} /> CSV
              </Button>
            }
          />
          <CardBody>
            {revLoading || !revenue ? (
              <Spinner />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v) => formatMoney(Number(v))} />
                  <Bar dataKey="total" name="Revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Occupancy by size"
            action={
              <Button size="sm" variant="outline" onClick={() => summary && downloadCsv('occupancy.csv', [['Size (sqf)', 'Total', 'Available', 'Occupied', 'Maintenance'], ...summary.bySize.map((s) => [s.sizeSqf, s.total, s.available, s.occupied, s.maintenance])])}>
                <Download size={13} /> CSV
              </Button>
            }
          />
          <Table>
            <thead><tr><Th>Size</Th><Th>Total units</Th><Th>Available</Th><Th>Occupied</Th><Th>Maintenance</Th><Th>Occupancy</Th></tr></thead>
            <tbody>
              {(summary?.bySize || []).map((s) => {
                const rentable = s.total - s.maintenance
                const pct = rentable ? Math.round((s.occupied / rentable) * 100) : 0
                return (
                  <tr key={s.sizeSqf} className="hover:bg-muted/50">
                    <Td className="font-medium">{s.sizeSqf} sq ft</Td>
                    <Td>{s.total}</Td>
                    <Td>{s.available}</Td>
                    <Td>{s.occupied}</Td>
                    <Td>{s.maintenance}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Availability search" subtitle="Find free units by size and date range" />
        <CardBody>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Minimum size (sq ft)">
              <Input type="number" min={0} value={minSize} onChange={(e) => setMinSize(e.target.value)} placeholder="Any" className="w-36" />
            </Field>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
            <div className="text-sm text-muted-foreground pb-2">{availability?.length ?? 0} units free</div>
          </div>
          {(availability || []).length === 0 ? (
            <EmptyState message="No units available for the selected criteria." />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
              {(availability || []).map((u) => (
                <div key={u._id} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-2.5 text-center">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{u.unitNumber}</div>
                  <div className="text-[10px] text-muted-foreground">{u.sizeSqf ?? '—'} sqf{u.price != null ? ` · ${formatMoney(u.price)}/mo` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Upcoming vacancies" subtitle="Active contracts ending in the next 30 days" />
        {(vacancies || []).length === 0 ? (
          <EmptyState message="No vacancies coming up in the next 30 days." />
        ) : (
          <Table>
            <thead><tr><Th>Contract</Th><Th>Customer</Th><Th>Unit</Th><Th>Size</Th><Th>Ends</Th><Th>Auto-renew</Th></tr></thead>
            <tbody>
              {(vacancies || []).map((c) => (
                <tr key={c._id} className="hover:bg-muted/50">
                  <Td><Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">{c.contractNo}</Link></Td>
                  <Td>{c.customer?.fullName}</Td>
                  <Td>{c.unit?.unitNumber}</Td>
                  <Td>{c.unit?.sizeSqf ?? '—'} sq ft</Td>
                  <Td>{formatDate(c.endDate)}</Td>
                  <Td>{c.autoRenew ? 'Yes' : 'No'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
