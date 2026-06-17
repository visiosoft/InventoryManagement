import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, TrendingUp, Wallet, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { downloadCsv, StatCard, type TenantPaymentsData } from './shared'

export default function MonthlyReport() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )

  const { data, isLoading } = useQuery<TenantPaymentsData>({
    queryKey: ['tenant-payments', selectedMonth],
    queryFn: () => api.get('/reports/tenant-payments', { params: { month: selectedMonth } }).then(r => r.data),
  })

  const collectionRate = data
    ? data.totalPaid + data.totalPending > 0
      ? Math.round(data.totalPaid / (data.totalPaid + data.totalPending) * 100)
      : 100
    : 0

  return (
    <div>
      <PageHeader title="Monthly Payments" subtitle="Who has paid and who is outstanding this period" />

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <input
          type="month" value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <span className="text-sm font-medium text-muted-foreground">{data?.month ?? '—'}</span>
      </div>

      {isLoading ? <Spinner /> : data && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Collected" value={`AED ${formatMoney(data.totalPaid)}`}
              sub={`${data.countPaid} tenant${data.countPaid !== 1 ? 's' : ''}`} tone="green" icon={CheckCircle2} />
            <StatCard label="Outstanding" value={`AED ${formatMoney(data.totalPending)}`}
              sub={`${data.countPending} tenant${data.countPending !== 1 ? 's' : ''}`}
              tone={data.totalPending > 0 ? 'red' : 'default'} icon={XCircle} />
            <StatCard label="Total Billed" value={`AED ${formatMoney(data.totalPaid + data.totalPending)}`}
              sub={`${data.countPaid + data.countPending} tenants`} icon={Wallet} />
            <StatCard label="Collection Rate" value={`${collectionRate}%`}
              sub="of billed amount collected"
              tone={collectionRate >= 90 ? 'green' : collectionRate >= 60 ? 'amber' : 'red'}
              icon={TrendingUp} />
          </div>

          {/* Paid tenants */}
          <Card>
            <CardHeader
              title={`Paid (${data.countPaid})`}
              subtitle={`AED ${formatMoney(data.totalPaid)} collected`}
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv(`paid-${selectedMonth}.csv`, [
                    ['Customer', 'Unit', 'Size (sqf)', 'Contract', 'Weeks', 'Amount', 'Method', 'Paid Date'],
                    ...data.paid.map(r => [
                      r.customer?.fullName, r.unit?.unitNumber, r.unit?.sizeSqf ?? '',
                      r.contractNo, r.payments.length, r.total,
                      r.methods.join('/'), r.latestPaidDate ? formatDate(r.latestPaidDate) : '',
                    ]),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            {data.paid.length === 0
              ? <EmptyState message="No paid tenants for this period." />
              : (
                <Table>
                  <thead>
                    <tr>
                      <Th>#</Th><Th>Customer</Th><Th>Unit</Th><Th>Size</Th>
                      <Th>Weeks</Th><Th>Amount</Th><Th>Method</Th><Th>Paid On</Th><Th>Contract</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paid.map((r, i) => (
                      <tr key={r.contractId} className="hover:bg-muted/50">
                        <Td className="text-muted-foreground text-xs">{i + 1}</Td>
                        <Td className="font-medium">{r.customer?.fullName ?? '—'}</Td>
                        <Td>{r.unit?.unitNumber ?? '—'}</Td>
                        <Td className="text-muted-foreground">{r.unit?.sizeSqf ? `${r.unit.sizeSqf} sqf` : '—'}</Td>
                        <Td className="text-muted-foreground">{r.payments.length}</Td>
                        <Td className="font-semibold text-emerald-700 dark:text-emerald-400">AED {formatMoney(r.total)}</Td>
                        <Td className="capitalize text-xs text-muted-foreground">{r.methods.join(', ') || '—'}</Td>
                        <Td className="text-xs text-muted-foreground">{r.latestPaidDate ? formatDate(r.latestPaidDate) : '—'}</Td>
                        <Td>
                          <Link to={`/contracts/${r.contractId}`} className="text-primary hover:underline text-xs">
                            {r.contractNo}
                          </Link>
                        </Td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold text-sm">
                      <Td /><Td colSpan={4}>Total collected</Td>
                      <Td className="text-emerald-700 dark:text-emerald-400">AED {formatMoney(data.totalPaid)}</Td>
                      <Td /><Td /><Td />
                    </tr>
                  </tbody>
                </Table>
              )}
          </Card>

          {/* Pending / overdue tenants */}
          <Card>
            <CardHeader
              title={`Pending / Overdue (${data.countPending})`}
              subtitle={data.totalPending > 0 ? `AED ${formatMoney(data.totalPending)} outstanding` : 'All tenants have paid'}
              action={
                data.pending.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() =>
                    downloadCsv(`pending-${selectedMonth}.csv`, [
                      ['Customer', 'Phone', 'Unit', 'Size (sqf)', 'Contract', 'Amount Due', 'Paid', 'Balance', 'Status'],
                      ...data.pending.map(r => [
                        r.customer?.fullName, r.customer?.phone, r.unit?.unitNumber,
                        r.unit?.sizeSqf ?? '', r.contractNo, r.total, r.paidAmt,
                        r.total - r.paidAmt, r.status,
                      ]),
                    ])}>
                    <Download size={13} /> CSV
                  </Button>
                )
              }
            />
            {data.pending.length === 0
              ? <EmptyState message="All tenants have paid for this period." />
              : (
                <Table>
                  <thead>
                    <tr>
                      <Th>#</Th><Th>Customer</Th><Th>Phone</Th><Th>Unit</Th><Th>Size</Th>
                      <Th>Total Due</Th><Th>Paid</Th><Th>Balance</Th><Th>Status</Th><Th>Contract</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending.map((r, i) => (
                      <tr key={r.contractId} className="hover:bg-muted/50">
                        <Td className="text-muted-foreground text-xs">{i + 1}</Td>
                        <Td className="font-medium">{r.customer?.fullName ?? '—'}</Td>
                        <Td className="text-xs text-muted-foreground">{r.customer?.phone || '—'}</Td>
                        <Td>{r.unit?.unitNumber ?? '—'}</Td>
                        <Td className="text-muted-foreground">{r.unit?.sizeSqf ? `${r.unit.sizeSqf} sqf` : '—'}</Td>
                        <Td className="font-medium">AED {formatMoney(r.total)}</Td>
                        <Td className="text-emerald-700 dark:text-emerald-400">
                          {r.paidAmt > 0 ? `AED ${formatMoney(r.paidAmt)}` : '—'}
                        </Td>
                        <Td className="font-semibold text-red-600 dark:text-red-400">
                          AED {formatMoney(r.total - r.paidAmt)}
                        </Td>
                        <Td>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold
                            ${r.status === 'overdue'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                            {r.status === 'overdue' ? 'Overdue' : 'Pending'}
                          </span>
                        </Td>
                        <Td>
                          <Link to={`/contracts/${r.contractId}`} className="text-primary hover:underline text-xs">
                            {r.contractNo}
                          </Link>
                        </Td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold text-sm">
                      <Td /><Td colSpan={5}>Total outstanding</Td>
                      <Td />
                      <Td className="text-red-600 dark:text-red-400">AED {formatMoney(data.totalPending)}</Td>
                      <Td /><Td />
                    </tr>
                  </tbody>
                </Table>
              )}
          </Card>
        </div>
      )}
    </div>
  )
}
