import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, CheckCircle2, Download, TrendingUp } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { downloadCsv, StatCard } from './shared'

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
}

export default function ContractsReport() {
  const { data: summary, isLoading } = useQuery<any>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then(r => r.data),
  })
  const { data: vacancies } = useQuery<any[]>({
    queryKey: ['vacancies'],
    queryFn: () => api.get('/reports/vacancies', { params: { days: 30 } }).then(r => r.data),
  })

  return (
    <div>
      <PageHeader title="Contracts Overview" subtitle="Occupancy, expiring contracts, vacancies, and overdue payments" />

      {isLoading ? <Spinner /> : summary && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Units" value={String(summary.totalUnits)} icon={Building2} />
            <StatCard label="Occupied" value={String(summary.byStatus?.occupied ?? 0)}
              sub={`+ ${summary.byStatus?.reserved ?? 0} reserved`} tone="green" icon={CheckCircle2} />
            <StatCard label="Available" value={String(summary.byStatus?.available ?? 0)}
              sub="ready to rent" tone="amber" icon={Building2} />
            <StatCard label="Occupancy Rate" value={`${summary.occupancyPct ?? 0}%`}
              sub="of rentable units"
              tone={summary.occupancyPct >= 80 ? 'green' : summary.occupancyPct >= 50 ? 'amber' : 'red'}
              icon={TrendingUp} />
          </div>

          {/* Revenue cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Revenue This Month" value={`AED ${formatMoney(summary.revenueThisMonth ?? 0)}`}
              sub="collected so far" tone="green" icon={TrendingUp} />
            <StatCard label="Expected This Month" value={`AED ${formatMoney(summary.expectedThisMonth ?? 0)}`}
              sub="including outstanding" icon={TrendingUp} />
          </div>

          {/* Occupancy by size */}
          <Card>
            <CardHeader
              title="Occupancy by unit size"
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv('occupancy-by-size.csv', [
                    ['Size', 'Total', 'Available', 'Occupied', 'Maintenance', 'Occupancy %'],
                    ...(summary.bySize ?? []).map((s: any) => {
                      const rentable = s.total - s.maintenance
                      return [s.sizeSqf, s.total, s.available, s.occupied, s.maintenance,
                        rentable ? Math.round(s.occupied / rentable * 100) : 0]
                    }),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Size</Th><Th>Total</Th><Th>Available</Th>
                  <Th>Occupied</Th><Th>Maintenance</Th><Th>Occupancy</Th>
                </tr>
              </thead>
              <tbody>
                {(summary.bySize ?? []).map((s: any) => {
                  const rentable = s.total - s.maintenance
                  const pct = rentable ? Math.round(s.occupied / rentable * 100) : 0
                  return (
                    <tr key={s.sizeSqf} className="hover:bg-muted/50">
                      <Td className="font-medium">{s.sizeSqf}</Td>
                      <Td>{s.total}</Td>
                      <Td className={s.available > 0 ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground'}>
                        {s.available}
                      </Td>
                      <Td className="text-emerald-700 dark:text-emerald-400 font-medium">{s.occupied}</Td>
                      <Td className="text-muted-foreground">{s.maintenance}</Td>
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

          {/* Expiring soon */}
          <Card>
            <CardHeader
              title="Contracts expiring soon"
              subtitle="Active contracts ending in the next 15 days"
              action={
                (summary.expiringContracts ?? []).length > 0 && (
                  <Button size="sm" variant="outline" onClick={() =>
                    downloadCsv('expiring-contracts.csv', [
                      ['Customer', 'Unit', 'Contract', 'End Date', 'Days Left'],
                      ...(summary.expiringContracts ?? []).map((c: any) => [
                        c.customer?.fullName, c.unit?.unitNumber, c.contractNo,
                        c.endDate, daysUntil(c.endDate),
                      ]),
                    ])}>
                    <Download size={13} /> CSV
                  </Button>
                )
              }
            />
            {(summary.expiringContracts ?? []).length === 0
              ? <EmptyState message="No contracts expiring in the next 15 days." />
              : (
                <Table>
                  <thead>
                    <tr><Th>Customer</Th><Th>Unit</Th><Th>Contract</Th><Th>End Date</Th><Th>Days Left</Th></tr>
                  </thead>
                  <tbody>
                    {(summary.expiringContracts as any[]).map((c) => {
                      const dl = daysUntil(c.endDate)
                      return (
                        <tr key={c._id} className="hover:bg-muted/50">
                          <Td className="font-medium">{c.customer?.fullName}</Td>
                          <Td>{c.unit?.unitNumber}</Td>
                          <Td>
                            <Link to={`/contracts/${c._id}`} className="text-primary hover:underline text-xs">
                              {c.contractNo}
                            </Link>
                          </Td>
                          <Td>{formatDate(c.endDate)}</Td>
                          <Td className={dl <= 3 ? 'text-destructive font-semibold' : dl <= 7 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                            {dl} day{dl !== 1 ? 's' : ''}
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
          </Card>

          {/* Upcoming vacancies */}
          <Card>
            <CardHeader title="Upcoming vacancies" subtitle="Active contracts ending in the next 30 days" />
            {!(vacancies?.length)
              ? <EmptyState message="No vacancies coming up in the next 30 days." />
              : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Contract</Th><Th>Customer</Th><Th>Unit</Th>
                      <Th>Size</Th><Th>End Date</Th><Th>Auto-renew</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacancies.map((c: any) => (
                      <tr key={c._id} className="hover:bg-muted/50">
                        <Td>
                          <Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">
                            {c.contractNo}
                          </Link>
                        </Td>
                        <Td>{c.customer?.fullName}</Td>
                        <Td>{c.unit?.unitNumber}</Td>
                        <Td className="text-muted-foreground">{c.unit?.sizeSqf ? `${c.unit.sizeSqf} sqf` : '—'}</Td>
                        <Td>{formatDate(c.endDate)}</Td>
                        <Td className={c.autoRenew ? 'text-emerald-600' : 'text-muted-foreground'}>
                          {c.autoRenew ? 'Yes' : 'No'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
          </Card>

          {/* Overdue payments */}
          {(summary.overduePayments ?? []).length > 0 && (
            <Card>
              <CardHeader
                title="Overdue payments"
                subtitle="All currently overdue payment entries"
                action={
                  <Button size="sm" variant="outline" onClick={() =>
                    downloadCsv('overdue-payments.csv', [
                      ['Customer', 'Unit', 'Amount (AED)', 'Due Date', 'Contract'],
                      ...(summary.overduePayments as any[]).map(p => [
                        p.contract?.customer?.fullName, p.contract?.unit?.unitNumber,
                        p.amount, p.dueDate, p.contract?.contractNo,
                      ]),
                    ])}>
                    <Download size={13} /> CSV
                  </Button>
                }
              />
              <Table>
                <thead>
                  <tr><Th>Customer</Th><Th>Unit</Th><Th>Amount</Th><Th>Due Date</Th><Th>Contract</Th></tr>
                </thead>
                <tbody>
                  {(summary.overduePayments as any[]).map((p) => (
                    <tr key={p._id} className="hover:bg-muted/50">
                      <Td className="font-medium">{p.contract?.customer?.fullName ?? '—'}</Td>
                      <Td>{p.contract?.unit?.unitNumber ?? '—'}</Td>
                      <Td className="text-red-600 dark:text-red-400 font-semibold">AED {formatMoney(p.amount)}</Td>
                      <Td className="text-muted-foreground text-xs">{formatDate(p.dueDate)}</Td>
                      <Td>
                        <Link to={`/contracts/${p.contract?._id}`} className="text-primary hover:underline text-xs">
                          {p.contract?.contractNo}
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
