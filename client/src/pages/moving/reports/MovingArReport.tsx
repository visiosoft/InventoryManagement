import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th } from '../../../components/ui'
import { StatCard, downloadCsv } from './shared'

interface ArInvoice {
  invoiceId: string; invoiceNo: string; jobNo?: string
  total: number; balanceDue: number; dueDate: string; invoiceDate: string; bucket: string
}
interface ArRow {
  customerId: string; customer: string; phone: string; email: string
  totalOutstanding: number; worstBucket: string; invoices: ArInvoice[]
}
interface ArData {
  rows: ArRow[]
  buckets: { current: number; d30: number; d60: number; d90: number; d90plus: number }
  totalOutstanding: number
}

const BUCKET_LABEL: Record<string, string> = { current: 'Not yet due', d30: '1–30 days', d60: '31–60 days', d90: '61–90 days', d90plus: '90+ days' }
const BUCKET_TONE: Record<string, 'green' | 'amber' | 'red'> = { current: 'green', d30: 'amber', d60: 'amber', d90: 'red', d90plus: 'red' }
const BUCKET_ORDER = ['current', 'd30', 'd60', 'd90', 'd90plus']

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

export default function MovingArReport() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [minBucket, setMinBucket] = useState('current')

  const { data, isLoading } = useQuery<ArData>({
    queryKey: ['moving-report-ar'],
    queryFn: () => api.get('/moving-reports/ar').then(r => r.data),
  })

  const allRows = data?.rows ?? []
  const minIdx = BUCKET_ORDER.indexOf(minBucket)
  const rows = allRows.filter(r => BUCKET_ORDER.indexOf(r.worstBucket) >= minIdx)
  const buckets = data?.buckets

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Accounts Receivable" subtitle="Outstanding moving invoices, by how overdue they are" />

      <Field label="Show" className="max-w-xs">
        <Select value={minBucket} onChange={e => setMinBucket(e.target.value)}>
          <option value="current">All outstanding</option>
          <option value="d30">1+ days overdue</option>
          <option value="d60">31+ days overdue</option>
          <option value="d90">61+ days overdue</option>
          <option value="d90plus">90+ days overdue</option>
        </Select>
      </Field>

      {buckets && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Not yet due" value={money(buckets.current)} tone="green" />
          <StatCard label="1–30 days" value={money(buckets.d30)} tone="amber" />
          <StatCard label="31–60 days" value={money(buckets.d60)} tone="amber" />
          <StatCard label="61–90 days" value={money(buckets.d90)} tone="red" />
          <StatCard label="90+ days" value={money(buckets.d90plus)} tone="red" />
        </div>
      )}

      <Card>
        <CardHeader title={`${rows.length} customer${rows.length !== 1 ? 's' : ''} with a balance`}
          subtitle={data ? `${money(data.totalOutstanding)} total outstanding` : undefined}
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-ar.csv', [
              ['Customer', 'Phone', 'Total Outstanding', 'Worst Bucket', 'Invoice No', 'Job No', 'Balance Due', 'Due Date'],
              ...rows.flatMap(r => r.invoices.map(inv => [r.customer, r.phone, r.totalOutstanding, BUCKET_LABEL[r.worstBucket], inv.invoiceNo, inv.jobNo ?? '', inv.balanceDue, new Date(inv.dueDate).toLocaleDateString()])),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="Nothing outstanding — every invoice is paid" /> : (
            <Table>
              <thead>
                <tr><Th></Th><Th>Customer</Th><Th>Phone</Th><Th className="text-right">Outstanding</Th><Th>Oldest bucket</Th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.customerId}>
                    <tr className="hover:bg-muted/30 cursor-pointer" onClick={() => toggle(r.customerId)}>
                      <Td className="w-8">{expanded.has(r.customerId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</Td>
                      <Td className="font-medium">{r.customer}</Td>
                      <Td className="text-muted-foreground">{r.phone || '—'}</Td>
                      <Td className="text-right font-bold">{money(r.totalOutstanding)}</Td>
                      <Td><Badge tone={BUCKET_TONE[r.worstBucket]}>{BUCKET_LABEL[r.worstBucket]}</Badge></Td>
                    </tr>
                    {expanded.has(r.customerId) && (
                      <tr>
                        <Td colSpan={5} className="bg-muted/20 p-0">
                          <div className="p-3">
                            <Table>
                              <thead>
                                <tr><Th>Invoice</Th><Th>Job</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th></Th></tr>
                              </thead>
                              <tbody>
                                {r.invoices.map(inv => (
                                  <tr key={inv.invoiceId}>
                                    <Td>
                                      <Link to={`/moving/invoices/${inv.invoiceId}`} className="text-primary font-medium hover:underline">{inv.invoiceNo}</Link>
                                    </Td>
                                    <Td className="text-muted-foreground">{inv.jobNo || '—'}</Td>
                                    <Td className="text-muted-foreground">{new Date(inv.dueDate).toLocaleDateString()}</Td>
                                    <Td className="text-right">{money(inv.total)}</Td>
                                    <Td className="text-right font-medium">{money(inv.balanceDue)}</Td>
                                    <Td><Badge tone={BUCKET_TONE[inv.bucket]}>{BUCKET_LABEL[inv.bucket]}</Badge></Td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
