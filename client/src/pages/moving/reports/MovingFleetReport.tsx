import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'

interface FleetRow {
  truckId: string
  name: string
  plateNumber: string
  type: string
  jobCount: number
}

export default function MovingFleetReport() {
  const { data: rows = [], isLoading } = useQuery<FleetRow[]>({
    queryKey: ['moving-report-fleet'],
    queryFn: () => api.get('/moving-reports/fleet').then(r => r.data),
  })

  const totalJobs = rows.reduce((s, r) => s + r.jobCount, 0)

  return (
    <div className="space-y-8">
      <PageHeader title="Fleet Report" subtitle="Truck utilisation" />

      <Card>
        <CardHeader title={`${rows.length} trucks`} subtitle={`${totalJobs} total jobs`} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No fleet data yet" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Truck</Th>
                  <Th>Plate</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Jobs</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.truckId} className="hover:bg-muted/30">
                    <Td className="font-medium">{r.name || '—'}</Td>
                    <Td>{r.plateNumber || '—'}</Td>
                    <Td className="capitalize">{r.type?.replace('_', ' ') || '—'}</Td>
                    <Td className="text-right font-medium">{r.jobCount}</Td>
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
