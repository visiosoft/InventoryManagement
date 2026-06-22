import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingInvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'cancelled']
const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
}

export default function MovingInvoices() {
  const [filterStatus, setFilterStatus] = useState<MovingInvoiceStatus | ''>('')

  const { data: invoices = [], isLoading } = useQuery<MovingInvoice[]>({
    queryKey: ['moving-invoices', filterStatus],
    queryFn: () => api.get('/moving-invoices', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  return (
    <div className="space-y-8">
      <PageHeader title="Moving Invoices" subtitle={`${invoices.length} invoices`} />

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
        <CardHeader title="Invoices" action={<Select value={filterStatus} onChange={e => setFilterStatus(e.target.value as MovingInvoiceStatus | '')}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</Select>} />
        <CardBody>
          {isLoading ? <Spinner /> : invoices.length === 0 ? <EmptyState message="No invoices found" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Invoice No</Th>
                  <Th>Customer</Th>
                  <Th>Job</Th>
                  <Th>Date</Th>
                  <Th>Total</Th>
                  <Th>Balance Due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv._id} className="hover:bg-muted/30">
                    <Td>
                      <Link to={`/moving/invoices/${inv._id}`} className="font-mono text-primary hover:underline">
                        {inv.invoiceNo}
                      </Link>
                    </Td>
                    <Td className="font-medium">{inv.customer?.fullName}</Td>
                    <Td>
                      {inv.job
                        ? <Link to={`/moving/jobs/${inv.job._id}`} className="text-primary hover:underline">{inv.job.jobNo}</Link>
                        : '—'}
                    </Td>
                    <Td>{formatDate(inv.invoiceDate)}</Td>
                    <Td className="font-medium">AED {inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                    <Td className={inv.balanceDue > 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                      AED {inv.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Td>
                    <Td><Badge tone={statusTone[inv.status]}>{inv.status}</Badge></Td>
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
