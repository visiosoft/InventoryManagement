import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink } from 'lucide-react'
import { api, apiError } from '../lib/api'

/* PurpleBox as a customer of the AI Training Center (a separate product at
   train.purplebox.ae). Two things connect them: a token the Training Center
   uses to read this CRM's conversations and prices and to test Aisha, and a
   Training Center API key Aisha uses to read the approved answers. */

type State = { connectorToken: string; trainerKey: string; trainerUrl: string }

export default function TrainingCenterCard() {
  const qc = useQueryClient()
  const { data } = useQuery<State>({ queryKey: ['training-settings'], queryFn: () => api.get('/training-settings').then((r) => r.data) })
  const [made, setMade] = useState<{ token: string; url: string } | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const gen = useMutation({ mutationFn: () => api.post('/training-settings/connector-token').then((r) => r.data), onSuccess: (d) => { setMade(d); qc.invalidateQueries({ queryKey: ['training-settings'] }) } })
  const saveKey = useMutation({ mutationFn: () => api.post('/training-settings/trainer-key', { key }), onSuccess: () => { setKey(''); setMsg({ ok: true, text: 'Saved — Aisha uses the published answers from her next reply.' }); qc.invalidateQueries({ queryKey: ['training-settings'] }) }, onError: (e) => setMsg({ ok: false, text: apiError(e) }) })
  return (
    <div className="rounded-lg border px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">AI Training Center</div>
          <div className="text-xs text-muted-foreground">Teach Aisha from real conversations — a separate product; PurpleBox is one of its organisations.</div>
        </div>
        <a href="https://train.purplebox.ae" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: '#4A1FA0' }}>Open <ExternalLink size={12} /></a>
      </div>
      <div className="text-sm">
        <div className="font-medium">1. Let the Training Center read this CRM</div>
        <div className="text-xs text-muted-foreground">In the Training Center: Settings → Connected system. Paste the address and token.{data?.connectorToken ? ` A token is set (${data.connectorToken}); making a new one replaces it.` : ''}</div>
        <button type="button" onClick={() => gen.mutate()} disabled={gen.isPending} className="mt-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/50">{data?.connectorToken ? 'New token' : 'Make a token'}</button>
        {made && (
          <div className="mt-2 rounded-md p-2 text-xs" style={{ background: '#FFF7E6', border: '1px solid #F5D896' }}>
            Copy these now — the token is not shown again.
            <div className="mt-1">Address: <code>{made.url}</code></div>
            <div className="flex items-center gap-2">Token: <code className="break-all">{made.token}</code><button type="button" aria-label="Copy token" onClick={() => navigator.clipboard?.writeText(made.token)}><Copy size={12} /></button></div>
          </div>
        )}
      </div>
      <div className="text-sm">
        <div className="font-medium">2. Let Aisha read the approved answers</div>
        <div className="text-xs text-muted-foreground">In the Training Center: Settings → API → New key. Paste it here.{data?.trainerKey ? ` Saved: ${data.trainerKey}.` : ''}</div>
        <div className="mt-2 flex gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="tq_…" aria-label="Training Center API key" className="flex-1 rounded-md border px-2 py-1.5 text-xs" />
          <button type="button" onClick={() => saveKey.mutate()} disabled={!key || saveKey.isPending} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/50">Save</button>
        </div>
        {msg && <div className="mt-1 text-xs" style={{ color: msg.ok ? '#166534' : '#B91C1C' }}>{msg.text}</div>}
      </div>
    </div>
  )
}
