import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, CalendarOff, Download, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate, formatMoney } from '../../lib/utils'
import { downloadCsv, StatCard } from './shared'

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
}

export default function UpcomingVacanciesReport() {
  const [days, setDays] = useState(30)

  const { data: vacancies = [], isLoading } = useQuery<any[]>({
    queryKey: ['vacancies', days],
    queryFn: () => api.get('/reports/vacancies', { params: { days } }).then(r => r.data),
  })

  const autoRenewCount = vacancies.filter(c => c.autoRenew).length
  const noRenewCount   = vacancies.length - autoRenewCount
  const totalRate      = vacancies.reduce((s, c) => s + Number(c.rate || 0), 0)

  return (
    <div>
      <PageHeader
        title="Upcoming Vacancies"
        subtitle="Active contracts ending soon — plan your re-rentals"
        action={
          <div className="flex items-center gap-2">
            <Select value={String(days)} onChange={e => setDays(Number(e.target.value))} className="w-36">
              <option value="7">Next 7 days</option>
              <option value="15">Next 15 days</option>
              <option value="30">Next 30 days</option>
              <option value="60">Next 60 days</option>
              <option value="90">Next 90 days</option>
            </Select>
            {vacancies.length > 0 && (
              <Button size="sm" variant="outline" onClick={() =>
                downloadCsv('upcoming-vacancies.csv', [
                  ['Contract', 'Customer', 'Unit', 'Size (sqf)', 'End Date', 'Days Left', 'Auto-renew', 'Weekly Rate (AED)'],
                  ...vacancies.map(c => [
                    c.contractNo, c.customer?.fullName, c.unit?.unitNumber,
                    c.unit?.sizeSqf ?? '', c.endDate, daysUntil(c.endDate),
                    c.autoRenew ? 'Yes' : 'No', c.rate,
                  ]),
                ])}>
                <Download size={13} /> CSV
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label={`Ending in ${days} days`} value={String(vacancies.length)} icon={CalendarOff}
          tone={vacancies.length > 0 ? 'amber' : 'green'} />
        <StatCard label="Auto-renewing" value={String(autoRenewCount)} icon={RefreshCw} tone="green"
          sub="will renew automatically" />
        <StatCard label="Vacating" value={String(noRenewCount)} icon={Building2}
          tone={noRenewCount > 0 ? 'red' : 'green'} sub="units becoming available" />
        <StatCard label="Revenue at Risk" value={`AED ${formatMoney(totalRate)}`} icon={Building2}
          tone={noRenewCount > 0 ? 'red' : 'green'} sub="monthly rate of vacating units" />
      </div>

      {isLoading ? <Spinner /> : vacancies.length === 0 ? (
        <Card><EmptyState message={`No contracts ending in the next ${days} days.`} /></Card>
      ) : (
        <Card>
          <CardHeader
            title={`${vacancies.length} contract${vacancies.length !== 1 ? 's' : ''} ending`}
            subtitle={`Within the next ${days} days`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Contract</Th>
                <Th>Customer</Th>
                <Th>Unit</Th>
                <Th>Size</Th>
                <Th>End Date</Th>
                <Th>Days Left</Th>
                <Th>Weekly Rate</Th>
                <Th>Auto-renew</Th>
              </tr>
            </thead>
            <tbody>
              {vacancies.map((c: any) => {
                const dl = daysUntil(c.endDate)
                return (
                  <tr key={c._id} className="hover:bg-muted/50">
                    <Td>
                      <Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">
                        {c.contractNo}
                      </Link>
                    </Td>
                    <Td className="font-medium">{c.customer?.fullName ?? '—'}</Td>
                    <Td>{c.unit?.unitNumber ?? '—'}</Td>
                    <Td className="text-muted-foreground">
                      {c.unit?.sizeSqf ? `${c.unit.sizeSqf} sqf` : '—'}
                    </Td>
                    <Td>{formatDate(c.endDate)}</Td>
                    <Td className={
                      dl <= 3 ? 'text-destructive font-bold' :
                      dl <= 7 ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                      'text-muted-foreground'
                    }>
                      {dl} day{dl !== 1 ? 's' : ''}
                    </Td>
                    <Td className="text-muted-foreground">
                      {c.rate ? `AED ${formatMoney(c.rate)}` : '—'}
                    </Td>
                    <Td>
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
                        c.autoRenew
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {c.autoRenew ? 'Yes' : 'No'}
                      </span>
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
