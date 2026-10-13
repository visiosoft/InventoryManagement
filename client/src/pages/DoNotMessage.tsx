import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader, Field, Input } from '../components/ui'

const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.10)'

type Row = { _id: string; phone: string; phoneKey: string; label: string; reason: string; addedByName: string; createdAt: string }

/** Numbers that never get a campaign message, whoever picks them. */
export default function DoNotMessage() {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  const { data } = useQuery<Row[]>({ queryKey: ['do-not-message'], queryFn: () => api.get('/campaigns/do-not-message').then((r) => r.data) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['do-not-message'] }); qc.invalidateQueries({ queryKey: ['studio-people'] }) }

  const add = useMutation({
    mutationFn: () => api.post('/campaigns/do-not-message', { phone, label, reason }),
    onSuccess: () => { setPhone(''); setLabel(''); setReason(''); setErr(''); qc.invalidateQueries(); },
    onError: (e) => setErr(apiError(e)),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/campaigns/do-not-message/${id}`), onSuccess: refresh })

  return (
    <Card>
      <CardHeader
        title="Do not message"
        subtitle="Numbers listed here are left out of every campaign, even if someone selects them. Normal WhatsApp chats with them are not affected."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="w-52"><Field label="Phone number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" /></Field></div>
          <div className="w-44"><Field label="Whose number (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Test phone" /></Field></div>
          <div className="w-56"><Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. asked us to stop" /></Field></div>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !phone.trim()}><Plus size={13} /> Add number</Button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}

        {(data ?? []).length === 0
          ? <p className="text-sm" style={{ color: MUTED }}>No numbers on the list yet.</p>
          : (
            <div className="space-y-2">
              {(data ?? []).map((r) => (
                <div key={r._id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border: `1px solid ${LINE}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{r.phone || `…${r.phoneKey}`}{r.label ? ` · ${r.label}` : ''}</div>
                    <div className="text-xs" style={{ color: MUTED }}>
                      {r.reason ? `${r.reason} · ` : ''}added by {r.addedByName || 'someone'} on {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => { if (confirm('Allow campaign messages to this number again?')) remove.mutate(r._id) }}><Trash2 size={13} /> Remove</Button>
                </div>
              ))}
            </div>
          )}
      </CardBody>
    </Card>
  )
}
