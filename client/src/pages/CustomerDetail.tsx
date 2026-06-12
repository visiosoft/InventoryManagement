import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Pencil, Plus, Upload } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AppDocument, Contract, Customer } from '../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, PageHeader, Spinner, Table, Td, Th, contractStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { CustomerForm } from './Customers'
import { UploadDocumentForm } from './Documents'

export default function CustomerDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery<{ customer: Customer; contracts: Contract[]; documents: AppDocument[] }>({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${id}`).then((r) => r.data),
  })

  const update = useMutation({
    mutationFn: (body: Partial<Customer>) => api.put(`/customers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      setEditing(false)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  if (isLoading || !data) return <Spinner />
  const { customer, contracts, documents } = data

  return (
    <div>
      <PageHeader
        title={customer.fullName}
        subtitle={customer.company || 'Customer'}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
            <Link to={`/contracts/new?customer=${customer._id}`}><Button><Plus size={15} /> New contract</Button></Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contact details" />
          <CardBody className="space-y-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Email</div>{customer.email || '—'}</div>
            <div><div className="text-xs text-muted-foreground">Phone</div>{customer.phone || '—'}</div>
            <div><div className="text-xs text-muted-foreground">Emergency number</div>{customer.emergencyNumber || '—'}</div>
            <div><div className="text-xs text-muted-foreground">Address</div>{customer.address || '—'}</div>
            {customer.notes && <div><div className="text-xs text-muted-foreground">Notes</div>{customer.notes}</div>}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Contracts" subtitle={`${contracts.length} total`} />
          {contracts.length === 0 ? (
            <EmptyState message="No contracts for this customer yet." />
          ) : (
            <Table>
              <thead><tr><Th>Contract</Th><Th>Unit</Th><Th>Period</Th><Th>Rate</Th><Th>Term</Th><Th>Status</Th></tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c._id} className="hover:bg-muted/50">
                    <Td><Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">{c.contractNo}</Link></Td>
                    <Td>{c.unit?.unitNumber} ({c.unit?.unitType?.sizeSqf} sqf)</Td>
                    <Td className="capitalize">{c.billingPeriod}</Td>
                    <Td>{formatMoney(c.rate)}</Td>
                    <Td>{formatDate(c.startDate)} → {formatDate(c.endDate)}</Td>
                    <Td><Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Documents"
          subtitle="ID proofs, contracts, and other files"
          action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={13} /> Upload</Button>}
        />
        {documents.length === 0 ? (
          <EmptyState message="No documents uploaded for this customer." />
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Type</Th><Th>Storage</Th><Th>Uploaded</Th><Th /></tr></thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d._id} className="hover:bg-muted/50">
                  <Td className="font-medium">{d.name}</Td>
                  <Td>{statusLabel(d.type)}</Td>
                  <Td><Badge tone={d.storage === 'drive' ? 'blue' : 'gray'}>{d.storage === 'drive' ? 'Google Drive' : 'Local'}</Badge></Td>
                  <Td>{formatDate(d.createdAt)}</Td>
                  <Td><a href={d.url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Open</a></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit customer">
        <CustomerForm initial={customer} onSubmit={(b) => update.mutate(b)} busy={update.isPending} error={error} />
      </Modal>

      <Modal open={uploading} onClose={() => setUploading(false)} title="Upload document">
        <UploadDocumentForm
          customerId={customer._id}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['customer', id] })
            setUploading(false)
          }}
        />
      </Modal>
    </div>
  )
}
