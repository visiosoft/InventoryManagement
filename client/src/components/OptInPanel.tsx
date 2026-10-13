import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { Button, Card, CardBody, CardHeader } from './ui'

const MUTED = '#756E80'

/**
 * WhatsApp marketing needs a recorded opt-in per person, and nobody has one, so
 * the WhatsApp audience is empty until this is run. Offered as a deliberate,
 * previewed action rather than a default, because it is a judgement about your
 * customers to make once and knowingly.
 */
export function OptInPanel() {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<{ customers: number; leads: number } | null>(null)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  const dry = useMutation({
    mutationFn: () => api.post('/campaigns/opt-in/backfill?dry=1').then((r) => r.data),
    onSuccess: (d) => { setPreview({ customers: d.customers, leads: d.leads }); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const run = useMutation({
    mutationFn: () => api.post('/campaigns/opt-in/backfill').then((r) => r.data),
    onSuccess: (d) => {
      setDone(`${d.customers} tenants and ${d.leads} leads now opted in`)
      setPreview(null)
      qc.invalidateQueries()
    },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <Card>
      <CardHeader
        title="WhatsApp marketing opt-in"
        subtitle="Meta requires a recorded opt-in before a marketing template can be sent"
      />
      <CardBody className="space-y-2.5 text-[13px]">
        <p style={{ color: MUTED }}>
          Meta only allows marketing messages to people who agreed to receive them. You can record an
          opt-in for everyone who has messaged your business first — a defensible basis for consent, but
          a judgement about your customers, so it is yours to make.
        </p>
        {preview && (
          <p className="rounded-lg px-3 py-2" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF' }}>
            This would opt in <strong>{preview.customers}</strong> tenants and <strong>{preview.leads}</strong> leads.
            Nothing has changed yet.
          </p>
        )}
        {done && <p className="text-emerald-600 font-medium">{done}</p>}
        {err && <p className="text-destructive">{err}</p>}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => dry.mutate()} disabled={dry.isPending}>
            {dry.isPending ? 'Checking…' : 'Preview'}
          </Button>
          {preview && (preview.customers + preview.leads) > 0 && (
            <Button
              onClick={() => {
                if (!confirm(`Record a WhatsApp marketing opt-in for ${preview.customers + preview.leads} people who messaged you first?`)) return
                run.mutate()
              }}
              disabled={run.isPending}
            >
              {run.isPending ? 'Recording…' : 'Record opt-in'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

