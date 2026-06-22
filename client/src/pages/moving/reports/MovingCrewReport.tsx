import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'

interface CrewRow {
  workerId: string
  name: string
  role: string
  jobCount: number
  totalEarnings: number
}

export default function MovingCrewReport() {
  const { data: rows = [], isLoading } = useQuery<CrewRow[]>({
    queryKey: ['moving-report-crew'],
    queryFn: () => api.get('/moving-reports/crew').then(r => r.data),
  })

  const totalEarnings = rows.reduce((s, r) => s + r.totalEarnings, 0)

  return (
    <div className="space-y-8">
      <PageHeader title="Crew Report" subtitle="Worker utilisation and earnings" />

      <Card>
        <CardHeader title={`${rows.length} workers`} subtitle={`AED ${totalEarnings.toLocaleString()} total paid`} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No crew data yet" /> : (
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
