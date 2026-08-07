import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText, MessageSquare, Pencil, Receipt } from 'lucide-react'
import { api } from '../lib/api'
import type { AppDocument, Contract, Invoice, Payment } from '../lib/types'
import {
  Badge, EmptyState, Spinner, Table, Td, Th,
  contractStatusTone, paymentStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'
const CREAM = '#FDFCFA'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
      <span className="text-xs shrink-0" style={{ color: MUTED }}>{label}</span>
      <span className="text-right" style={{ color: empty ? MUTED : INK }}>{empty ? '—' : value}</span>
    </div>
  )
}

function SectionCard({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <div>
          <div className="text-sm font-bold" style={{ ...HEADING, color: INK }}>{title}</div>
          {subtitle && <div className="text-xs mt-0.5" style={{ color: MUTED }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="px-5 pb-4">{children}</div>
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

/**
 * Alternative layout for a contract, following the tenant detail page's design.
 * Lives alongside the original at /contracts/:id/preview for comparison.
 */
export default function ContractDetailV2() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<{
    contract: Contract; payments: Payment[]; documents: AppDocument[]; invoices?: Invoice[]
  }>({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data),
  })

  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>
  const { contract: c, payments = [], documents = [], invoices = [] } = data

  const units = c.units?.length ? c.units : c.unit ? [c.unit] : []
  const askingPrice = Number(c.rate || 0)
  const discountPct = Number((c as { firstMonthDiscountPct?: number }).firstMonthDiscountPct || 0)
  const leasedPrice = Math.round(askingPrice * (1 - discountPct / 100) * 100) / 100
  const pricePerWeek = Math.round((leasedPrice / 4) * 100) / 100
  const weeks = c.startDate && c.endDate
    ? Math.ceil(Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7)
    : null

  const collected = Math.round(payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100
  const invoicedTotal = Math.round(payments.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100
  const outstanding = Math.round(Math.max(0, invoicedTotal - collected) * 100) / 100

  const customer = c.customer
  const phone = customer?.phones?.[0] ?? customer?.phone ?? ''
  const waPhone = phone.replace(/\D/g, '').replace(/^00/, '')

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
            <div className="flex items-center gap-3">
              <span style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>{c.contractNo}</span>
              <Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>
            </div>
            <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
              {customer?._id ? (
                <Link to={`/customers/${customer._id}`} className="hover:underline" style={{ color: PURPLE }}>
                  {customer.fullName}
                </Link>
              ) : 'No tenant'}
              {units.length > 0 && ` · ${units.map(u => u.unitNumber).join(', ')}`}
            </div>
          </div>
          <div className="flex gap-2">
            {phone && (
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border-2 hover:opacity-80 transition-opacity"
                style={{ borderColor: '#047857', color: '#047857' }}>
                <MessageSquare size={14} /> Message
              </a>
            )}
            <Link to={`/contracts/${c._id}`}>
              <button type="button"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border-2 hover:opacity-80 transition-opacity"
                style={{ borderColor: PURPLE, color: PURPLE }}>
                <Pencil size={14} /> Manage
              </button>
            </Link>
            <a href={`/api/contracts/${c._id}/pdf`} target="_blank" rel="noreferrer">
              <button type="button"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: PURPLE }}>
                <Download size={15} /> PDF
              </button>
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Left sidebar */}
        <div className="space-y-4">
          <SectionCard title="Contract details">
            <InfoRow label="Check In" value={c.startDate ? formatDate(c.startDate) : null} />
            <InfoRow label="Check Out" value={c.endDate ? formatDate(c.endDate) : null} />
            <InfoRow label="Number of Weeks" value={weeks} />
            <InfoRow label="Unit Number" value={units.map(u => u.unitNumber).join(', ')} />
            <InfoRow label="Asking Price" value={`AED ${formatMoney(askingPrice)}`} />
            <InfoRow label="Leased Price" value={`AED ${formatMoney(leasedPrice)}`} />
            <InfoRow label="Price Per Week" value={`AED ${formatMoney(pricePerWeek)}`} />
            <InfoRow label="Total Quotation" value={`AED ${formatMoney(c.totalQuotation || 0)}`} />
          </SectionCard>

          <SectionCard title="Tenant">
            <InfoRow label="Name" value={customer?.fullName} />
            <InfoRow label="Client ID" value={customer?.clientId} />
            <InfoRow label="Email" value={customer?.email} />
            <InfoRow label="Phone" value={phone} />
            <InfoRow label="Nationality" value={customer?.nationality} />
          </SectionCard>

          <SectionCard title="Terms">
            <InfoRow label="Billing" value={c.billingPeriod === 'weekly' ? 'Weekly' : '4 weeks'} />
            <InfoRow label="Deposit" value={c.deposit ? `AED ${formatMoney(c.deposit)}` : null} />
            <InfoRow label="Payment method" value={c.paymentMethod} />
            {/* autoRenew exists on the server record but not the shared type */}
            <InfoRow label="Auto-renew" value={(c as { autoRenew?: boolean }).autoRenew ? 'On' : 'Off'} />
          </SectionCard>
        </div>

        {/* Right content */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatBox icon={<FileText size={11} />} label="Invoiced" value={formatMoney(invoicedTotal)} color={INK} />
            <StatBox icon={<Receipt size={11} />} label="Collected" value={formatMoney(collected)} color="#047857" />
            <StatBox icon={<FileText size={11} />} label="Outstanding" value={formatMoney(outstanding)} color={outstanding > 0 ? '#D97706' : MUTED} />
          </div>

          <SectionCard title="Invoices" subtitle={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`}>
            {invoices.length === 0 ? (
              <EmptyState message="No invoices for this contract yet." />
            ) : (
              <div className="-mx-5" style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr><Th>Invoice</Th><Th>Due</Th><Th>Total</Th><Th>Paid</Th><Th>Status</Th></tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv._id} className="hover:bg-muted/50">
                        <Td>
                          <Link to={`/invoices/${inv._id}`} className="font-medium hover:underline" style={{ color: PURPLE }}>
                            {inv.invoiceNo}
                          </Link>
                        </Td>
                        <Td className="whitespace-nowrap text-xs">{inv.dueDate ? formatDate(inv.dueDate) : '—'}</Td>
                        <Td>{formatMoney(inv.total || 0)}</Td>
                        <Td style={{ color: '#047857' }} className="font-medium">{formatMoney(inv.paymentMade || 0)}</Td>
                        <Td><Badge tone={contractStatusTone[inv.status] ?? 'gray'}>{statusLabel(inv.status)}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Payment schedule" subtitle={`${payments.length} record${payments.length !== 1 ? 's' : ''}`}>
            {payments.length === 0 ? (
              <EmptyState message="No payment records yet." />
            ) : (
              <div className="-mx-5" style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr><Th>Due</Th><Th>Amount</Th><Th>Paid on</Th><Th>Method</Th><Th>Status</Th></tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p._id} className="hover:bg-muted/50">
                        <Td className="whitespace-nowrap text-xs">{formatDate(p.dueDate)}</Td>
                        <Td className="font-medium">{formatMoney(p.amount)}</Td>
                        <Td className="whitespace-nowrap text-xs">{p.paidDate ? formatDate(p.paidDate) : '—'}</Td>
                        <Td className="text-xs capitalize">{p.method ? p.method.replace(/_/g, ' ') : '—'}</Td>
                        <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Documents" subtitle={`${documents.length} file${documents.length !== 1 ? 's' : ''}`}>
            {documents.length === 0 ? (
              <EmptyState message="No documents attached to this contract." />
            ) : (
              <div className="space-y-2">
                {documents.map((d) => (
                  <div key={d._id} className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5"
                    style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} style={{ color: PURPLE }} className="shrink-0" />
                      <span className="text-sm truncate" style={{ color: INK }}>{d.name}</span>
                    </div>
                    <a href={d.url} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold hover:underline shrink-0" style={{ color: PURPLE }}>
                      Open
                    </a>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {(c.timeline?.length ?? 0) > 0 && (
            <SectionCard title="Activity" subtitle="Most recent first">
              <div className="space-y-2">
                {[...(c.timeline ?? [])].reverse().slice(0, 12).map((note, i) => (
                  <div key={i} className="rounded-xl px-4 py-2.5" style={{ background: '#fff', border: '1px solid rgba(20,8,31,0.08)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm" style={{ color: INK }}>{note.text}</span>
                      <span className="text-[11px] shrink-0" style={{ color: MUTED }}>{formatDate(note.at)}</span>
                    </div>
                    {note.author && <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>by {note.author}</div>}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}
