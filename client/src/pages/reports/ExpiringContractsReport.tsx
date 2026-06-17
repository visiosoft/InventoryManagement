import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Download, FileText } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { downloadCsv, StatCard } from './shared'

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
}

export default function ExpiringContractsReport() {
  const [days, setDays] = useState(30)

  const { data: contracts = [], isLoading } = useQuery<any[]>({
    queryKey: ['expiring-contracts', days],
    queryFn: () => api.get('/reports/expiring', { params: { days } }).then(r => r.data),
  })

  const critical  = contracts.filter(c => daysUntil(c.endDate) <= 3).length
  const urgent    = contracts.filter(c => { const d = daysUntil(c.endDate); return d > 3 && d <= 7 }).length
  const totalRate = contracts.reduce((s, c) => s + Number(c.rate || 0), 0)

  return (
    <div>
      <PageHeader
        title="Contracts Expiring Soon"
        subtitle="Active contracts ending within the selected window"
        action={
          <div className="flex items-center gap-2">
            <Select value={String(days)} onChange={e => setDays(Number(e.target.value))} className="w-36">
              <option value="7">Next 7 days</option>
              <option value="15">Next 15 days</option>
              <option value="30">Next 30 days</option>
              <option value="60">Next 60 days</option>
              <option value="90">Next 90 days</option>
            </Select>
            {contracts.length > 0 && (
              <Button size="sm" variant="outline" onClick={() =>
                downloadCsv('expiring-contracts.csv', [
                  ['Contract', 'Customer', 'Phone', 'Unit', 'Floor', 'Size (sqf)', 'End Date', 'Days Left', 'Weekly Rate (AED)'],
                  ...contracts.map(c => [
                    c.contractNo,
                    c.customer?.fullName ?? '',
                    c.customer?.phone ?? '',
                    c.unit?.unitNumber ?? '',
                    c.unit?.floor ?? '',
                    c.unit?.sizeSqf ?? '',
                    c.endDate,
                    daysUntil(c.endDate),
                    c.rate ?? '',
                  ]),
                ])}>
                <Download size={13} /> CSV
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label={`Expiring in ${days} days`} value={String(contracts.length)} icon={FileText}
          tone={contracts.length > 0 ? 'amber' : 'green'} />
        <StatCard label="Critical (≤ 3 days)" value={String(critical)} icon={AlertTriangle}
          tone={critical > 0 ? 'red' : 'green'} sub="need immediate action" />
        <StatCard label="Urgent (4–7 days)" value={String(urgent)} icon={Clock}
          tone={urgent > 0 ? 'amber' : 'green'} sub="follow up soon" />
        <StatCard label="Revenue at Risk" value={`AED ${formatMoney(totalRate)}`} icon={FileText}
          tone={contracts.length > 0 ? 'amber' : 'green'} sub="monthly rate of expiring" />
      </div>

      {isLoading ? <Spinner /> : contracts.length === 0 ? (
        <Card><EmptyState message={`No contracts expiring in the next ${days} days.`} /></Card>
      ) : (
        <Card>
          <CardHeader
            title={`${contracts.length} contract${contracts.length !== 1 ? 's' : ''} expiring`}
            subtitle={`Within the next ${days} days`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Contract</Th>
                <Th>Customer</Th>
                <Th>Unit</Th>
                <Th>Floor</Th>
                <Th>Size</Th>
                <Th>End Date</Th>
                <Th>Days Left</Th>
                <Th>Weekly Rate</Th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c: any) => {
                const dl = daysUntil(c.endDate)
                return (
                  <tr key={c._id} className="hover:bg-muted/50">
                    <Td>
                      <Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">
                        {c.contractNo}
                      </Link>
                    </Td>
                    <Td>
                      <div className="font-medium">{c.customer?.fullName ?? '—'}</div>
                      {c.customer?.phone && (
                        <div className="text-xs text-muted-foreground">{c.customer.phone}</div>
                      )}
                    </Td>
                    <Td className="font-medium">{c.unit?.unitNumber ?? '—'}</Td>
                    <Td className="text-muted-foreground">{c.unit?.floor ?? '—'}</Td>
                    <Td className="text-muted-foreground">
                      {c.unit?.sizeSqf ? `${c.unit.sizeSqf} sqf` : '—'}
                    </Td>
                    <Td className="text-muted-foreground text-xs">{formatDate(c.endDate)}</Td>
                    <Td>
                      <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${
                        dl <= 3
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : dl <= 7
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground font-medium'
                      }`}>
                        {dl} day{dl !== 1 ? 's' : ''}
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">
                      {c.rate ? `AED ${formatMoney(c.rate)}` : '—'}
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
