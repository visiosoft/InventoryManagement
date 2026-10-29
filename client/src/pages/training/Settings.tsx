import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Copy } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { type Me, INK, MUTED, LINE, PURPLE, btn, panel, caps, field, when } from './theme'

type Key = { id: string; label: string; last4: string; createdAt: string; revokedAt?: string }
type Member = { _id: string; userId: string; name: string; email: string; role: string }
type Feedback = { _id: string; source: string; question: string; aiReply: string; humanReply: string; note: string; createdAt: string }

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything', admin: 'Everything', trainer: 'Import, review, test', reviewer: 'Review and comment',
  approver: 'Approve, publish, test', analyst: 'Read only',
}

export default function Settings({ me }: { me: Me }) {
  const qc = useQueryClient()
  const manage = me.permissions.includes('manage')
  const [created, setCreated] = useState('')
  const [err, setErr] = useState('')
  const keys = useQuery<{ keys: Key[] }>({ queryKey: ['training-keys'], queryFn: () => api.get('/training/keys').then((r) => r.data), enabled: manage })
  const members = useQuery<{ members: Member[]; roles: string[] }>({ queryKey: ['training-members'], queryFn: () => api.get('/training/members').then((r) => r.data) })
  const users = useQuery<{ _id: string; name: string; email: string }[]>({ queryKey: ['training-users'], queryFn: () => api.get('/users').then((r) => (Array.isArray(r.data) ? r.data : r.data.users ?? [])), enabled: manage })
  const feedback = useQuery<{ feedback: Feedback[] }>({ queryKey: ['training-feedback'], queryFn: () => api.get('/training/feedback').then((r) => r.data) })
  const mk = useMutation({ mutationFn: (label: string) => api.post('/training/keys', { label }).then((r) => r.data), onSuccess: (d) => { setCreated(d.key); qc.invalidateQueries({ queryKey: ['training-keys'] }) }, onError: (e) => setErr(apiError(e)) })
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/training/keys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['training-keys'] }) })
  const setRole = useMutation({ mutationFn: (b: { userId: string; role: string }) => api.post('/training/members', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['training-members'] }), onError: (e) => setErr(apiError(e)) })
  const fb = useMutation({ mutationFn: (b: { id: string; status: string }) => api.patch(`/training/feedback/${b.id}`, { status: b.status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['training-feedback'] }) })
  const root = String(api.defaults.baseURL || '/api')
  const base = `${root.startsWith('http') ? '' : window.location.origin}${root.replace(/\/$/, '')}/training/v1`

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div style={{ ...panel, padding: 18 }}>
        <div style={caps}>Team</div>
        {members.data?.members.map((m) => (
          <div key={m._id} className="flex items-center gap-2" style={{ padding: '8px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
            <span className="min-w-0 flex-1 truncate"><b style={{ color: INK }}>{m.name}</b> <span style={{ color: MUTED }}>{m.email}</span></span>
            {manage ? (
              <select value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })} aria-label={`Role for ${m.name}`} style={{ ...field, width: 130, height: 30, padding: '0 6px' }}>
                {members.data.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : <span style={{ color: MUTED }}>{m.role}</span>}
          </div>
        ))}
        {manage && (
          <select value="" onChange={(e) => { if (e.target.value) setRole.mutate({ userId: e.target.value, role: 'reviewer' }) }} aria-label="Add a person" style={{ ...field, marginTop: 10 }}>
            <option value="">Add a person as reviewer…</option>
            {(users.data ?? []).filter((u) => !members.data?.members.some((m) => m.userId === u._id)).map((u) => <option key={u._id} value={u._id}>{u.name} · {u.email}</option>)}
          </select>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>{Object.entries(ROLE_HELP).map(([r, h]) => `${r}: ${h}`).join(' · ')}</div>
      </div>

      {manage && (
        <div style={{ ...panel, padding: 18 }}>
          <div className="flex items-center gap-2" style={caps}><KeyRound size={12} /> API keys — for agents running elsewhere</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '6px 0 10px' }}>An external chatbot can read the published answers, match a customer message to them, and send back feedback. Keys are stored hashed and can be revoked any time.</p>
          {keys.data?.keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2" style={{ padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
              <span className="flex-1"><b>{k.label}</b> <span style={{ color: MUTED }}>…{k.last4} · {when(k.createdAt)}</span></span>
              {k.revokedAt ? <span style={{ color: MUTED }}>revoked</span> : <button type="button" style={{ ...btn(false, true), height: 26, fontSize: 12 }} onClick={() => { if (window.confirm('Revoke this key? Anything using it stops working.')) revoke.mutate(k.id) }}>Revoke</button>}
            </div>
          ))}
          <button type="button" style={{ ...btn(true), marginTop: 10 }} onClick={() => { const l = window.prompt('What will use this key?', 'Website chatbot'); if (l) mk.mutate(l) }}>New key</button>
          {created && (
            <div style={{ background: '#FFF7E6', border: '1px solid #F5D896', borderRadius: 10, padding: 10, marginTop: 10, fontSize: 12 }}>
              Copy it now — it is not shown again.
              <div className="flex items-center gap-2" style={{ marginTop: 4 }}><code style={{ wordBreak: 'break-all', color: INK }}>{created}</code><button type="button" aria-label="Copy key" onClick={() => navigator.clipboard?.writeText(created)}><Copy size={14} /></button></div>
            </div>
          )}
          <pre style={{ fontSize: 11, background: '#14081F', color: '#E9E3FA', borderRadius: 10, padding: 12, marginTop: 12, overflowX: 'auto' }}>{`GET  ${base}/knowledge
POST ${base}/match     {"message": "how much is 50 sqft?"}
POST ${base}/feedback  {"question","aiReply","humanReply"}
Authorization: Bearer tq_…`}</pre>
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5 }}>{err}</div>}
        </div>
      )}

      <div style={{ ...panel, padding: 18 }} className="lg:col-span-2">
        <div style={caps}>Feedback from agents · {feedback.data?.feedback.length ?? 0} open</div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: '4px 0 8px' }}>Where a person replied differently from the AI, sent in by a connected agent. A person's reply is not assumed right — read it, and if it should become the answer, approve it in Review.</p>
        {feedback.data?.feedback.map((f) => (
          <div key={f._id} className="grid gap-3 md:grid-cols-3" style={{ padding: '10px 0', borderTop: `1px solid ${LINE}`, fontSize: 12.5 }}>
            <div><div style={caps}>Customer</div>{f.question}</div>
            <div><div style={caps}>AI</div><span style={{ color: MUTED }}>{f.aiReply || '—'}</span></div>
            <div><div style={caps}>Person</div>{f.humanReply || '—'}
              <div className="flex gap-2" style={{ marginTop: 6 }}><button type="button" style={{ ...btn(), height: 26, fontSize: 12 }} onClick={() => fb.mutate({ id: f._id, status: 'used' })}>Used</button><button type="button" style={{ ...btn(), height: 26, fontSize: 12, color: MUTED }} onClick={() => fb.mutate({ id: f._id, status: 'dismissed' })}>Dismiss</button></div>
            </div>
          </div>
        ))}
        {!feedback.data?.feedback.length && <div style={{ fontSize: 12.5, color: MUTED }}>Nothing open.</div>}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED }} className="lg:col-span-2">Organisation: <b style={{ color: PURPLE }}>{me.org.name}</b> · your role: {me.role}</div>
    </div>
  )
}
