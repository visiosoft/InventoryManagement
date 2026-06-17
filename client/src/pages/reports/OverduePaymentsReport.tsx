import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Download, Wallet } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { downloadCsv, StatCard } from './shared'

function daysOverdue(date: string) {
  return Math.max(0, Math.ceil((Date.now() - new Date(date).getTime()) / 86400000))
}

export default function OverduePaymentsReport() {
  const { data, isLoading } = useQuery<{ payments: any[]; total: number }>({
    queryKey: ['overdue-payments'],
    queryFn: () => api.get('/reports/overdue').then(r => r.data),
  })

  const payments = data?.payments ?? []
  const total    = data?.total ?? 0

  const oldest = payments.length
    ? Math.max(...payments.map(p => daysOverdue(p.dueDate)))
    : 0
  const avg = payments.length ? total / payments.length : 0

  const byContract = payments.reduce<Record<string, number>>((acc, p) => {
    const id = p.contract?._id ?? 'unknown'
    acc[id] = (acc[id] ?? 0) + Number(p.amount || 0)
    return acc
  }, {})
  const contractsAffected = Object.keys(byContract).length

  return (
    <div>
      <PageHeader
        title="Overdue Payments"
        subtitle="All currently overdue payment entries across active contracts"
        action={
          payments.length > 0 && (
            <Button size="sm" variant="outline" onClick={() =>
              downloadCsv('overdue-payments.csv', [
                ['Customer', 'Phone', 'Unit', 'Size (sqf)', 'Amount (AED)', 'Due Date', 'Days Overdue', 'Contract'],
                ...payments.map(p => [
                  p.contract?.customer?.fullName ?? '—',
                  p.contract?.customer?.phone ?? '—',
                  p.contract?.unit?.unitNumber ?? '—',
                  p.contract?.unit?.sizeSqf ?? '—',
                  p.amount,
                  p.dueDate,
                  daysOverdue(p.dueDate),
                  p.contract?.contractNo ?? '—',
                ]),
              ])}>
              <Download size={13} /> CSV
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Overdue" value={`AED ${formatMoney(total)}`} icon={Wallet}
          tone={total > 0 ? 'red' : 'green'} sub={`${payments.length} payment${payments.length !== 1 ? 's' : ''}`} />
        <StatCard label="Contracts Affected" value={String(contractsAffected)} icon={AlertTriangle}
          tone={contractsAffected > 0 ? 'amber' : 'green'} sub="with at least one overdue" />
        <StatCard label="Oldest Overdue" value={`${oldest} day${oldest !== 1 ? 's' : ''}`} icon={Clock}
          tone={oldest > 30 ? 'red' : oldest > 7 ? 'amber' : 'green'} sub="since due date" />
        <StatCard label="Average Amount" value={`AED ${formatMoney(avg)}`} icon={Wallet}
          tone="default" sub="per overdue entry" />
      </div>

      {isLoading ? <Spinner /> : payments.length === 0 ? (
        <Card>
          <EmptyState message="No overdue payments. All payments are up to date." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${payments.length} overdue payment${payments.length !== 1 ? 's' : ''}`}
            subtitle={`Total outstanding: AED ${formatMoney(total)}`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Unit</Th>
                <Th>Amount</Th>
                <Th>Due Date</Th>
                <Th>Days Overdue</Th>
                <Th>Contract</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => {
                const days = daysOverdue(p.dueDate)
                return (
                  <tr key={p._id} className="hover:bg-muted/50">
                    <Td>
                      <div>
                        <div className="font-medium">{p.contract?.customer?.fullName ?? '—'}</div>
                        {p.contract?.customer?.phone && (
                          <div className="text-xs text-muted-foreground">{p.contract.customer.phone}</div>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium">{p.contract?.unit?.unitNumber ?? '—'}</div>
                      {p.contract?.unit?.sizeSqf && (
                        <div className="text-xs text-muted-foreground">{p.contract.unit.sizeSqf} sqf</div>
                      )}
                    </Td>
                    <Td className="text-red-600 dark:text-red-400 font-semibold">
                      AED {formatMoney(p.amount)}
                    </Td>
                    <Td className="text-muted-foreground text-xs">{formatDate(p.dueDate)}</Td>
                    <Td>
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
                        days > 30
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : days > 7
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {days} day{days !== 1 ? 's' : ''}
                      </span>
                    </Td>
                    <Td>
                      {p.contract ? (
                        <Link to={`/contracts/${p.contract._id}`} className="text-primary hover:underline text-xs">
                          {p.contract.contractNo}
                        </Link>
                      ) : '—'}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
