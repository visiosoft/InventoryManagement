import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import type { Payment } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, Table, Td, Th, paymentStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

export default function Payments() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [recording, setRecording] = useState<Payment | null>(null)
  const [method, setMethod] = useState('cash')
  const [error, setError] = useState('')

  const { data: payments, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments', status],
    queryFn: () => api.get('/payments', { params: status ? { status } : {} }).then((r) => r.data),
  })

  const record = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) => api.post(`/payments/${id}/record`, { method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setRecording(null)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  const totals = (payments || []).reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + p.amount
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle={`Overdue: ${formatMoney(totals.overdue || 0)} · Pending: ${formatMoney(totals.pending || 0)} · Paid: ${formatMoney(totals.paid || 0)}`}
      />

      <div className="mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All payments</option>
          <option value="overdue">Overdue</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
        </Select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Customer</Th><Th>Contract</Th><Th>Unit</Th><Th>Due date</Th><Th>Amount</Th><Th>Status</Th><Th>Paid on</Th><Th /></tr></thead>
            <tbody>
              {(payments || []).map((p) => (
                <tr key={p._id} className="hover:bg-muted/50">
                  <Td>{p.contract?.customer?.fullName}</Td>
                  <Td><Link to={`/contracts/${p.contract?._id}`} className="font-medium text-primary hover:underline">{p.contract?.contractNo}</Link></Td>
                  <Td>{p.contract?.unit?.unitNumber}</Td>
                  <Td>{formatDate(p.dueDate)}</Td>
                  <Td className="font-medium">{formatMoney(p.amount)}</Td>
                  <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                  <Td>{formatDate(p.paidDate)}</Td>
                  <Td>{p.status !== 'paid' && <Button size="sm" variant="outline" onClick={() => setRecording(p)}>Record</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(payments || []).length === 0 && <EmptyState message="No payments found." />}
        </Card>
      )}

      <Modal open={!!recording} onClose={() => setRecording(null)} title="Record payment">
        {recording && (
          <div className="space-y-4">
            <p className="text-sm">
              Record <strong>{formatMoney(recording.amount)}</strong> from {recording.contract?.customer?.fullName} ({recording.contract?.contractNo}) as paid today.
            </p>
            <Field label="Payment method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button className="w-full" disabled={record.isPending} onClick={() => record.mutate({ id: recording._id, method })}>
              Record payment
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
