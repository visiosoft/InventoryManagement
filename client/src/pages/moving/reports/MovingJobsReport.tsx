import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'

interface JobsReport {
  byStatus: { _id: string; count: number }[]
  byType: { _id: string; count: number }[]
}

const statusTone: Record<string, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

export default function MovingJobsReport() {
  const { data, isLoading } = useQuery<JobsReport>({
    queryKey: ['moving-report-jobs'],
    queryFn: () => api.get('/moving-reports/jobs').then(r => r.data),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>

  return (
    <div className="space-y-8">
      <PageHeader title="Jobs Report" subtitle="Jobs by status and type" />

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="By Status" />
          <CardBody>
            <Table>
              <thead><tr><Th>Status</Th><Th className="text-right">Count</Th></tr></thead>
              <tbody>
                {(data?.byStatus ?? []).map(row => (
                  <tr key={row._id} className="hover:bg-muted/30">
                    <Td><Badge tone={statusTone[row._id] ?? 'gray'}>{row._id?.replace('_', ' ') || '—'}</Badge></Td>
                    <Td className="text-right font-medium">{row.count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By Type" />
          <CardBody>
            <Table>
              <thead><tr><Th>Type</Th><Th className="text-right">Count</Th></tr></thead>
              <tbody>
                {(data?.byType ?? []).map(row => (
                  <tr key={row._id} className="hover:bg-muted/30">
                    <Td className="capitalize">{row._id?.replace('_', ' ') || '—'}</Td>
                    <Td className="text-right font-medium">{row.count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
