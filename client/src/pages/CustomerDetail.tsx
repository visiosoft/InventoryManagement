import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Plus, Upload, ShieldCheck, Trash2, FileText, Receipt } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AccessPerson, AppDocument, Contract, Customer, Invoice } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Modal, PageHeader, Spinner, Table, Td, Th,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { CustomerForm } from './Customers'
import { UploadDocumentForm } from './Documents'

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
      <span className={value ? '' : 'text-muted-foreground'}>{value || '—'}</span>
    </div>
  )
}

function AccessPersonCard({ p, index }: { p: AccessPerson; index: number }) {
  return (
    <div className="rounded-lg border px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{p.name || `Person ${index + 1}`}</span>
        {p.relation && <Badge tone="gray">{p.relation}</Badge>}
      </div>
      {p.phone && <div className="text-xs text-muted-foreground">{p.phone}</div>}
      {(p.idType || p.idNumber) && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <ShieldCheck size={11} className="shrink-0" />
          {[p.idType, p.idNumber].filter(Boolean).join(': ')}
        </div>
      )}
    </div>
  )
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  type PaymentSummary = { contractId: string; contractNo: string; totalPaid: number; totalUnpaid: number }
  const { data, isLoading } = useQuery<{
    customer: Customer; contracts: Contract[]; documents: AppDocument[]
    invoices: Invoice[]; paymentSummary: PaymentSummary[]
  }>({
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

  const removeCustomer = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      navigate('/customers')
    },
    onError: (e) => setError(apiError(e)),
  })

  function onDeleteCustomer() {
    const ok = window.confirm(`Delete customer ${customer.fullName}? This cannot be undone.`)
    if (!ok) return
    setError('')
    removeCustomer.mutate()
  }

  if (isLoading || !data) return <Spinner />
  const { customer, contracts, documents, invoices = [], paymentSummary = [] } = data

  const totalPaidAll  = Math.round(paymentSummary.reduce((s, p) => s + p.totalPaid, 0) * 100) / 100
  const totalUnpaidAll = Math.round(paymentSummary.reduce((s, p) => s + p.totalUnpaid, 0) * 100) / 100

  const allPhones = customer.phones?.filter(Boolean).length
    ? customer.phones!
    : customer.phone
      ? [customer.phone]
      : []

  const subtitleParts = [
    customer.clientId,
    customer.tenantType ? (customer.tenantType === 'company' ? 'Company' : 'Individual') : null,
    customer.nationality,
  ].filter(Boolean)

  return (
    <div>
      <PageHeader
        title={customer.fullName}
        subtitle={subtitleParts.join(' · ') || 'Customer'}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDeleteCustomer} disabled={removeCustomer.isPending}>
              <Trash2 size={14} /> Delete
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
            <Link to={`/contracts/new?customer=${customer._id}`}><Button><Plus size={15} /> New contract</Button></Link>
          </div>
        }
      />

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ── Left sidebar ── */}
        <div className="space-y-4">

          {/* Contact info */}
          <Card>
            <CardHeader title="Contact details" />
            <CardBody className="pt-0 divide-y">
              <InfoRow label="Full name" value={customer.fullName} />
              <InfoRow label="Client ID" value={customer.clientId} />
              <InfoRow label="Tenant type" value={customer.tenantType === 'company' ? 'Company' : 'Individual'} />
              <InfoRow label="Nationality" value={customer.nationality} />
              <InfoRow label="Email" value={customer.email} />
              {allPhones.length === 0 && <InfoRow label="Phone" value={null} />}
              {allPhones.map((ph, i) => (
                <InfoRow key={i} label={i === 0 ? 'Phone' : `Phone ${i + 1}`} value={ph} />
              ))}
              <InfoRow label="Emergency" value={customer.emergencyNumber} />
              <InfoRow label="Company" value={customer.company} />
              <InfoRow label="Address" value={customer.address} />
              {customer.notes && <InfoRow label="Notes" value={customer.notes} />}
            </CardBody>
          </Card>

          {/* Identity documents */}
          <Card>
            <CardHeader title="Identity Documents" />
            <CardBody className="pt-0 divide-y">
              <InfoRow label="Emirates ID" value={customer.emiratesId} />
              <InfoRow label="EID Expiry" value={customer.eidExpiry ? formatDate(customer.eidExpiry) : null} />
              <InfoRow label="Passport No." value={customer.passportNumber} />
              <InfoRow label="Passport Expiry" value={customer.passportExpiry ? formatDate(customer.passportExpiry) : null} />
            </CardBody>
          </Card>

          {/* Authorized access persons */}
          <Card>
            <CardHeader
              title="Authorized Access Persons"
              subtitle={(customer.accessPersons?.length ?? 0) === 0 ? 'None added' : `${customer.accessPersons!.length} person${customer.accessPersons!.length !== 1 ? 's' : ''}`}
            />
            <CardBody className="pt-0 space-y-2">
              {(customer.accessPersons ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No authorized persons on file.</p>
              ) : (
                customer.accessPersons!.map((p, i) => (
                  <AccessPersonCard key={i} p={p} index={i} />
                ))
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Right content ── */}
        <div className="space-y-4">
          {/* Financial summary */}
          {paymentSummary.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardBody>
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Receipt size={11} /> Total collected</div>
                  <div className="text-xl font-bold text-emerald-600">{formatMoney(totalPaidAll)}</div>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><FileText size={11} /> Outstanding</div>
                  <div className={`text-xl font-bold ${totalUnpaidAll > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{formatMoney(totalUnpaidAll)}</div>
                </CardBody>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader title="Contracts" subtitle={`${contracts.length} total · all periods`} />
            {contracts.length === 0 ? (
              <EmptyState message="No contracts for this customer yet." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Contract</Th>
                    <Th>Unit</Th>
                    <Th>Rate/mo</Th>
                    <Th>Term</Th>
                    <Th>Collected</Th>
                    <Th>Outstanding</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => {
                    const ps = paymentSummary.find(p => p.contractNo === c.contractNo)
                    return (
                      <tr key={c._id} className="hover:bg-muted/50">
                        <Td>
                          <Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">
                            {c.contractNo}
                          </Link>
                        </Td>
                        <Td>{c.unit?.unitNumber}{c.unit?.sizeSqf != null ? ` · ${c.unit.sizeSqf} sqft` : ''}</Td>
                        <Td>{formatMoney(c.rate)}</Td>
                        <Td className="whitespace-nowrap text-xs">{formatDate(c.startDate)} → {formatDate(c.endDate)}</Td>
                        <Td className="text-emerald-700 font-medium">{ps ? formatMoney(ps.totalPaid) : '—'}</Td>
                        <Td className={ps?.totalUnpaid ? 'text-amber-700 font-medium' : 'text-muted-foreground'}>{ps ? formatMoney(ps.totalUnpaid) : '—'}</Td>
                        <Td><Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Invoice history across all contracts */}
          <Card>
            <CardHeader title="Invoice history" subtitle={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} across all contracts`} />
            {invoices.length === 0 ? (
              <EmptyState message="No invoices yet." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Contract</Th>
                    <Th>Due</Th>
                    <Th>Total</Th>
                    <Th>Paid</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv._id} className="hover:bg-muted/50">
                      <Td>
                        <Link to={`/invoices/${inv._id}`} className="font-medium text-primary hover:underline text-sm">
                          {inv.invoiceNo}
                        </Link>
                      </Td>
                      <Td className="text-xs text-muted-foreground">{inv.orderNumber}</Td>
                      <Td className="text-xs">{formatDate(inv.dueDate)}</Td>
                      <Td className="font-medium">{formatMoney(inv.total)}</Td>
                      <Td className="text-emerald-700">{formatMoney(inv.paymentMade ?? 0)}</Td>
                      <Td>
                        <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'partial' ? 'amber' : inv.status === 'cancelled' ? 'gray' : 'blue'}>
                          {inv.status}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              subtitle="ID proofs, contracts, and other files"
              action={
                <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
                  <Upload size={13} /> Upload
                </Button>
              }
            />
            {documents.length === 0 ? (
              <EmptyState message="No documents uploaded for this customer." />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Name</Th><Th>Type</Th><Th>Storage</Th><Th>Uploaded</Th><Th /></tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d._id} className="hover:bg-muted/50">
                      <Td className="font-medium">{d.name}</Td>
                      <Td>{statusLabel(d.type)}</Td>
                      <Td>
                        <Badge tone={d.storage === 'drive' ? 'blue' : 'gray'}>
                          {d.storage === 'drive' ? 'Google Drive' : 'Local'}
                        </Badge>
                      </Td>
                      <Td>{formatDate(d.createdAt)}</Td>
                      <Td>
                        <a href={d.url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Open</a>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <Modal open={editing} onClose={() => { setEditing(false); setError('') }} title="Edit customer" wide>
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
