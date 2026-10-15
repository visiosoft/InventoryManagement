import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '../../components/ui'

/** Pushes to customers' phones through the customer app. Most go out on their
 *  own (booking updates, payments, due dates, renewals); this page is for the
 *  two a person sends — a promotion and a unit inspection — and for seeing
 *  what went out. Promotions need Campaign Studio, inspections the warehouse
 *  permission, the same as the server checks. */

const KINDS = ['payment', 'renewal', 'promotion', 'inspection', 'service'] as const
const KIND_TONE: Record<string, string> = { payment: 'green', renewal: 'amber', promotion: 'purple', inspection: 'blue', service: 'gray' }

interface SentNotification {
  id: string
  kind: string
  title: string
  body: string
  read: boolean
  createdAt: string
  customer: { id: string; name: string } | null
}

interface ContractHit { id: string; contractNo: string; customerName: string; units: string[]; endDate: string }

const AUDIENCE_TEXT: Record<string, string> = {
  tenants: 'every customer with an active contract',
  all: 'every customer who has used the app',
}

function PromotionForm({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'tenants' | 'all'>('tenants')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState('')
  const valid = title.trim().length >= 3 && title.trim().length <= 80 && body.trim().length >= 3 && body.trim().length <= 300

  async function send() {
    setBusy(true); setErr('')
    try {
      const r = await api.post('/customer-notifications/broadcast', { title, body, audience })
      setResult(`Sent to ${r.data.recipients} customer${r.data.recipients === 1 ? '' : 's'} (${r.data.sent} phone${r.data.sent === 1 ? '' : 's'} reached).`)
      setTitle(''); setBody(''); setConfirming(false)
      onSent()
    } catch (e) { setErr(apiError(e)); setConfirming(false) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader title="Send a promotion" subtitle="Customers who switched promotions off in the app are skipped." />
      <CardBody className="space-y-3">
        <Field label={`Title (${title.trim().length}/80)`}><Input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label={`Message (${body.trim().length}/300)`}><Textarea value={body} maxLength={300} rows={3} onChange={e => setBody(e.target.value)} /></Field>
        <Field label="Send to">
          <Select value={audience} onChange={e => setAudience(e.target.value as 'tenants' | 'all')}>
            <option value="tenants">Tenants (active contract)</option>
            <option value="all">Everyone who uses the app</option>
          </Select>
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {result && <p className="text-xs text-emerald-700">{result}</p>}
        <div className="flex justify-end"><Button onClick={() => { setResult(''); setConfirming(true) }} disabled={!valid}>Review & send</Button></div>
      </CardBody>
      <Modal open={confirming} title="Send this to real customers?" onClose={() => setConfirming(false)}>
        <div className="space-y-4">
          <p className="text-sm">This goes out now, as a push notification, to {AUDIENCE_TEXT[audience]}. It cannot be taken back.</p>
          <div className="rounded-lg border p-3">
            <p className="font-semibold text-sm">{title.trim()}</p>
            <p className="text-sm text-muted-foreground">{body.trim()}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send to customers'}</Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

function InspectionForm({ onSent }: { onSent: () => void }) {
  const [q, setQ] = useState('')
  const [contract, setContract] = useState<ContractHit | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState('')

  const { data: hits, isFetching } = useQuery<ContractHit[]>({
    queryKey: ['customer-notifications', 'contracts', q.trim()],
    queryFn: () => api.get('/customer-notifications/contracts', { params: { q: q.trim() } }).then(r => r.data),
    enabled: !contract && q.trim().length >= 2,
  })

  async function send() {
    if (!contract) return
    setBusy(true); setErr('')
    try {
      const r = await api.post('/customer-notifications/inspection', { contractId: contract.id, date, ...(time ? { time } : {}), ...(note.trim() ? { note } : {}) })
      setResult(`${contract.customerName} notified${r.data.sent ? '' : ' (in the app inbox — no phone reached)'}, and the contract timeline noted.`)
      setContract(null); setQ(''); setDate(''); setTime(''); setNote('')
      onSent()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader title="Schedule a unit inspection" subtitle="Tells the tenant in the app and adds a line to the contract timeline." />
      <CardBody className="space-y-3">
        {contract ? (
          <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span><span className="font-mono">{contract.contractNo}</span> · {contract.customerName} · {contract.units.join(', ')}</span>
            <Button size="sm" variant="outline" onClick={() => setContract(null)}>Change</Button>
          </div>
        ) : (
          <Field label="Contract number">
            <Input value={q} placeholder="e.g. C-1042" onChange={e => setQ(e.target.value)} />
            {isFetching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
            {!!hits?.length && (
              <div className="mt-1 rounded-lg border divide-y">
                {hits.map(h => (
                  <button key={h.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => { setContract(h); setResult('') }}>
                    <span className="font-mono">{h.contractNo}</span> · {h.customerName} · {h.units.join(', ')}
                  </button>
                ))}
              </div>
            )}
            {hits && !hits.length && q.trim().length >= 2 && !isFetching && <p className="text-xs text-muted-foreground mt-1">No active contract matches.</p>}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Time (optional)"><Input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
        </div>
        <Field label="Note for the tenant (optional)"><Textarea value={note} maxLength={300} rows={2} onChange={e => setNote(e.target.value)} /></Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {result && <p className="text-xs text-emerald-700">{result}</p>}
        <div className="flex justify-end"><Button onClick={send} disabled={!contract || !date || busy}>{busy ? 'Sending…' : 'Notify tenant'}</Button></div>
      </CardBody>
    </Card>
  )
}

export default function CustomerNotifications() {
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.role === 'admin'
  const canPromote = isAdmin || hasPermission('campaign_studio')
  const canInspect = isAdmin || hasPermission(['warehouse', 'warehouse_supervisor'])
  const [kind, setKind] = useState('')
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer-notifications', 'recent'] })

  const { data, isLoading } = useQuery<SentNotification[]>({
    queryKey: ['customer-notifications', 'recent', kind],
    queryFn: () => api.get('/customer-notifications/recent', { params: { kind: kind || undefined } }).then(r => r.data),
  })

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader title="Customer notifications" subtitle="Pushes to the customer app. Booking updates, payments, due dates and renewals go out on their own." />
      <div className="grid gap-4 lg:grid-cols-2">
        {canPromote && <PromotionForm onSent={refresh} />}
        {canInspect && <InspectionForm onSent={refresh} />}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-sm">Recently sent</h2>
        <Select value={kind} onChange={e => setKind(e.target.value)} className="max-w-xs">
          <option value="">All kinds</option>
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </Select>
      </div>
      {isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState message="Nothing sent yet." />
      ) : (
        <Table>
          <thead><tr><Th>When</Th><Th>Customer</Th><Th>Kind</Th><Th>Message</Th><Th>Read</Th></tr></thead>
          <tbody>
            {data.map(n => (
              <tr key={n.id}>
                <Td className="whitespace-nowrap text-sm">{new Date(n.createdAt).toLocaleString()}</Td>
                <Td className="text-sm">{n.customer?.name || '—'}</Td>
                <Td><Badge tone={KIND_TONE[n.kind]}>{n.kind}</Badge></Td>
                <Td className="text-sm">{n.title}<div className="text-xs text-muted-foreground">{n.body}</div></Td>
                <Td className="text-sm">{n.read ? 'Yes' : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
