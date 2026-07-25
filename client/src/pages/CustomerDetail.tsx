import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Upload, ShieldCheck, Trash2, FileText, Receipt } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AccessPerson, AppDocument, Contract, Customer, Invoice } from '../lib/types'
import {
  Badge, EmptyState, Modal, Spinner, Table, Td, Th,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { CustomerForm } from './Customers'
import { UploadDocumentForm } from './Documents'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'
const CREAM = '#FDFCFA'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
      <span className="text-xs shrink-0" style={{ color: MUTED }}>{label}</span>
      <span className="text-right" style={{ color: value ? INK : MUTED }}>{value || '—'}</span>
    </div>
  )
}

function AccessPersonCard({ p, index }: { p: AccessPerson; index: number }) {
  return (
    <div className="rounded-xl px-4 py-3 space-y-1.5" style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm" style={{ color: INK }}>{p.name || `Person ${index + 1}`}</span>
        {p.relation && <Badge tone="gray">{p.relation}</Badge>}
      </div>
      {p.phone && <div className="text-xs" style={{ color: MUTED }}>{p.phone}</div>}
      {(p.idType || p.idNumber) && (
        <div className="text-xs flex items-center gap-1" style={{ color: MUTED }}>
          <ShieldCheck size={11} className="shrink-0" />
          {[p.idType, p.idNumber].filter(Boolean).join(': ')}
        </div>
      )}
    </div>
  )
}

function SectionCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <div>
          <div className="text-sm font-bold" style={{ ...HEADING, color: INK }}>{title}</div>
          {subtitle && <div className="text-xs mt-0.5" style={{ color: MUTED }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="px-5 pb-4">
        {children}
      </div>
    </div>
  )
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl px-5 py-4" style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
      <div className="text-xs flex items-center gap-1 mb-1" style={{ color: MUTED }}>{icon} {label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
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

  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>
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
    <div style={{ background: CREAM, borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Header */}
      <div className="mb-7">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs mb-3 hover:opacity-70 transition-opacity"
          style={{ color: PURPLE, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <ArrowLeft size={13} /> Back
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>{customer.fullName}</div>
            {subtitleParts.length > 0 && (
              <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{subtitleParts.join(' · ')}</div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDeleteCustomer}
              disabled={removeCustomer.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border-2 hover:opacity-80 transition-opacity disabled:opacity-60"
              style={{ borderColor: '#DC2626', color: '#DC2626' }}
            >
              <Trash2 size={14} /> Delete
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border-2 hover:opacity-80 transition-opacity"
              style={{ borderColor: PURPLE, color: PURPLE }}
            >
              <Pencil size={14} /> Edit
            </button>
            <Link to={`/contracts/new?customer=${customer._id}`}>
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: PURPLE }}
              >
                <Plus size={15} /> New contract
              </button>
            </Link>
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-xs" style={{ color: '#DC2626' }}>{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Left sidebar */}
        <div className="space-y-4">
          <SectionCard title="Contact details">
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
          </SectionCard>

          <SectionCard title="Identity Documents">
            <InfoRow label="Emirates ID" value={customer.emiratesId} />
            <InfoRow label="EID Expiry" value={customer.eidExpiry ? formatDate(customer.eidExpiry) : null} />
            <InfoRow label="Passport No." value={customer.passportNumber} />
            <InfoRow label="Passport Expiry" value={customer.passportExpiry ? formatDate(customer.passportExpiry) : null} />
          </SectionCard>

          <SectionCard
            title="Authorized Access Persons"
            subtitle={(customer.accessPersons?.length ?? 0) === 0 ? 'None added' : `${customer.accessPersons!.length} person${customer.accessPersons!.length !== 1 ? 's' : ''}`}
          >
            {(customer.accessPersons ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: MUTED }}>No authorized persons on file.</p>
            ) : (
              <div className="space-y-2">
                {customer.accessPersons!.map((p, i) => (
                  <AccessPersonCard key={i} p={p} index={i} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right content */}
        <div className="space-y-4">
          {paymentSummary.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <StatBox icon={<Receipt size={11} />} label="Total collected" value={formatMoney(totalPaidAll)} color="#047857" />
              <StatBox icon={<FileText size={11} />} label="Outstanding" value={formatMoney(totalUnpaidAll)} color={totalUnpaidAll > 0 ? '#D97706' : MUTED} />
            </div>
          )}

          <SectionCard title="Contracts" subtitle={`${contracts.length} total · all periods`}>
            {contracts.length === 0 ? (
              <EmptyState message="No contracts for this customer yet." />
            ) : (
              <div className="-mx-5" style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Contract</Th>
                      <Th>Unit</Th>
                      <Th>Rate/4wk</Th>
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
                            <Link to={`/contracts/${c._id}`} className="font-medium hover:underline" style={{ color: PURPLE }}>
                              {c.contractNo}
                            </Link>
                          </Td>
                          <Td>{c.unit?.unitNumber}{c.unit?.sizeSqf != null ? ` · ${c.unit.sizeSqf} sqft` : ''}</Td>
                          <Td>{formatMoney(c.rate)}</Td>
                          <Td className="whitespace-nowrap text-xs">{formatDate(c.startDate)} → {formatDate(c.endDate)}</Td>
                          <Td style={{ color: '#047857' }} className="font-medium">{ps ? formatMoney(ps.totalPaid) : '—'}</Td>
                          <Td style={{ color: ps?.totalUnpaid ? '#D97706' : MUTED }} className="font-medium">{ps ? formatMoney(ps.totalUnpaid) : '—'}</Td>
                          <Td><Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge></Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Invoice history" subtitle={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} across all contracts`}>
            {invoices.length === 0 ? (
              <EmptyState message="No invoices yet." />
            ) : (
              <div className="-mx-5" style={{ overflowX: 'auto' }}>
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
                          <Link to={`/invoices/${inv._id}`} className="font-medium hover:underline text-sm" style={{ color: PURPLE }}>
                            {inv.invoiceNo}
                          </Link>
                        </Td>
                        <Td className="text-xs" style={{ color: MUTED }}>{inv.orderNumber}</Td>
                        <Td className="text-xs">{formatDate(inv.dueDate)}</Td>
                        <Td className="font-medium">{formatMoney(inv.total)}</Td>
                        <Td style={{ color: '#047857' }}>{formatMoney(inv.paymentMade ?? 0)}</Td>
                        <Td>
                          <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'partial' ? 'amber' : inv.status === 'cancelled' ? 'gray' : 'blue'}>
                            {inv.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Documents"
            subtitle="ID proofs, contracts, and other files"
            action={
              <button
                type="button"
                onClick={() => setUploading(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 hover:opacity-80 transition-opacity"
                style={{ borderColor: PURPLE, color: PURPLE }}
              >
                <Upload size={13} /> Upload
              </button>
            }
          >
            {documents.length === 0 ? (
              <EmptyState message="No documents uploaded for this customer." />
            ) : (
              <div className="-mx-5" style={{ overflowX: 'auto' }}>
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
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: PURPLE }}>Open</a>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>
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
