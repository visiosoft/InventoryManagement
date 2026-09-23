import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'
import { FULFILLMENT_STATES, statusLabel, statusTone } from '../../lib/shopify'
import type { FulfillmentJob, Merchant, Sku } from '../../lib/shopify'

// command()'s idempotency check requires a client-generated UUID requestId
// on every mutating call — see server/src/services/warehouse.js.
const uuid = () => crypto.randomUUID()

function NewTestOrderModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [merchant, setMerchant] = useState('')
  const [lines, setLines] = useState<{ sku: string; quantity: string }[]>([{ sku: '', quantity: '1' }])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: merchants } = useQuery<Merchant[]>({ queryKey: ['shopify-merchants-picker'], queryFn: () => api.get('/shopify/merchants').then(r => r.data) })
  const { data: skus } = useQuery<Sku[]>({
    queryKey: ['shopify-skus-picker', merchant],
    queryFn: () => api.get('/shopify/skus', { params: { merchant } }).then(r => r.data),
    enabled: !!merchant,
  })

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.post('/shopify/jobs', {
        requestId: uuid(),
        merchant,
        lines: lines.filter(l => l.sku && l.quantity).map(l => ({ sku: l.sku, quantity: Number(l.quantity) })),
      })
      onDone()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open title="Create a test fulfillment job" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Phase A tool: stands in for a real Shopify order, so the pick/pack/ship flow can be tested before a live order webhook exists.
        </p>
        <Field label="Merchant">
          <Select value={merchant} onChange={e => { setMerchant(e.target.value); setLines([{ sku: '', quantity: '1' }]) }}>
            <option value="">Select a merchant…</option>
            {(merchants ?? []).map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
          </Select>
        </Field>
        {merchant && lines.map((line, i) => (
          <div key={i} className="flex gap-2 items-end">
            <Field label={`Line ${i + 1} — SKU`} className="flex-1">
              <Select value={line.sku} onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, sku: e.target.value } : l))}>
                <option value="">Select a SKU…</option>
                {(skus ?? []).map(s => <option key={s._id} value={s._id}>{s.sku} — {s.productTitle} (avail {s.available})</option>)}
              </Select>
            </Field>
            <Field label="Qty">
              <Input type="number" min={1} value={line.quantity} onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))} className="w-20" />
            </Field>
          </div>
        ))}
        {merchant && (
          <Button variant="outline" onClick={() => setLines(ls => [...ls, { sku: '', quantity: '1' }])}>
            <Plus size={13} /> Add line
          </Button>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !merchant || !lines.some(l => l.sku && l.quantity)}>
            {busy ? 'Creating…' : 'Create job'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function JobDetail({ job, onClose, onChanged }: { job: FulfillmentJob; onClose: () => void; onChanged: () => void }) {
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function pick(sku: string, remaining: number) {
    setBusy(true); setErr('')
    try {
      await api.post(`/shopify/jobs/${job._id}/pick`, { requestId: uuid(), sku, quantity: remaining })
      onChanged()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }
  async function pack() {
    setBusy(true); setErr('')
    try { await api.post(`/shopify/jobs/${job._id}/pack`, { requestId: uuid() }); onChanged() }
    catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }
  async function ship() {
    setBusy(true); setErr('')
    try { await api.post(`/shopify/jobs/${job._id}/ship`, { requestId: uuid(), carrier, trackingNumber: tracking }); onChanged() }
    catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }
  async function resolve(action: 'cancel' | 'ship_partial') {
    setBusy(true); setErr('')
    try { await api.post(`/shopify/jobs/${job._id}/resolve-backorder`, { requestId: uuid(), action }); onChanged() }
    catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open title={`Job ${job._id.slice(0, 8)}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[job.status].includes('destructive') ? 'red' : undefined} className={statusTone[job.status]}>{statusLabel(job.status)}</Badge>
          {job.backorderNote && <span className="text-xs text-amber-800">{job.backorderNote}</span>}
        </div>
        <div className="rounded-lg border divide-y">
          {job.lines.map((line, i) => {
            const sku = typeof line.sku === 'object' ? line.sku : null
            const location = typeof line.pickLocationHint === 'object' && line.pickLocationHint ? line.pickLocationHint.displayCode : null
            const remaining = line.ordered - line.picked
            return (
              <div key={i} className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{sku ? `${sku.sku} — ${sku.productTitle}` : String(line.sku)}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.picked}/{line.ordered} picked{location ? ` · look in ${location}` : ' · no location on file'}
                  </p>
                </div>
                {['READY_TO_PICK', 'PICKING'].includes(job.status) && remaining > 0 && (
                  <Button variant="outline" disabled={busy} onClick={() => pick(sku?._id ?? String(line.sku), remaining)}>
                    Pick remaining {remaining}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {job.status === 'PARTIAL_BACKORDER' && (
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => resolve('ship_partial')}>Ship what's reserved</Button>
            <Button variant="outline" disabled={busy} onClick={() => resolve('cancel')}>Cancel job</Button>
          </div>
        )}

        {job.status === 'PICKED' && (
          <Button disabled={busy} onClick={pack}>Mark packed</Button>
        )}

        {job.status === 'PACKED' && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Carrier"><Input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="DHL, Aramex…" /></Field>
            <Field label="Tracking number"><Input value={tracking} onChange={e => setTracking(e.target.value)} /></Field>
            <Button disabled={busy || !carrier || !tracking} onClick={ship}>Mark shipped</Button>
          </div>
        )}

        {job.status === 'SHIPPED' && (
          <p className="text-sm text-muted-foreground">Shipped via {job.carrier} — tracking {job.trackingNumber}.</p>
        )}

        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

export default function FulfillmentQueue() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const [openJobId, setOpenJobId] = useState<string | null>(null)

  const { data: jobs, isLoading } = useQuery<FulfillmentJob[]>({
    queryKey: ['shopify-jobs', status],
    queryFn: () => api.get('/shopify/jobs', { params: { status: status || undefined } }).then(r => r.data),
    refetchInterval: 15_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['shopify-jobs'] })
  const openJob = jobs?.find(j => j._id === openJobId) ?? null

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Fulfillment queue"
        subtitle="Pick, pack, and ship Shopify orders."
        action={user?.role === 'admin' ? <Button onClick={() => setCreating(true)}><Plus size={14} /> New test order</Button> : undefined}
      />
      <Select value={status} onChange={e => setStatus(e.target.value)} className="max-w-xs">
        <option value="">All statuses</option>
        {FULFILLMENT_STATES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </Select>

      {isLoading ? <Spinner /> : !jobs?.length ? (
        <EmptyState message="No fulfillment jobs yet." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map(job => (
            <button
              key={job._id}
              onClick={() => setOpenJobId(job._id)}
              className="text-left rounded-lg border p-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{job._id.slice(0, 8)}</span>
                <Badge tone={job.status === 'PARTIAL_BACKORDER' ? 'amber' : job.status === 'SHIPPED' ? 'green' : job.status === 'CANCELLED' ? 'gray' : 'blue'}>
                  {statusLabel(job.status)}
                </Badge>
              </div>
              <p className="mt-2 text-sm">{job.lines.length} line{job.lines.length === 1 ? '' : 's'}</p>
              <p className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}

      {creating && <NewTestOrderModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); invalidate() }} />}
      {openJob && <JobDetail job={openJob} onClose={() => setOpenJobId(null)} onChanged={invalidate} />}
    </div>
  )
}
