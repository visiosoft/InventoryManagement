import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload, CloudUpload, Loader2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AppDocument, Customer } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, statusLabel } from '../components/ui'
import { formatDate } from '../lib/utils'

export function UploadDocumentForm({ contractId, customerId, onDone }: { contractId?: string; customerId?: string; onDone: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ['customers', ''],
    queryFn: () => api.get('/customers').then((r) => r.data),
    enabled: !customerId,
  })

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    if (contractId) form.set('contract', contractId)
    if (customerId) form.set('customer', customerId)
    setBusy(true)
    setError('')
    try {
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      onDone()
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="File"><Input type="file" name="file" required className="h-auto py-1.5" /></Field>
      <Field label="Document type">
        <Select name="type" defaultValue="other">
          <option value="id_proof">ID proof</option>
          <option value="contract">Contract</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      {!customerId && (
        <Field label="Customer (optional)">
          <Select name="customer" defaultValue="">
            <option value="">—</option>
            {(customers || []).map((c) => <option key={c._id} value={c._id}>{c.fullName}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Display name (optional)"><Input name="name" placeholder="Defaults to file name" /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
    </form>
  )
}

export default function Documents() {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const { data: docs, isLoading } = useQuery<AppDocument[]>({
    queryKey: ['documents'],
    queryFn: () => api.get('/documents').then((r) => r.data),
  })
  const { data: storage } = useQuery<{ driveConfigured: boolean }>({
    queryKey: ['storage-status'],
    queryFn: () => api.get('/documents/storage-status').then((r) => r.data),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })

  const syncToDrive = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/sync-to-drive`),
    onSuccess: () => { setSyncingId(null); qc.invalidateQueries({ queryKey: ['documents'] }) },
    onError: () => setSyncingId(null),
  })

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={storage?.driveConfigured ? 'Files are stored in Google Drive' : 'Google Drive not configured — files stored locally on the server'}
        action={<Button onClick={() => setUploading(true)}><Upload size={15} /> Upload document</Button>}
      />

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Name</Th><Th>Type</Th><Th>Customer</Th><Th>Contract</Th><Th>Storage</Th><Th>Uploaded</Th><Th /></tr></thead>
            <tbody>
              {(docs || []).map((d) => (
                <tr key={d._id} className="hover:bg-muted/50">
                  <Td className="font-medium">{d.name}</Td>
                  <Td>{statusLabel(d.type)}</Td>
                  <Td>{d.customer ? <Link className="text-primary hover:underline" to={`/customers/${d.customer._id}`}>{d.customer.fullName}</Link> : '—'}</Td>
                  <Td>{d.contract ? <Link className="text-primary hover:underline" to={`/contracts/${d.contract._id}`}>{d.contract.contractNo}</Link> : '—'}</Td>
                  <Td><Badge tone={d.storage === 'drive' ? 'blue' : 'gray'}>{d.storage === 'drive' ? 'Google Drive' : 'Local'}</Badge></Td>
                  <Td>{formatDate(d.createdAt)}</Td>
                  <Td>
                    <div className="flex gap-2 items-center">
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Open</a>
                      {d.storage !== 'drive' && storage?.driveConfigured && (
                        <button
                          onClick={() => { setSyncingId(d._id); syncToDrive.mutate(d._id) }}
                          disabled={syncingId === d._id}
                          title="Upload to Google Drive"
                          className="text-xs text-blue-600 hover:underline cursor-pointer disabled:opacity-50 flex items-center gap-1"
                        >
                          {syncingId === d._id
                            ? <><Loader2 size={12} className="animate-spin" /> Uploading…</>
                            : <><CloudUpload size={12} /> Drive</>}
                        </button>
                      )}
                      <button onClick={() => { if (confirm('Delete this document record?')) del.mutate(d._id) }} className="text-destructive text-xs hover:underline cursor-pointer">Delete</button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(docs || []).length === 0 && <EmptyState message="No documents uploaded yet." />}
        </Card>
      )}

      <Modal open={uploading} onClose={() => setUploading(false)} title="Upload document">
        <UploadDocumentForm onDone={() => { qc.invalidateQueries({ queryKey: ['documents'] }); setUploading(false) }} />
      </Modal>
    </div>
  )
}
