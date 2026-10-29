import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { useSession } from '../lib/session'
import { INK, MUTED, LINE, btn, panel, caps, field, when } from './theme'
import { PageTitle } from './shared'

/* For whoever runs the platform: every customer organisation, their AI use,
   and the platform AI keys used by organisations without their own. */

type Data = {
  users: number
  platform: { provider: string; model: string; allowSignup: boolean; anthropicKey: string; openaiKey: string; defaults: Record<string, string> }
  orgs: { id: string; name: string; slug: string; plan: string; createdAt: string; ownKey: boolean; connected: boolean; live: number; members: number; answers: number; usage30d: { calls: number; input: number; output: number; platform: number } | null }[]
}

export default function Platform() {
  const qc = useQueryClient()
  const { setOrg } = useSession()
  const { data, error } = useQuery<Data>({ queryKey: ['platform'], queryFn: () => api.get('/platform').then((r) => r.data) })
  const [f, setF] = useState({ provider: '', model: '', anthropicKey: '', openaiKey: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/platform', body),
    onSuccess: () => { setMsg({ ok: true, text: 'Saved.' }); setF({ provider: '', model: '', anthropicKey: '', openaiKey: '' }); qc.invalidateQueries({ queryKey: ['platform'] }) },
    onError: (e) => setMsg({ ok: false, text: apiError(e) }),
  })
  if (error) return <div style={{ color: '#B91C1C' }}>{apiError(error)}</div>
  if (!data) return <div style={{ color: MUTED }}>Loading…</div>
  const p = data.platform
  return (
    <div>
      <PageTitle title="Platform" sub={`${data.orgs.length} organisations · ${data.users} people`} />
      <div style={{ ...panel, marginBottom: 16, overflowX: 'auto' }}>
        <table className="w-full" style={{ fontSize: 13, minWidth: 760 }}>
          <thead><tr style={{ color: MUTED, fontSize: 12, borderBottom: `1px solid ${LINE}` }}>
            {['Organisation', 'Plan', 'People', 'Answers', 'Live', 'AI calls (30d)', 'On platform key', 'Since', ''].map((h) => <th key={h} className="text-left font-medium" style={{ padding: '10px 12px' }}>{h}</th>)}
          </tr></thead>
          <tbody>{data.orgs.map((o) => (
            <tr key={o.id} style={{ borderBottom: `1px solid ${LINE}` }}>
              <td style={{ padding: '9px 12px' }}><b style={{ color: INK }}>{o.name}</b><div style={{ fontSize: 11.5, color: MUTED }}>{[o.ownKey && 'own AI key', o.connected && 'connected system'].filter(Boolean).join(' · ') || o.slug}</div></td>
              <td style={{ padding: '9px 12px' }}><select value={o.plan} onChange={(e) => api.patch(`/platform/orgs/${o.id}`, { plan: e.target.value }).then(() => qc.invalidateQueries({ queryKey: ['platform'] }))} style={{ ...field, height: 30, padding: '0 6px', width: 120 }}>{['pilot', 'starter', 'professional', 'enterprise'].map((x) => <option key={x}>{x}</option>)}</select></td>
              <td style={{ padding: '9px 12px' }}>{o.members}</td>
              <td style={{ padding: '9px 12px' }}>{o.answers}</td>
              <td style={{ padding: '9px 12px' }}>{o.live ? `v${o.live}` : '—'}</td>
              <td style={{ padding: '9px 12px' }}>{o.usage30d?.calls ?? 0}</td>
              <td style={{ padding: '9px 12px' }}>{o.usage30d?.platform ?? 0}</td>
              <td style={{ padding: '9px 12px', color: MUTED }}>{when(o.createdAt)}</td>
              <td style={{ padding: '9px 12px' }}><button type="button" style={{ ...btn(), height: 28 }} onClick={() => { setOrg(o.id); qc.clear(); window.location.assign('/') }}>Open</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div style={{ ...panel, padding: 20 }}>
        <div style={caps}>Platform AI key — used by organisations without their own</div>
        <div style={{ fontSize: 13, color: INK, margin: '8px 0 12px' }}>Now: <b>{p.provider}</b>{p.model ? ` · ${p.model}` : ` · ${p.defaults[p.provider]}`} · Anthropic key {p.anthropicKey || 'not set'} · OpenAI key {p.openaiKey || 'not set'}</div>
        <div className="grid gap-3 md:grid-cols-4">
          <select value={f.provider || p.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} aria-label="Provider" style={field}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
          <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder={`Model (${p.defaults[f.provider || p.provider]})`} aria-label="Model" style={field} />
          <input type="password" value={f.anthropicKey} onChange={(e) => setF({ ...f, anthropicKey: e.target.value })} placeholder="New Anthropic key" autoComplete="off" aria-label="Anthropic key" style={field} />
          <input type="password" value={f.openaiKey} onChange={(e) => setF({ ...f, openaiKey: e.target.value })} placeholder="New OpenAI key" autoComplete="off" aria-label="OpenAI key" style={field} />
        </div>
        <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 12 }}>
          <button type="button" style={btn(true)} disabled={save.isPending} onClick={() => save.mutate({ ...(f.provider ? { provider: f.provider } : {}), ...(f.model ? { model: f.model } : {}), ...(f.anthropicKey ? { anthropicKey: f.anthropicKey } : {}), ...(f.openaiKey ? { openaiKey: f.openaiKey } : {}) })}>{save.isPending ? 'Checking…' : 'Save'}</button>
          <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input type="checkbox" checked={p.allowSignup} onChange={(e) => save.mutate({ allowSignup: e.target.checked })} /> Anyone can sign up (off: by invitation only)</label>
        </div>
        {msg && <div style={{ fontSize: 13, color: msg.ok ? '#166534' : '#B91C1C', marginTop: 8 }}>{msg.text}</div>}
      </div>
    </div>
  )
}
