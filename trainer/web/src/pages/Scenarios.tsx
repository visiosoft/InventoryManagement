import { useState, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Wand2, Check, Archive, Play, X, Rocket } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, ACCENT, LINE, TINT, btn, panel, caps, field } from './theme'
import { Pill, PageTitle } from './shared'
import { type PlaybookResp, type Scenario, type Msg, labelOf } from './sales'

/* The scenario library (Specification §13, §15, §23): the situations the
   agent must handle, each with the right next action and the reply the
   business approved. Approved scenarios are the regression suite. */

type Coverage = { key: string; label: string; min: number; approved: number; draft: number }
const OUTCOMES = [['', '—'], ['visit', 'Visit'], ['booking', 'Booking'], ['follow_up', 'Follow-up'], ['escalation', 'Escalation'], ['lost', 'Lost'], ['ghosted', 'Ghosted']] as const

export default function Scenarios() {
  const { me } = useOutletContext<{ me: Me }>()
  const qc = useQueryClient()
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const pb = useQuery<PlaybookResp>({ queryKey: ['playbook', me.org.id], queryFn: () => api.get('/sales/playbook').then((r) => r.data) })
  const list = useQuery<{ scenarios: Scenario[]; coverage: Coverage[] }>({
    queryKey: ['scenarios', me.org.id, group, status, q],
    queryFn: () => api.get('/sales/scenarios', { params: { group: group || undefined, status: status || undefined, q: q || undefined } }).then((r) => r.data),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['scenarios', me.org.id] })
  const seed = useMutation({ mutationFn: () => api.post('/sales/scenarios/seed'), onSuccess: (r) => { setMsg(`${r.data.seeded} starter scenarios added as drafts.`); refresh() }, onError: (e) => setMsg(apiError(e)) })
  const gen = useMutation({ mutationFn: (g: string) => api.post('/sales/scenarios/generate', { group: g, count: 8 }), onSuccess: (r) => { setMsg(`${r.data.created} new drafts written. Check and approve them.`); refresh() }, onError: (e) => setMsg(apiError(e)) })
  const publish = useMutation({
    mutationFn: () => api.post('/training/publish', { note: 'From Scenarios' }).then((r) => r.data),
    onSuccess: (d) => setMsg(`Published version ${d.version}: ${d.examples ?? 0} approved examples and ${d.count} answers are live for your agent.`),
    onError: (e) => setMsg(apiError(e)),
  })
  const add = useMutation({ mutationFn: () => api.post('/sales/scenarios', { message: 'New customer message', group: group || undefined }), onSuccess: (r) => { refresh(); setOpen(r.data.scenario._id) }, onError: (e) => setMsg(apiError(e)) })
  const p = pb.data?.playbook
  const cov = list.data?.coverage ?? []
  const totalApproved = cov.reduce((s, c) => s + c.approved, 0)
  const target = cov.reduce((s, c) => s + c.min, 0)

  return (
    <div>
      <PageTitle title="Scenarios" sub={<>The situations your agent must get right. Approved ones are retested on every change. <b style={{ color: INK }}>{totalApproved}</b> approved of the <b style={{ color: INK }}>{target}</b> the matrix asks for.</>} action={
        <div className="flex flex-wrap gap-2">
          {(pb.data?.templates.find((t) => t.key === p?.template)?.starters ?? 0) > 0 && me.permissions.includes('manage') && <button type="button" style={btn()} disabled={seed.isPending} onClick={() => seed.mutate()}><Sparkles size={14} /> Add starter scenarios</button>}
          {me.permissions.includes('publish') && <button type="button" style={btn()} disabled={publish.isPending} title="Send every approved scenario and answer to your agent" onClick={() => { if (window.confirm('Publish all approved scenarios and answers to your agent? Your connected agent (Aisha) uses them from her next reply.')) publish.mutate() }}><Rocket size={14} /> Publish to agents</button>}
          {me.permissions.includes('review') && <button type="button" style={btn(true)} disabled={add.isPending} onClick={() => add.mutate()}><Plus size={14} /> New scenario</button>}
        </div>
      } />
      {!pb.data?.custom && <div style={{ ...panel, padding: 14, marginBottom: 14, fontSize: 13, color: MUTED }}>Using the general customer-service playbook. Choose a sales playbook in <Link to="/settings?tab=playbook" style={{ color: ACCENT, fontWeight: 700 }}>Settings → Playbook</Link> for states, next actions and the full scorecard.</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" style={{ marginBottom: 14 }}>
        {cov.map((c) => {
          const pct = c.min ? Math.min(100, Math.round((c.approved / c.min) * 100)) : 100
          return (
            <div key={c.key} role="button" tabIndex={0} onClick={() => setGroup(group === c.key ? '' : c.key)} onKeyDown={(e) => e.key === 'Enter' && setGroup(group === c.key ? '' : c.key)}
              style={{ ...panel, padding: 12, cursor: 'pointer', outline: group === c.key ? `2px solid ${ACCENT}` : 'none' }}>
              <div className="flex items-center justify-between"><span style={{ fontWeight: 700, color: INK, fontSize: 13.5 }}>{c.label}</span>
                {me.permissions.includes('review') && <button type="button" title={`Draft 8 more ${c.label} scenarios with AI`} aria-label={`Draft more ${c.label}`} disabled={gen.isPending} onClick={(e) => { e.stopPropagation(); gen.mutate(c.key) }} style={{ color: ACCENT }}><Wand2 size={14} /></button>}
              </div>
              <div style={{ fontSize: 12, color: MUTED, margin: '2px 0 6px' }}><b style={{ color: INK }}>{c.approved}</b> / {c.min} approved{c.draft ? ` · ${c.draft} drafts` : ''}</div>
              <div style={{ height: 5, borderRadius: 9, background: '#E2E8F0', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22C55E' : ACCENT }} /></div>
            </div>
          )
        })}
      </div>
      {gen.isPending && <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Writing scenarios…</div>}
      {msg && <div style={{ fontSize: 13, color: INK, marginBottom: 8 }}>{msg}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div style={panel}>
          <div className="flex flex-wrap gap-2" style={{ padding: 12, borderBottom: `1px solid ${LINE}` }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search scenarios" style={{ ...field, width: 200 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ ...field, width: 140 }}><option value="">Draft + approved</option><option value="draft">Drafts</option><option value="approved">Approved</option><option value="archived">Archived</option></select>
            {group && <button type="button" style={{ ...btn(), height: 36 }} onClick={() => setGroup('')}>{labelOf(p?.groups, group)} <X size={13} /></button>}
          </div>
          {!list.data?.scenarios.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>No scenarios here yet.</div>}
          {list.data?.scenarios.map((s) => (
            <button key={s._id} type="button" onClick={() => setOpen(s._id)} className="block w-full text-left" style={{ padding: '10px 16px', borderBottom: `1px solid ${LINE}`, background: open === s._id ? TINT : 'transparent' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span style={{ fontWeight: 600, color: INK, fontSize: 13.5 }}>{s.title}</span>
                <Pill status={s.status} />
                {s.source === 'correction' && <Pill status="suggested">Correction</Pill>}
                {s.mustEscalate && <Pill status="escalated">Hand over</Pill>}
                {s.factual && <span style={{ fontSize: 11.5, color: MUTED }}>factual</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>{labelOf(p?.groups, s.group)}</span>
              </div>
              <div dir="auto" className="truncate" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>“{s.message}” → {s.nba.map((k) => labelOf(p?.actions, k)).join(' / ') || 'no action set'}</div>
            </button>
          ))}
        </div>
        {open && <Editor key={open} id={open} me={me} pb={pb.data} onClose={() => setOpen(null)} onChange={refresh} />}
      </div>
    </div>
  )
}

/* A labelled field; a group of several controls is a div, so a click on its caption toggles nothing. */
const L = ({ t, group, children }: { t: string; group?: boolean; children: ReactNode }) => {
  const head = <div style={{ ...caps, marginBottom: 4 }}>{t}</div>
  return group ? <div role="group" aria-label={t} style={{ marginBottom: 10 }}>{head}{children}</div> : <label style={{ display: 'block', marginBottom: 10 }}>{head}{children}</label>
}

function Editor({ id, me, pb, onClose, onChange }: { id: string; me: Me; pb?: PlaybookResp; onClose: () => void; onChange: () => void }) {
  const one = useQuery<{ scenario: Scenario }>({ queryKey: ['scenario', id], queryFn: () => api.get(`/sales/scenarios/${id}`).then((r) => r.data) })
  return one.data ? <Form s={one.data.scenario} me={me} pb={pb} onClose={onClose} onChange={() => { onChange(); one.refetch() }} /> : <div style={{ ...panel, padding: 20, color: MUTED }}>Loading…</div>
}

function Form({ s, me, pb, onClose, onChange }: { s: Scenario; me: Me; pb?: PlaybookResp; onClose: () => void; onChange: () => void }) {
  const p = pb?.playbook
  const lead = Object.fromEntries(Object.entries(s.leadBefore ?? {}).map(([k, v]) => [k, typeof v === 'object' && v ? String((v as { value?: unknown }).value ?? '') : String(v ?? '')]))
  const [f, setF] = useState({ ...s, leadBefore: lead })
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const can = me.permissions.includes('review')
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v })
  const save = useMutation({ mutationFn: () => api.patch(`/sales/scenarios/${s._id}`, f), onSuccess: () => { setErr(''); setNote('Saved.'); onChange() }, onError: (e) => setErr(apiError(e)) })
  const approve = useMutation({ mutationFn: async () => { await api.patch(`/sales/scenarios/${s._id}`, f); return api.post(`/sales/scenarios/${s._id}/approve`) }, onSuccess: () => { setErr(''); setNote('Approved — it is now part of the test suite.'); onChange() }, onError: (e) => setErr(apiError(e)) })
  const archive = useMutation({ mutationFn: () => api.post(`/sales/scenarios/${s._id}/archive`), onSuccess: () => { onChange(); onClose() } })
  const draft = useMutation({ mutationFn: () => api.post(`/sales/scenarios/${s._id}/draft`).then((r) => r.data), onSuccess: (d) => { setF({ ...f, idealResponse: d.idealResponse, nba: f.nba.length ? f.nba : [d.nba].filter(Boolean), media: d.media ?? f.media }); setNote('Drafted by the playbook agent from your facts — check every word before approving.') }, onError: (e) => setErr(apiError(e)) })
  const toggle = (k: 'nba' | 'media', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v])

  return (
    <div style={{ ...panel, padding: 18, alignSelf: 'start' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <Pill status={s.status} /><span style={{ fontSize: 12, color: MUTED }}>{s.source}{s.approvedBy ? ` · approved by ${s.approvedBy.name}` : ''}</span>
        <div className="flex-1" />
        <Link to={`/sandbox?scenario=${s._id}`} style={{ ...btn(), height: 30 }}><Play size={13} /> Try in sandbox</Link>
        <button type="button" onClick={onClose} aria-label="Close" style={{ color: MUTED }}><X size={16} /></button>
      </div>
      <fieldset disabled={!can}>
        <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
          <L t="Title"><input value={f.title} onChange={(e) => set('title', e.target.value)} style={field} /></L>
          <L t="Group"><select value={f.group} onChange={(e) => set('group', e.target.value)} style={field}>{p?.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></L>
        </div>
        <L t="Conversation before (optional)" group>
          {f.context.map((m, i) => (
            <div key={i} className="flex gap-1.5" style={{ marginBottom: 4 }}>
              <select value={m.from} onChange={(e) => set('context', f.context.map((x, j) => (j === i ? { ...x, from: e.target.value as Msg['from'] } : x)))} style={{ ...field, width: 110 }} aria-label="Who"><option value="customer">Customer</option><option value="agent">Agent</option></select>
              <input value={m.text} onChange={(e) => set('context', f.context.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} style={field} dir="auto" aria-label="Message" />
              <button type="button" onClick={() => set('context', f.context.filter((_, j) => j !== i))} aria-label="Remove" style={{ color: MUTED }}><X size={14} /></button>
            </div>
          ))}
          <button type="button" style={{ ...btn(), height: 28 }} onClick={() => set('context', [...f.context, { from: f.context.at(-1)?.from === 'customer' ? 'agent' : 'customer', text: '' }])}>Add message</button>
        </L>
        <L t="Customer message"><textarea rows={2} value={f.message} onChange={(e) => set('message', e.target.value)} style={field} dir="auto" /></L>
        <L t="Lead state before" group>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {p?.fields.map((x) => <input key={x.key} value={f.leadBefore[x.key] ?? ''} onChange={(e) => set('leadBefore', { ...f.leadBefore, [x.key]: e.target.value })} placeholder={x.label} title={x.hint} aria-label={x.label} style={{ ...field, padding: '6px 9px', fontSize: 12.5 }} />)}
          </div>
        </L>
        <L t="What the customer wants (intent)"><input value={f.intent} onChange={(e) => set('intent', e.target.value)} style={field} /></L>
        <L t="Correct next action (any of)" group>
          <div className="flex flex-wrap gap-1.5">{p?.actions.map((a) => <button type="button" key={a.key} title={a.when} onClick={() => toggle('nba', a.key)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, border: `1px solid ${f.nba.includes(a.key) ? ACCENT : LINE}`, background: f.nba.includes(a.key) ? TINT : '#fff', color: f.nba.includes(a.key) ? ACCENT : INK, fontWeight: f.nba.includes(a.key) ? 700 : 500 }}>{a.label}</button>)}</div>
        </L>
        <L t="Ideal reply" group>
          <textarea rows={5} value={f.idealResponse} onChange={(e) => set('idealResponse', e.target.value)} style={field} dir="auto" placeholder="The reply your best salesperson would send" aria-label="Ideal reply" />
          <button type="button" style={{ ...btn(), height: 28, marginTop: 6 }} disabled={draft.isPending} onClick={() => draft.mutate()}><Wand2 size={13} /> {draft.isPending ? 'Drafting…' : 'Draft with AI'}</button>
        </L>
        {!!p?.media.length && <L t="Media to send" group><div className="flex flex-wrap gap-1.5">{p.media.map((m) => <button type="button" key={m.key} onClick={() => toggle('media', m.key)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, border: `1px solid ${f.media.includes(m.key) ? ACCENT : LINE}`, background: f.media.includes(m.key) ? TINT : '#fff', color: f.media.includes(m.key) ? ACCENT : INK }}>{m.label}</button>)}</div></L>}
        <div className="grid gap-2 sm:grid-cols-2">
          <L t="Weak reply (optional)"><textarea rows={3} value={f.badResponse} onChange={(e) => set('badResponse', e.target.value)} style={field} dir="auto" /></L>
          <L t="Why it is weak"><textarea rows={3} value={f.critique} onChange={(e) => set('critique', e.target.value)} style={field} /></L>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <L t="Outcome it should move toward"><select value={f.outcome} onChange={(e) => set('outcome', e.target.value)} style={field}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
          <L t="Commercial note"><input value={f.commercial} onChange={(e) => set('commercial', e.target.value)} placeholder="e.g. 75 sq ft, no discount" style={field} /></L>
        </div>
        <div className="flex flex-wrap gap-4" style={{ fontSize: 13, color: INK, margin: '4px 0 12px' }}>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.core} onChange={(e) => set('core', e.target.checked)} /> Core suite</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.factual} onChange={(e) => set('factual', e.target.checked)} /> Factual (price, availability, policy, promotion)</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.mustEscalate} onChange={(e) => set('mustEscalate', e.target.checked)} /> Must hand to a person</label>
        </div>
      </fieldset>
      {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ color: '#166534', fontSize: 12.5, marginBottom: 8 }}>{note}</div>}
      {can && (
        <div className="flex flex-wrap gap-2">
          <button type="button" style={btn()} disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
          {me.permissions.includes('approve') && <button type="button" style={btn(true)} disabled={approve.isPending} onClick={() => approve.mutate()}><Check size={14} /> {s.status === 'approved' ? 'Save approved' : 'Approve'}</button>}
          <div className="flex-1" />
          <button type="button" style={btn(false, true)} onClick={() => archive.mutate()}><Archive size={14} /> Archive</button>
        </div>
      )}
    </div>
  )
}
