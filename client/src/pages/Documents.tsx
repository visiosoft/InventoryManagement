import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload, CloudUpload, Loader2, ScanText } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AppDocument, Customer } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, statusLabel } from '../components/ui'
import { formatDate } from '../lib/utils'

export function UploadDocumentForm({ contractId, customerId, onDone }: { contractId?: string; customerId?: string; onDone: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  // "Uploading 2 of 5…" — the API takes one file per request, so a batch is
  // sent as a sequence and we track where we are.
  const [progress, setProgress] = useState(0)
  const { data: customersPage } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-all'],
    queryFn: () => api.get('/customers', { params: { limit: 500 } }).then((r) => r.data),
    enabled: !customerId,
  })
  const customers = customersPage?.data ?? []

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!files.length) { setError('Choose at least one file'); return }
    const fields = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    setProgress(0)

    const failed: string[] = []
    for (let i = 0; i < files.length; i++) {
      setProgress(i + 1)
      const form = new FormData()
      form.set('file', files[i])
      form.set('type', String(fields.get('type') || 'other'))
      if (contractId) form.set('contract', contractId)
      if (customerId) form.set('customer', customerId)
      else if (fields.get('customer')) form.set('customer', String(fields.get('customer')))
      // A custom display name only makes sense for a single file; a batch keeps
      // each file's own name so they stay distinguishable.
      if (files.length === 1 && fields.get('name')) form.set('name', String(fields.get('name')))
      try {
        await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      } catch (err) {
        failed.push(`${files[i].name}: ${apiError(err)}`)
      }
    }

    setBusy(false)
    setProgress(0)
    if (failed.length === files.length) {
      setError(failed.join(' · '))
      return
    }
    if (failed.length) {
      setError(`Uploaded ${files.length - failed.length} of ${files.length}. Failed — ${failed.join(' · ')}`)
      setFiles([])
      return
    }
    setFiles([])
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={files.length > 1 ? `Files (${files.length} selected)` : 'File'}>
        <Input type="file" multiple className="h-auto py-1.5"
          onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setError('') }} />
        {files.length > 1 && (
          <ul className="mt-2 max-h-28 overflow-y-auto rounded-lg border divide-y text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="px-2.5 py-1 truncate">{f.name}</li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Document type">
        <Select name="type" defaultValue="other">
          <option value="emirates_id">Emirates ID</option>
          <option value="passport">Passport</option>
          <option value="visa">Visa</option>
          <option value="trade_license">Trade License</option>
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
      {files.length <= 1 && (
        <Field label="Display name (optional)"><Input name="name" placeholder="Defaults to file name" /></Field>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? files.length > 1 ? `Uploading ${progress} of ${files.length}…` : 'Uploading…'
          : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
      </Button>
    </form>
  )
}

/** Document types that hold fields worth reading off. */
const READABLE_TYPES = new Set(['emirates_id', 'passport', 'visa', 'id_proof'])

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  emiratesId: 'Emirates ID',
  eidExpiry: 'Emirates ID expiry',
  passportNumber: 'Passport number',
  passportExpiry: 'Passport expiry',
  nationality: 'Nationality',
}

type ExtractRow = { field: string; proposed: string; current: string; changed: boolean; isNew: boolean }
type ExtractResult = {
  ok: boolean
  model: string
  fields: Record<string, string>
  rejected: { field: string; value: string; reason: string }[]
  rows: ExtractRow[]
  customer: { _id: string; fullName: string } | null
  usage: { totalTokens: number } | null
}

/**
 * Show what the model read, and save only what a person ticks.
 *
 * Nothing here writes on its own. A field already holding a value shows that
 * value beside the proposed one, because overwriting a checked Emirates ID
 * with a misread is the one outcome worth designing against.
 */
function ExtractReview({ doc, onClose }: { doc: AppDocument; onClose: () => void }) {
  const qc = useQueryClient()
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)

  const read = useQuery<ExtractResult>({
    queryKey: ['doc-extract', doc._id],
    queryFn: () => api.post(`/documents/${doc._id}/extract`).then((r) => r.data),
    retry: false,
    staleTime: Infinity,
  })

  // New fields start ticked; a field that would replace something does not —
  // replacing is a decision, filling a blank is not.
  const rows = read.data?.rows ?? []
  const initialised = useRef(false)
  useEffect(() => {
    if (initialised.current || !rows.length) return
    initialised.current = true
    setAccepted(Object.fromEntries(rows.map((r) => [r.field, r.isNew])))
  }, [rows])

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {}
      for (const r of rows) if (accepted[r.field]) body[r.field] = r.proposed
      return api.put(`/customers/${read.data!.customer!._id}`, body)
    },
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  const chosen = rows.filter((r) => accepted[r.field]).length

  return (
    <Modal open onClose={onClose} title="Read this document">
      {read.isLoading ? (
        <div className="py-8 text-center space-y-2">
          <Loader2 size={20} className="animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground">Reading the document…</p>
        </div>
      ) : read.isError ? (
        <p className="text-sm text-destructive">{apiError(read.error)}</p>
      ) : saved ? (
        <div className="space-y-3">
          <p className="text-sm">
            Saved to <strong>{read.data?.customer?.fullName}</strong>.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!read.data?.customer && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This document is not attached to a customer, so there is nothing to save it to.
              Re-upload it against a customer first.
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing could be read from this document with confidence. Enter the details by hand.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <label
                  key={r.field}
                  className="flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!accepted[r.field]}
                    onChange={(e) => setAccepted((a) => ({ ...a, [r.field]: e.target.checked }))}
                    disabled={!read.data?.customer}
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block text-xs text-muted-foreground">{FIELD_LABELS[r.field] ?? r.field}</span>
                    <span className="font-medium break-words">{r.proposed}</span>
                    {!r.isNew && r.changed && (
                      <span className="block text-xs text-amber-700 mt-0.5">
                        replaces <span className="line-through">{r.current}</span>
                      </span>
                    )}
                    {!r.changed && (
                      <span className="block text-xs text-muted-foreground mt-0.5">already stored — no change</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Said out loud rather than silently dropped, so a misread is
              visible and can be typed in by hand. */}
          {!!read.data?.rejected.length && (
            <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
              <p className="font-medium">Read but not used:</p>
              {read.data.rejected.map((r) => (
                <p key={r.field}>
                  {FIELD_LABELS[r.field] ?? r.field}: “{r.value}” — {r.reason}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              {read.data?.model}
              {read.data?.usage ? ` · ${read.data.usage.totalTokens} tokens` : ''}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={!chosen || save.isPending || !read.data?.customer}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : `Save ${chosen} field${chosen === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
          {save.isError && <p className="text-xs text-destructive">{apiError(save.error)}</p>}
        </div>
      )}
    </Modal>
  )
}

export default function Documents() {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [reading, setReading] = useState<AppDocument | null>(null)

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
                      {READABLE_TYPES.has(d.type) && (
                        <button
                          onClick={() => setReading(d)}
                          title="Read the details off this document"
                          className="text-xs text-violet-700 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <ScanText size={12} /> Read
                        </button>
                      )}
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

      {reading && <ExtractReview doc={reading} onClose={() => setReading(null)} />}

      <Modal open={uploading} onClose={() => setUploading(false)} title="Upload document">
        <UploadDocumentForm onDone={() => { qc.invalidateQueries({ queryKey: ['documents'] }); setUploading(false) }} />
      </Modal>
    </div>
  )
}
