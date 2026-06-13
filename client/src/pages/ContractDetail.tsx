import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, Download, PenLine, Upload, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AppDocument, Contract, Payment } from '../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, PageHeader, Select, Spinner, Table, Td, Th, contractStatusTone, paymentStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { UploadDocumentForm } from './Documents'

export default function ContractDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [recordingPayment, setRecordingPayment] = useState<Payment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  const { data, isLoading } = useQuery<{ contract: Contract; payments: Payment[]; documents: AppDocument[] }>({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contract', id] })
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['units'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const action = useMutation({
    mutationFn: (path: string) => api.post(`/contracts/${id}/${path}`),
    onSuccess: () => { invalidate(); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const recordPayment = useMutation({
    mutationFn: ({ paymentId, method }: { paymentId: string; method: string }) =>
      api.post(`/payments/${paymentId}/record`, { method }),
    onSuccess: () => { invalidate(); setRecordingPayment(null) },
    onError: (e) => setError(apiError(e)),
  })

  const downloadContractPdf = async () => {
    if (!c?._id) return
    try {
      setDownloadingPdf(true)
      setError('')
      const response = await api.get(`/contracts/${c._id}/pdf`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError(apiError(e))
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (isLoading || !data) return <Spinner />
  const { contract: c, payments, documents } = data

  const paid = payments.filter((p) => p.status === 'paid')
  const totalPaid = paid.reduce((s, p) => s + p.amount, 0)
  const totalDue = payments.reduce((s, p) => s + p.amount, 0)
  const isMock = c.zohoRequestId?.startsWith('MOCK-')

  return (
    <div>
      <PageHeader
        title={c.contractNo}
        subtitle={`${c.customer?.fullName} · Unit ${c.unit?.unitNumber} (${c.unit?.sizeSqf ?? '—'} sq ft)`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadContractPdf} disabled={downloadingPdf}>
              <Download size={14} /> {downloadingPdf ? 'Opening PDF...' : 'Contract PDF'}
            </Button>
            {c.status === 'draft' && (
              <>
                <Button size="sm" onClick={() => action.mutate('send-signature')} disabled={action.isPending}>
                  <PenLine size={14} /> Send for signature
                </Button>
                <Button size="sm" variant="success" onClick={() => action.mutate('activate')} disabled={action.isPending}>
                  <CheckCircle2 size={14} /> Activate (signed on paper)
                </Button>
              </>
            )}
            {c.status === 'pending_signature' && (
              <Button size="sm" variant="success" onClick={() => action.mutate('mark-signed')} disabled={action.isPending}>
                <CheckCircle2 size={14} /> {isMock ? 'Simulate signed' : 'Mark as signed'}
              </Button>
            )}
            {['draft', 'pending_signature'].includes(c.status) && (
              <Button size="sm" variant="destructive" onClick={() => { if (confirm('Cancel this contract?')) action.mutate('cancel') }} disabled={action.isPending}>
                <XCircle size={14} /> Cancel
              </Button>
            )}
            {c.status === 'active' && (
              <Button size="sm" variant="destructive" onClick={() => { if (confirm('End this contract and free the unit?')) action.mutate('end') }} disabled={action.isPending}>
                End contract
              </Button>
            )}
          </div>
        }
      />

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      {c.status === 'pending_signature' && isMock && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Zoho Sign is not configured — this signature request is simulated. Add Zoho credentials in <code>server/.env</code> to send real requests.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contract details" action={<Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>} />
          <CardBody className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-muted-foreground">Customer</div><Link to={`/customers/${c.customer?._id}`} className="text-primary hover:underline">{c.customer?.fullName}</Link></div>
              <div><div className="text-xs text-muted-foreground">Unit</div>{c.unit?.unitNumber}</div>
              <div><div className="text-xs text-muted-foreground">Billing</div><span className="capitalize">{c.billingPeriod}</span></div>
              <div><div className="text-xs text-muted-foreground">Rate</div>{formatMoney(c.rate)}</div>
              <div><div className="text-xs text-muted-foreground">Start</div>{formatDate(c.startDate)}</div>
              <div><div className="text-xs text-muted-foreground">End</div>{formatDate(c.endDate)}</div>
              <div><div className="text-xs text-muted-foreground">Deposit</div>{formatMoney(c.deposit)}</div>
              <div><div className="text-xs text-muted-foreground">Auto-renew</div>{c.autoRenew ? 'Yes' : 'No'}</div>
            </div>
            {c.signedDocUrl && (
              <a href={c.signedDocUrl} target="_blank" rel="noreferrer" className="block text-primary text-xs hover:underline">View signed contract →</a>
            )}
            {c.notes && <div><div className="text-xs text-muted-foreground">Notes</div>{c.notes}</div>}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Payment schedule"
            subtitle={`${paid.length}/${payments.length} paid · ${formatMoney(totalPaid)} of ${formatMoney(totalDue)}`}
          />
          {payments.length === 0 ? (
            <EmptyState message="No payments scheduled." />
          ) : (
            <Table>
              <thead><tr><Th>#</Th><Th>Due date</Th><Th>Amount</Th><Th>Status</Th><Th>Paid on</Th><Th>Method</Th><Th /></tr></thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p._id} className="hover:bg-muted/50">
                    <Td className="text-muted-foreground">{i + 1}</Td>
                    <Td>{formatDate(p.dueDate)}</Td>
                    <Td className="font-medium">{formatMoney(p.amount)}</Td>
                    <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                    <Td>{formatDate(p.paidDate)}</Td>
                    <Td className="capitalize">{(p.method || '—').replace('_', ' ')}</Td>
                    <Td>
                      {p.status !== 'paid' && (
                        <Button size="sm" variant="outline" onClick={() => setRecordingPayment(p)}>Record payment</Button>
                      )}
                    </Td>
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
          action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={13} /> Upload</Button>}
        />
        {documents.length === 0 ? (
          <EmptyState message="No documents attached to this contract." />
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

      <Modal open={!!recordingPayment} onClose={() => setRecordingPayment(null)} title="Record payment">
        {recordingPayment && (
          <RecordPaymentForm
            payment={recordingPayment}
            busy={recordPayment.isPending}
            onSubmit={(method) => recordPayment.mutate({ paymentId: recordingPayment._id, method })}
          />
        )}
      </Modal>

      <Modal open={uploading} onClose={() => setUploading(false)} title="Upload document">
        <UploadDocumentForm contractId={c._id} customerId={c.customer?._id} onDone={() => { invalidate(); setUploading(false) }} />
      </Modal>
    </div>
  )
}

function RecordPaymentForm({ payment, busy, onSubmit }: { payment: Payment; busy: boolean; onSubmit: (method: string) => void }) {
  const [method, setMethod] = useState('cash')
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Record <strong>{formatMoney(payment.amount)}</strong> due {formatDate(payment.dueDate)} as paid today.
      </p>
      <Field label="Payment method">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Button className="w-full" disabled={busy} onClick={() => onSubmit(method)}>Record payment</Button>
    </div>
  )
}
