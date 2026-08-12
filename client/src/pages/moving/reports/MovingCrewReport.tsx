import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'
import { downloadCsv } from './shared'

interface CrewRow {
  workerId: string
  name: string
  role: string
  jobCount: number
  totalEarnings: number
}

export default function MovingCrewReport() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: rows = [], isLoading } = useQuery<CrewRow[]>({
    queryKey: ['moving-report-crew', from, to],
    queryFn: () => api.get('/moving-reports/crew', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data),
  })

  const totalEarnings = rows.reduce((s, r) => s + r.totalEarnings, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Crew Report" subtitle="Worker utilisation and earnings" />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        {(from || to) && <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>}
      </div>

      <Card>
        <CardHeader title={`${rows.length} workers`} subtitle={`AED ${totalEarnings.toLocaleString()} total paid`}
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-crew.csv', [
              ['Worker', 'Role', 'Jobs', 'Total Earnings'],
              ...rows.map(r => [r.name ?? '', r.role ?? '', r.jobCount, r.totalEarnings]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No crew data for this range" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Worker</Th>
                  <Th>Role</Th>
                  <Th className="text-right">Jobs</Th>
                  <Th className="text-right">Total Earnings</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.workerId} className="hover:bg-muted/30">
                    <Td className="font-medium">{r.name || '—'}</Td>
                    <Td className="capitalize">{r.role || '—'}</Td>
                    <Td className="text-right">{r.jobCount}</Td>
                    <Td className="text-right font-medium">AED {r.totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
