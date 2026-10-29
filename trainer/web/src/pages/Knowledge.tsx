import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Rocket, RotateCcw, Search, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type KRecord, type Me, INK, MUTED, PURPLE, LINE, TINT, HEAD, btn, panel, caps, field, when } from './theme'
import { Pill } from './shared'

/* The approved answer library: every answer the business stands behind, with
   its versions, and the publishing that puts a set of them in front of the
   agents. Nothing reaches an agent until it is published. */

type Snap = { version: number; count: number; note?: string; publishedBy?: { name: string }; createdAt: string; conflicts?: unknown[] }
type Conflict = { a: string; b: string; kind: string; note: string }

export default function Knowledge({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<KRecord | null>(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const recs = useQuery<{ records: KRecord[] }>({ queryKey: ['training-knowledge'], queryFn: () => api.get('/training/knowledge').then((r) => r.data) })
  const snaps = useQuery<{ active: number; snapshots: Snap[] }>({ queryKey: ['training-snapshots'], queryFn: () => api.get('/training/snapshots').then((r) => r.data) })
  const conf = useQuery<{ conflicts: Conflict[] }>({ queryKey: ['training-conflicts'], queryFn: () => api.get('/training/conflicts').then((r) => r.data) })
  const vars = useQuery<{ values: Record<string, string> }>({ queryKey: ['training-variables'], queryFn: () => api.get('/training/variables').then((r) => r.data) })
  const refresh = () => ['training-knowledge', 'training-snapshots', 'training-conflicts', 'training-overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const publish = useMutation({
    mutationFn: (force: boolean) => api.post('/training/publish', { note, force }).then((r) => r.data),
    onSuccess: (d) => { setMsg({ ok: true, text: `Published version ${d.version}: ${d.count} answers are live for the agents.` }); setNote(''); refresh() },
    onError: (e) => setMsg({ ok: false, text: apiError(e) }),
  })
  const rollback = useMutation({
    mutationFn: (version: number) => api.post('/training/rollback', { version }).then((r) => r.data),
    onSuccess: (d) => { setMsg({ ok: true, text: `Version ${d.version} is live again.` }); refresh() },
    onError: (e) => setMsg({ ok: false, text: apiError(e) }),
  })
  const canPublish = me.permissions.includes('publish')
  const byId = useMemo(() => new Map((recs.data?.records ?? []).map((r) => [r._id, r])), [recs.data])
  const shown = (recs.data?.records ?? []).filter((r) => !q.trim() || `${r.question} ${r.answer} ${r.category}`.toLowerCase().includes(q.trim().toLowerCase()))
  const pending = (recs.data?.records ?? []).filter((r) => r.status === 'approved').length
  const conflicts = conf.data?.conflicts ?? []

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div style={panel}>
        <div className="flex items-center gap-2" style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
          <span style={caps}>Approved answers · {recs.data?.records.length ?? 0}</span>
          <div className="relative" style={{ marginLeft: 'auto', width: 240 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: MUTED }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search answers" aria-label="Search answers" style={{ ...field, height: 32, paddingLeft: 30 }} />
          </div>
        </div>
        {!shown.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>No approved answers yet. Approve some in Review.</div>}
        {shown.map((r) => (
          <button key={r._id} type="button" onClick={() => setOpen(r)} className="block w-full text-left" style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ fontWeight: 700, color: INK, fontSize: 13.5 }}>{r.question}</span>
              <Pill status={r.status} />{r.escalate && <Pill status="escalated" />}
              <span style={{ fontSize: 11.5, color: MUTED, marginLeft: 'auto' }}>{r.category} · v{r.version}</span>
            </div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }} className="line-clamp-2">{r.answer}</div>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div style={{ ...panel, padding: 16 }}>
          <div style={caps}>Live for the agents</div>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 26, color: INK }}>{snaps.data?.active ? `Version ${snaps.data.active}` : 'Nothing published'}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{pending} approved answer{pending === 1 ? '' : 's'} waiting to be published</div>
          {conflicts.length > 0 && (
            <div style={{ background: '#FFF7E6', border: '1px solid #F5D896', borderRadius: 10, padding: 10, marginTop: 10, fontSize: 12.5, color: '#8A5A00' }}>
              <div className="flex items-center gap-1" style={{ fontWeight: 700 }}><AlertTriangle size={13} /> {conflicts.length} possible conflict{conflicts.length === 1 ? '' : 's'}</div>
              {conflicts.slice(0, 5).map((c, i) => <div key={i} style={{ marginTop: 4 }}>{c.note} — <button type="button" style={{ textDecoration: 'underline' }} onClick={() => setOpen(byId.get(c.a) ?? null)}>open</button></div>)}
            </div>
          )}
          {canPublish && (<>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed (optional)" aria-label="Publish note" style={{ ...field, marginTop: 10 }} />
            <button type="button" style={{ ...btn(true), marginTop: 8, width: '100%', justifyContent: 'center' }} disabled={publish.isPending || !pending}
              onClick={() => { if (!conflicts.length || window.confirm(`There ${conflicts.length === 1 ? 'is 1 possible conflict' : `are ${conflicts.length} possible conflicts`}. Publish anyway?`)) publish.mutate(conflicts.length > 0) }}>
              <Rocket size={14} /> Publish {pending} answer{pending === 1 ? '' : 's'}
            </button>
          </>)}
          {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? '#166534' : '#B91C1C' }}>{msg.text}</div>}
        </div>

        <div style={{ ...panel, padding: 16 }}>
          <div style={caps}>Published versions</div>
          {(snaps.data?.snapshots ?? []).map((s) => (
            <div key={s.version} className="flex items-center gap-2" style={{ padding: '7px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
              <span style={{ fontWeight: 700, color: s.version === snaps.data?.active ? PURPLE : INK }}>v{s.version}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: MUTED }}>{s.count} answers · {s.publishedBy?.name} · {when(s.createdAt)}{s.note ? ` · ${s.note}` : ''}</span>
              {s.version === snaps.data?.active ? <Pill status="published">Live</Pill>
                : canPublish && <button type="button" style={{ ...btn(), height: 26, fontSize: 12 }} onClick={() => { if (window.confirm(`Make version ${s.version} live again?`)) rollback.mutate(s.version) }}><RotateCcw size={12} /> Roll back</button>}
            </div>
          ))}
          {!snaps.data?.snapshots.length && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>None yet.</div>}
        </div>

        <div style={{ ...panel, padding: 16 }}>
          <div style={caps}>Live values for {'{variables}'}</div>
          <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 8px' }}>Write these in an answer and agents fill in today's value, so prices never go stale.</p>
          {Object.entries(vars.data?.values ?? {}).map(([k, v]) => <div key={k} className="flex gap-2" style={{ fontSize: 12, padding: '3px 0' }}><code style={{ color: PURPLE }}>{`{${k}}`}</code><span className="truncate" style={{ color: MUTED }}>{v}</span></div>)}
        </div>
      </div>

      {open && <RecordPanel rec={open} me={me} onClose={() => setOpen(null)} onSaved={() => { refresh(); setOpen(null) }} />}
    </div>
  )
}

function RecordPanel({ rec, me, onClose, onSaved }: { rec: KRecord; me: Me; onClose: () => void; onSaved: () => void }) {
  const [answer, setAnswer] = useState(rec.answer)
  const [question, setQuestion] = useState(rec.question)
  const [followUp, setFollowUp] = useState(rec.followUp || '')
  const [expires, setExpires] = useState(rec.expiresAt ? rec.expiresAt.slice(0, 10) : '')
  const [err, setErr] = useState('')
  const save = useMutation({ mutationFn: () => api.patch(`/training/knowledge/${rec._id}`, { answer, question, followUp, expiresAt: expires || null }), onSuccess: onSaved, onError: (e) => setErr(apiError(e)) })
  const archive = useMutation({ mutationFn: () => api.post(`/training/knowledge/${rec._id}/archive`), onSuccess: onSaved })
  const can = me.permissions.includes('approve')
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,8,31,.25)' }} onClick={onClose}>
      <div className="h-full w-full overflow-y-auto" style={{ maxWidth: 560, background: '#fff', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><span style={caps}>{rec.category} · v{rec.version}</span><Pill status={rec.status} /><button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}><X size={18} /></button></div>
        <label style={{ ...caps, display: 'block', marginTop: 14 }}>Question<input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!can} style={{ ...field, marginTop: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }} /></label>
        <label style={{ ...caps, display: 'block', marginTop: 12 }}>Answer<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={6} disabled={!can} style={{ ...field, marginTop: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 500, lineHeight: 1.5 }} /></label>
        <label style={{ ...caps, display: 'block', marginTop: 12 }}>Then ask<input value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={!can} style={{ ...field, marginTop: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }} /></label>
        <label style={{ ...caps, display: 'block', marginTop: 12 }}>Expires on (optional)<input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={!can} style={{ ...field, marginTop: 4 }} /></label>
        {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        {can && <div className="flex gap-2" style={{ marginTop: 14 }}>
          <button type="button" style={btn(true)} disabled={save.isPending} onClick={() => save.mutate()}>Save as v{rec.version + 1}</button>
          <button type="button" style={btn(false, true)} onClick={() => { if (window.confirm('Archive this answer? It leaves the next published version.')) archive.mutate() }}>Archive</button>
        </div>}
        <div style={{ ...caps, marginTop: 20 }}>Customers also ask</div>
        {rec.variations.slice(0, 12).map((v, i) => <div key={i} style={{ fontSize: 12.5, color: MUTED, padding: '3px 0' }} dir="auto">{v}</div>)}
        <div style={{ ...caps, marginTop: 20 }}>Version history</div>
        {[...rec.versions].reverse().filter((v) => v.note !== 'previous').map((v, i) => (
          <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
            <div style={{ color: MUTED }}>v{v.version} · {v.by?.name} · {when(v.at)}{v.note ? ` · ${v.note}` : ''}</div>
            <div style={{ color: INK, whiteSpace: 'pre-wrap' }}>{v.answer}</div>
            {v.original && <div style={{ color: MUTED, background: TINT, borderRadius: 8, padding: 8, marginTop: 4, whiteSpace: 'pre-wrap' }}>Before: {v.original}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
