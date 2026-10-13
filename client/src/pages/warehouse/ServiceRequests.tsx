import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '../../components/ui'

/** Valet jobs customers booked in the app: boxes & labels, pickups,
 *  drop-offs and workers. Staff confirm them, assign a driver, and record
 *  what was charged once done — nothing is charged at booking. */

const STATUSES = ['requested', 'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const
type Status = typeof STATUSES[number]
const FINAL: Status[] = ['completed', 'cancelled']

const TYPE_LABEL: Record<string, string> = {
  supplies: 'Boxes & labels', pickup: 'Pickup', dropoff: 'Drop-off', both: 'Pickup & drop-off', worker: 'Worker',
}
const STATUS_TONE: Record<Status, string> = {
  requested: 'amber', confirmed: 'blue', scheduled: 'blue', in_progress: 'purple', completed: 'green', cancelled: 'gray',
}
const statusText = (s: string) => s.replace('_', ' ')

interface ServiceRequest {
  _id: string
  ref: string
  type: string
  status: Status
  date: string
  slot: string | null
  startTime: string | null
  hours: number | null
  address: { label: string; line: string }
  pickup: { boxes: number; bulky: number; description: string }
  supplies: { boxes: number; extraLabels: number }
  items: Array<{ _id: string; displayCode: string; description?: string }>
  job: string
  notes: string
  estimate: { total: number }
  charged: number | null
  driverName: string
  driverPhone: string
  staffNote: string
  customer?: { fullName: string; phone: string; clientId?: string }
  contract?: { contractNo: string } | null
}

function when(r: ServiceRequest) {
  return r.type === 'worker' ? `${r.date} · ${r.startTime} for ${r.hours} h` : `${r.date} · ${r.slot?.replace('-', ':00–')}:00`
}

function what(r: ServiceRequest) {
  const parts: string[] = []
  if (r.type === 'supplies') parts.push(`${r.supplies.boxes} boxes, ${r.supplies.extraLabels} extra labels`)
  if (r.type === 'pickup' || r.type === 'both') parts.push(`collect ${r.pickup.boxes} boxes, ${r.pickup.bulky} bulky`)
  if (r.type === 'dropoff' || r.type === 'both') parts.push(`deliver ${r.items.length} item${r.items.length === 1 ? '' : 's'}`)
  if (r.type === 'worker') parts.push(r.job)
  return parts.join(' · ')
}

function EditModal({ request, onClose, onDone }: { request: ServiceRequest; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<Status>(request.status)
  const [driverName, setDriverName] = useState(request.driverName)
  const [driverPhone, setDriverPhone] = useState(request.driverPhone)
  const [charged, setCharged] = useState(request.charged == null ? '' : String(request.charged))
  const [staffNote, setStaffNote] = useState(request.staffNote)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = FINAL.includes(request.status)

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.patch(`/service-requests/${request._id}`, {
        ...(status !== request.status ? { status } : {}),
        driverName, driverPhone, staffNote,
        charged: charged.trim() === '' ? null : Number(charged),
      })
      onDone()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open title={`${request.ref} — ${TYPE_LABEL[request.type]}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {request.customer?.fullName} · {when(request)} · {request.address.line}
          {request.notes && <><br />Customer note: {request.notes}</>}
        </p>
        <Field label="Status">
          <Select value={status} onChange={e => setStatus(e.target.value as Status)} disabled={locked}>
            {STATUSES.map(s => <option key={s} value={s}>{statusText(s)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Driver name"><Input value={driverName} onChange={e => setDriverName(e.target.value)} /></Field>
          <Field label="Driver phone"><Input value={driverPhone} onChange={e => setDriverPhone(e.target.value)} /></Field>
        </div>
        <Field label={`Charged, AED (estimate ${request.estimate.total})`}>
          <Input type="number" min={0} value={charged} onChange={e => setCharged(e.target.value)} />
        </Field>
        <Field label="Staff note (not shown to the customer)">
          <Textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} rows={3} />
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function ServiceRequests() {
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<ServiceRequest | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<ServiceRequest[]>({
    queryKey: ['service-requests', status],
    queryFn: () => api.get('/service-requests', { params: { status: status || undefined } }).then(r => r.data),
  })

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader title="Service requests" subtitle="Pickups, drop-offs, boxes and workers booked from the customer app." />
      <Select value={status} onChange={e => setStatus(e.target.value)} className="max-w-xs">
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{statusText(s)}</option>)}
      </Select>
      {isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState message="No service requests." />
      ) : (
        <Table>
          <thead><tr><Th>Ref</Th><Th>Service</Th><Th>When</Th><Th>Customer</Th><Th>Address</Th><Th>Estimate</Th><Th>Driver</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r._id}>
                <Td className="font-mono text-sm">{r.ref}</Td>
                <Td>{TYPE_LABEL[r.type]}<div className="text-xs text-muted-foreground">{what(r)}</div></Td>
                <Td className="whitespace-nowrap">{when(r)}</Td>
                <Td>{r.customer?.fullName}<div className="text-xs text-muted-foreground">{r.customer?.phone}</div></Td>
                <Td className="text-sm">{r.address.label}<div className="text-xs text-muted-foreground">{r.address.line}</div></Td>
                <Td>AED {r.estimate.total}{r.charged != null && <div className="text-xs text-muted-foreground">charged {r.charged}</div>}</Td>
                <Td className="text-sm">{r.driverName || '—'}</Td>
                <Td><Badge tone={STATUS_TONE[r.status]}>{statusText(r.status)}</Badge></Td>
                <Td><Button size="sm" variant="outline" onClick={() => setEditing(r)}>Update</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <EditModal
          request={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['service-requests'] }) }}
        />
      )}
    </div>
  )
}
