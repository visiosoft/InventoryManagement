import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Search, FileText } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th, Input } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingQuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']
const statusTone: Record<MovingQuoteStatus, string> = {
  draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow',
}

export default function MovingQuotes() {
  const [filterStatus, setFilterStatus] = useState<MovingQuoteStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data: quotes = [], isLoading } = useQuery<MovingQuote[]>({
    queryKey: ['moving-quotes', filterStatus],
    queryFn: () => api.get('/moving-quotes', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  const filteredQuotes = quotes.filter(q =>
    search === '' ||
    q.quoteNo.toLowerCase().includes(search.toLowerCase()) ||
    q.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Quotes"
        subtitle={`${quotes.length} quotes in total`}
      />

      {/* Search and Filter Section */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by quote number or customer name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as MovingQuoteStatus | '')}
              className="w-48"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* Quotes Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : filteredQuotes.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <FileText size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message={search ? "No quotes match your search" : "No quotes found"} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Quote No</Th>
                    <Th className="py-3">Customer</Th>
                    <Th className="py-3">Related Job</Th>
                    <Th className="py-3">Quote Date</Th>
                    <Th className="py-3">Expiry Date</Th>
                    <Th className="py-3">Total Amount</Th>
                    <Th className="py-3">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map(q => (
                    <tr key={q._id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                      <Td className="py-3">
                        <Link to={`/moving/quotes/${q._id}`} className="font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
                          {q.quoteNo}
                        </Link>
                      </Td>
                      <Td className="py-3 font-medium">{q.customer?.fullName}</Td>
                      <Td className="py-3 text-sm">
                        {q.job
                          ? <Link to={`/moving/jobs/${q.job._id}`} className="text-primary hover:underline">{q.job.jobNo}</Link>
                          : <span className="text-muted-foreground">—</span>}
                      </Td>
                      <Td className="py-3 text-sm">{formatDate(q.quoteDate)}</Td>
                      <Td className="py-3 text-sm">{q.expiryDate ? formatDate(q.expiryDate) : <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="py-3 font-semibold">AED {q.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                      <Td className="py-3"><Badge tone={statusTone[q.status]}>{q.status}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Status Reference */}
      <Card>
        <CardHeader title="Quote Status Reference" subtitle="Understanding the quote lifecycle" />
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {STATUSES.map(status => (
              <div key={status} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge tone={statusTone[status]} className="shrink-0">{status}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
