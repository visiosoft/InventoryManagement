import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Search, Receipt } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th, Input } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingInvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'cancelled']
const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
}

export default function MovingInvoices() {
  const [filterStatus, setFilterStatus] = useState<MovingInvoiceStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data: invoices = [], isLoading } = useQuery<MovingInvoice[]>({
    queryKey: ['moving-invoices', filterStatus],
    queryFn: () => api.get('/moving-invoices', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  const filteredInvoices = invoices.filter(inv =>
    search === '' ||
    inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Invoices"
        subtitle={`${invoices.length} invoices in total`}
      />

      {/* Search and Filter Section */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by invoice number or customer name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as MovingInvoiceStatus | '')}
              className="w-48"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : filteredInvoices.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <Receipt size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message={search ? "No invoices match your search" : "No invoices found"} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Invoice No</Th>
                    <Th className="py-3">Customer</Th>
                    <Th className="py-3">Related Job</Th>
                    <Th className="py-3">Invoice Date</Th>
                    <Th className="py-3">Total Amount</Th>
                    <Th className="py-3">Balance Due</Th>
                    <Th className="py-3">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(inv => (
                    <tr key={inv._id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                      <Td className="py-3">
                        <Link to={`/moving/invoices/${inv._id}`} className="font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
                          {inv.invoiceNo}
                        </Link>
                      </Td>
                      <Td className="py-3 font-medium">{inv.customer?.fullName}</Td>
                      <Td className="py-3 text-sm">
                        {inv.job
                          ? <Link to={`/moving/jobs/${inv.job._id}`} className="text-primary hover:underline">{inv.job.jobNo}</Link>
                          : <span className="text-muted-foreground">—</span>}
                      </Td>
                      <Td className="py-3 text-sm">{formatDate(inv.invoiceDate)}</Td>
                      <Td className="py-3 font-semibold">AED {inv.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                      <Td className={`py-3 font-semibold ${inv.balanceDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        AED {inv.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </Td>
                      <Td className="py-3"><Badge tone={statusTone[inv.status]}>{inv.status}</Badge></Td>
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
        <CardHeader title="Invoice Status Reference" subtitle="Understanding the invoice lifecycle" />
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
