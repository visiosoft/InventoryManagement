import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingQuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']
const statusTone: Record<MovingQuoteStatus, string> = {
  draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow',
}

export default function MovingQuotes() {
  const [filterStatus, setFilterStatus] = useState<MovingQuoteStatus | ''>('')

  const { data: quotes = [], isLoading } = useQuery<MovingQuote[]>({
    queryKey: ['moving-quotes', filterStatus],
    queryFn: () => api.get('/moving-quotes', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  return (
    <div className="space-y-8">
      <PageHeader title="Moving Quotes" subtitle={`${quotes.length} quotes`} />

      {/* Status Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(statusTone).map(([st, tone]) => (
          <div key={st} className="flex items-center gap-2 text-xs">
            <Badge tone={tone}>{st}</Badge>
            <span className="text-muted-foreground">= {st}</span>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="Quotes" action={<Select value={filterStatus} onChange={e => setFilterStatus(e.target.value as MovingQuoteStatus | '')}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</Select>} />
        <CardBody>
          {isLoading ? <Spinner /> : quotes.length === 0 ? <EmptyState message="No quotes found" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Quote No</Th>
                  <Th>Customer</Th>
                  <Th>Job</Th>
                  <Th>Date</Th>
                  <Th>Expiry</Th>
                  <Th>Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => (
                  <tr key={q._id} className="hover:bg-muted/30">
                    <Td>
                      <Link to={`/moving/quotes/${q._id}`} className="font-mono text-primary hover:underline">
                        {q.quoteNo}
                      </Link>
                    </Td>
                    <Td className="font-medium">{q.customer?.fullName}</Td>
                    <Td>
                      {q.job
                        ? <Link to={`/moving/jobs/${q.job._id}`} className="text-primary hover:underline">{q.job.jobNo}</Link>
                        : '—'}
                    </Td>
                    <Td>{formatDate(q.quoteDate)}</Td>
                    <Td>{q.expiryDate ? formatDate(q.expiryDate) : '—'}</Td>
                    <Td className="font-medium">AED {q.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                    <Td><Badge tone={statusTone[q.status]}>{q.status}</Badge></Td>
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
