import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingLead, MovingLeadStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, Spinner, Textarea } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/utils'

const statusTone: Record<MovingLeadStatus, string> = {
  new: 'blue', contacted: 'yellow', quoted: 'purple', won: 'green', lost: 'red',
}

const STATUS_TRANSITIONS: Record<MovingLeadStatus, MovingLeadStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quoted', 'lost'],
  quoted: ['won', 'lost'],
  won: [],
  lost: ['new'],
}

export default function MovingLeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const [noteText, setNoteText] = useState('')
  const [err, setErr] = useState('')

  const { data: lead, isLoading } = useQuery<MovingLead>({
    queryKey: ['moving-lead', id],
    queryFn: () => api.get(`/moving-leads/${id}`).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-lead', id] })

  const statusMut = useMutation({
    mutationFn: (status: MovingLeadStatus) => api.patch(`/moving-leads/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const addNoteMut = useMutation({
    mutationFn: () => api.post(`/moving-leads/${id}/notes`, { text: noteText, author: user?.name || 'User' }),
    onSuccess: () => { invalidate(); setNoteText('') },
  })

  const deleteNoteMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-leads/${id}/notes/${idx}`),
    onSuccess: invalidate,
  })

  const convertMut = useMutation({
    mutationFn: () => api.post(`/moving-leads/${id}/convert`, {}).then(r => r.data),
    onSuccess: (job) => navigate(`/moving/jobs/${job._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!lead) return <div className="p-8 text-muted-foreground">Lead not found</div>

  const transitions = STATUS_TRANSITIONS[lead.status] ?? []
  const name = lead.prospectName || lead.customer?.fullName || '—'
  const phone = lead.prospectPhone || lead.customer?.phone || '—'

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/moving/leads')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">{phone}</p>
        </div>
        <Badge tone={statusTone[lead.status]}>{lead.status}</Badge>
        {transitions.length > 0 && (
          <div className="flex gap-2">
            {transitions.map(s => (
              <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
                → {s}
              </Button>
            ))}
          </div>
        )}
        {lead.status !== 'won' && lead.status !== 'lost' && (
          <Button size="sm" onClick={() => convertMut.mutate()} disabled={convertMut.isPending}>
            {convertMut.isPending ? 'Converting…' : 'Convert to Job →'}
          </Button>
        )}
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Lead Info" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Source</dt><dd className="capitalize">{lead.source.replace('_', ' ')}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Move Date</dt><dd>{lead.moveDate ? formatDate(lead.moveDate) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Est. Volume</dt><dd>{lead.estimatedVolumeCbm ? `${lead.estimatedVolumeCbm} CBM` : '—'}</dd></div>
              {lead.customer && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd><Link to={`/customers/${lead.customer._id}`} className="text-primary hover:underline">{lead.customer.fullName}</Link></dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Addresses" />
          <CardBody>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup</p>
                <p>{lead.pickupAddress || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery</p>
                <p>{lead.deliveryAddress || '—'}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {lead.notes && (
        <Card>
          <CardHeader title="Notes" />
          <CardBody><p className="text-sm">{lead.notes}</p></CardBody>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader title="Follow-up Timeline" />
        <CardBody>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                placeholder="Add a note or follow-up…"
                className="flex-1"
              />
              <Button onClick={() => addNoteMut.mutate()} disabled={!noteText.trim() || addNoteMut.isPending} size="sm">
                Add
              </Button>
            </div>
            {(lead.timeline?.length ?? 0) === 0
              ? <p className="text-sm text-muted-foreground">No notes yet</p>
              : [...(lead.timeline ?? [])].reverse().map((n, ri) => {
                  const idx = (lead.timeline?.length ?? 0) - 1 - ri
                  return (
                    <div key={idx} className="flex gap-3 text-sm border-l-2 border-muted pl-3">
                      <div className="flex-1">
                        <p className="text-muted-foreground text-xs mb-1">
                          {new Date(n.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {n.author}
                        </p>
                        <p>{n.text}</p>
                      </div>
                      <button onClick={() => deleteNoteMut.mutate(idx)} className="text-muted-foreground hover:text-red-500 shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })
            }
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
