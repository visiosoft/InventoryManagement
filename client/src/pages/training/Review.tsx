import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CornerUpRight, Loader2, Pencil, RefreshCw, Search, X, Plus, AlertTriangle, MessageSquare } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { type Cluster, type KRecord, type Me, type Question, INK, MUTED, PURPLE, LINE, TINT, HEAD, btn, panel, caps, field, when } from './theme'
import { Pill, Kbd } from './shared'

/* Review: the place a team reads what customers ask and decides what the AI
   should say. Built for going through hundreds quickly — the keyboard does
   everything, the next intent opens as soon as one is decided. */

type Detail = { cluster: Cluster; questions: Question[]; record: KRecord | null; preview: { text: string; missing: string[] } | null }
const FILTERS = [
  { key: 'todo', label: 'To review', match: (c: Cluster) => c.status === 'new' || c.status === 'suggested' },
  { key: 'approved', label: 'Approved', match: (c: Cluster) => c.status === 'approved' },
  { key: 'escalated', label: 'To a person', match: (c: Cluster) => c.status === 'escalated' },
  { key: 'rejected', label: 'Rejected', match: (c: Cluster) => c.status === 'rejected' },
  { key: 'all', label: 'All', match: () => true },
]

export default function Review({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('todo')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const canApprove = me.permissions.includes('approve')

  const list = useQuery<{ clusters: Cluster[] }>({ queryKey: ['training-clusters'], queryFn: () => api.get('/training/clusters').then((r) => r.data), refetchInterval: 20_000 })
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    const needle = q.trim().toLowerCase()
    return (list.data?.clusters ?? []).filter((c) => f.match(c) && (!category || c.category === category) && (!needle || `${c.name} ${c.question}`.toLowerCase().includes(needle)))
  }, [list.data, filter, category, q])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (list.data?.clusters ?? []).filter(f.match).length])), [list.data])
  const current = selected && shown.some((c) => c._id === selected) ? selected : shown[0]?._id ?? null
  const idx = shown.findIndex((c) => c._id === current)
  const go = (d: number) => { const n = shown[Math.max(0, Math.min(shown.length - 1, idx + d))]; if (n) setSelected(n._id) }
  const eligible = shown.filter((c) => c.bulkEligible)

  const bulk = useMutation({
    mutationFn: () => api.post('/training/clusters/bulk-approve', { ids: eligible.map((c) => c._id) }).then((r) => r.data as { approved: number; skipped: number }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-clusters'] }),
  })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} style={{ ...btn(filter === f.key), height: 32 }}>{f.label} <span style={{ opacity: 0.7 }}>{counts[f.key] ?? 0}</span></button>
        ))}
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={{ ...field, width: 190, height: 32, padding: '0 8px' }}>
          <option value="">All categories</option>
          {me.org.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative" style={{ flex: '1 1 180px', maxWidth: 280 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: MUTED }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions" aria-label="Search intents" style={{ ...field, height: 32, paddingLeft: 30 }} />
        </div>
        {canApprove && filter === 'todo' && eligible.length > 0 && (
          <button type="button" style={{ ...btn(), marginLeft: 'auto' }} disabled={bulk.isPending}
            onClick={() => { if (window.confirm(`Approve ${eligible.length} low-risk answer${eligible.length === 1 ? '' : 's'} as suggested? Complaints, billing, contracts, discounts and anything missing data are left for you to read.`)) bulk.mutate() }}>
            <Check size={14} /> Approve {eligible.length} low-risk
          </button>
        )}
      </div>
      {bulk.data && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8 }}>{bulk.data.approved} approved{bulk.data.skipped ? `, ${bulk.data.skipped} left for review` : ''}.</div>}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div style={{ ...panel, maxHeight: 720, overflowY: 'auto' }} aria-label="Intents">
          {list.isLoading && <div style={{ padding: 20, color: MUTED }}>Loading…</div>}
          {!list.isLoading && !shown.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5, textAlign: 'center' }}>{(list.data?.clusters.length ?? 0) ? 'Nothing here.' : 'No questions yet. Import conversations first.'}</div>}
          {shown.map((c) => (
            <button key={c._id} type="button" onClick={() => setSelected(c._id)} aria-label={`Open ${c.name}`}
              className="flex w-full items-start gap-3 text-left" style={{ padding: '11px 14px', borderBottom: `1px solid ${LINE}`, background: c._id === current ? TINT : '#fff', borderLeft: `3px solid ${c._id === current ? PURPLE : 'transparent'}` }}>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontWeight: 700, fontSize: 13.5, color: INK }}>{c.name}</div>
                <div className="truncate" style={{ fontSize: 12, color: MUTED }}>{c.question}</div>
                <div className="flex items-center gap-2" style={{ marginTop: 4 }}><Pill status={c.status} /><span style={{ fontSize: 11.5, color: MUTED }}>{c.category}</span></div>
              </div>
              <span title="Times asked" style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 15, color: INK }}>{c.count}</span>
            </button>
          ))}
        </div>
        {current ? <Pane key={current} id={current} me={me} clusters={list.data?.clusters ?? []} onNext={() => go(1)} onPrev={() => go(-1)} /> : <div style={{ ...panel, padding: 30, color: MUTED }}>Pick a question on the left.</div>}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10 }}>
        Keys: <Kbd>J</Kbd>/<Kbd>K</Kbd> next/previous · <Kbd>A</Kbd> approve · <Kbd>E</Kbd> edit · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> save edit · <Kbd>N</Kbd> save as new answer · <Kbd>R</Kbd> reject · <Kbd>X</Kbd> to a person
      </div>
    </div>
  )
}

function Pane({ id, me, clusters, onNext, onPrev }: { id: string; me: Me; clusters: Cluster[]; onNext: () => void; onPrev: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<Detail>({ queryKey: ['training-cluster', id], queryFn: () => api.get(`/training/clusters/${id}`).then((r) => r.data) })
  const c = data?.cluster
  const start = data?.record?.answer ?? c?.suggestion?.text ?? ''
  const [text, setText] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const box = useRef<HTMLTextAreaElement>(null)
  const draft = text ?? start
  const changed = text != null && text.trim() !== start.trim()
  const canApprove = me.permissions.includes('approve')

  const refresh = () => { qc.invalidateQueries({ queryKey: ['training-clusters'] }); qc.invalidateQueries({ queryKey: ['training-cluster', id] }); qc.invalidateQueries({ queryKey: ['training-overview'] }) }
  const act = useMutation({
    mutationFn: (body: { action: string; text?: string; followUp?: string; note?: string }) => api.post(`/training/clusters/${id}/review`, body).then((r) => r.data),
    onSuccess: (_d, v) => { setErr(''); refresh(); if (v.action !== 'comment') onNext() },
    onError: (e) => setErr(apiError(e)),
  })
  const regen = useMutation({ mutationFn: () => api.post(`/training/clusters/${id}/suggest`), onSuccess: () => { setText(null); refresh() }, onError: (e) => setErr(apiError(e)) })
  const patch = useMutation({ mutationFn: (body: Record<string, string>) => api.patch(`/training/clusters/${id}`, body), onSuccess: refresh })
  const merge = useMutation({ mutationFn: (into: string) => api.post(`/training/clusters/${id}/merge`, { into }), onSuccess: refresh, onError: (e) => setErr(apiError(e)) })
  const split = useMutation({ mutationFn: (name: string) => api.post(`/training/clusters/${id}/split`, { questionIds: [...picked], name }), onSuccess: () => { setPicked(new Set()); refresh() }, onError: (e) => setErr(apiError(e)) })

  // On an intent already approved the box shows that answer: unchanged there is
  // nothing to approve (move on); changed, it is saved as its next version.
  const approve = () => {
    if (changed || (data?.record && followUp != null)) act.mutate({ action: 'edit', text: draft, followUp: followUp ?? undefined, note })
    else if (data?.record) onNext()
    else act.mutate({ action: 'approve', followUp: followUp ?? undefined, note })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canApprove) { e.preventDefault(); if (draft.trim()) approve(); return }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || act.isPending) return
      const k = e.key.toLowerCase()
      if (k === 'j') onNext()
      else if (k === 'k') onPrev()
      else if (k === 'e') { e.preventDefault(); box.current?.focus() }
      else if (!canApprove) return
      else if (k === 'a' && draft.trim()) approve()
      else if (k === 'n' && draft.trim()) act.mutate({ action: 'save_new', text: draft, note })
      else if (k === 'r') act.mutate({ action: 'reject', note })
      else if (k === 'x') act.mutate({ action: 'escalate', note })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (isLoading || !c) return <div style={{ ...panel, padding: 30, color: MUTED }}><Loader2 size={16} className="animate-spin" /></div>
  const variations = data!.questions
  const versions = data!.record?.versions ?? []
  const lastEdit = [...versions].reverse().find((v) => v.original)

  return (
    <div style={{ ...panel, padding: 0 }}>
      <div className="relative flex flex-wrap items-start gap-3" style={{ padding: '16px 18px', borderBottom: `1px solid ${LINE}` }}>
        <div className="min-w-0 flex-1">
          <div style={caps}>{c.category} · asked {c.count} time{c.count === 1 ? '' : 's'}{c.languages?.length ? ` · ${c.languages.join(', ')}` : ''}</div>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 19, color: INK, marginTop: 2 }}>{c.question}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>Intent: {c.name}</div>
        </div>
        <Pill status={c.status} />
        <details style={{ fontSize: 12.5 }}>
          <summary style={{ cursor: 'pointer', color: PURPLE, fontWeight: 700 }}>Organise</summary>
          <div className="space-y-2" style={{ position: 'absolute', right: 30, zIndex: 5, ...panel, padding: 12, width: 280, marginTop: 6 }}>
            <button type="button" style={btn()} onClick={() => { const n = window.prompt('Intent name', c.name); if (n) patch.mutate({ name: n }) }}>Rename</button>
            <button type="button" style={btn()} onClick={() => { const n = window.prompt('The question as customers ask it', c.question); if (n) patch.mutate({ question: n }) }}>Edit question</button>
            <select aria-label="Move to category" value={c.category} onChange={(e) => patch.mutate({ category: e.target.value })} style={field}>
              {me.org.categories.map((x) => <option key={x}>{x}</option>)}
            </select>
            <select aria-label="Merge into" value="" onChange={(e) => { if (e.target.value && window.confirm('Move all these questions into that intent? This one is removed.')) merge.mutate(e.target.value) }} style={field}>
              <option value="">Merge into…</option>
              {clusters.filter((x) => x._id !== c._id).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
            </select>
          </div>
        </details>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div style={{ padding: '16px 18px' }}>
          {c.suggestion?.needsData && (
            <div className="flex gap-2" style={{ background: '#FFF7E6', border: '1px solid #F5D896', color: '#8A5A00', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>
              <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 1 }} /> Missing information: {c.suggestion.needsData}
            </div>
          )}
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <span style={caps}>{data!.record ? `Approved answer · v${data!.record.version}` : 'Suggested answer'}</span>
            {!data!.record && c.suggestion?.by === 'ai' && <span style={{ fontSize: 11.5, color: MUTED }}>written by AI {when(c.suggestion.at)}</span>}
            <button type="button" onClick={() => regen.mutate()} disabled={regen.isPending} style={{ ...btn(), height: 28, marginLeft: 'auto', fontSize: 12 }}>
              {regen.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {c.suggestion?.text ? 'Suggest again' : 'Suggest an answer'}
            </button>
          </div>
          <textarea ref={box} value={draft} onChange={(e) => setText(e.target.value)} rows={7} aria-label="Answer" placeholder="Write the answer customers should get…"
            style={{ ...field, lineHeight: 1.5, fontSize: 14, resize: 'vertical', borderColor: changed ? PURPLE : undefined }} />
          {data!.preview && data!.preview.text !== draft && !changed && (
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>With today's values: <span style={{ color: INK }}>{data!.preview.text}</span>{data!.preview.missing.length ? <span style={{ color: '#B91C1C' }}> · no value for {data!.preview.missing.map((m) => `{${m}}`).join(', ')}</span> : null}</div>
          )}
          {(c.suggestion?.sources?.length ?? 0) > 0 && !data!.record && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Based on: {c.suggestion!.sources.join(' · ')}</div>}
          <input value={followUp ?? data!.record?.followUp ?? ''} onChange={(e) => setFollowUp(e.target.value)} placeholder="Then ask… (optional follow-up question)" aria-label="Follow-up" style={{ ...field, marginTop: 8 }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)" aria-label="Review note" style={{ ...field, marginTop: 8 }} />

          {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
          {canApprove ? (
            <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
              <button type="button" style={btn(true)} disabled={act.isPending || !draft.trim()} onClick={approve}><Check size={14} /> {changed ? 'Save edit & approve' : 'Approve'}<Kbd>{changed ? 'Ctrl+⏎' : 'A'}</Kbd></button>
              <button type="button" style={btn()} disabled={act.isPending} onClick={() => box.current?.focus()}><Pencil size={14} /> Edit<Kbd>E</Kbd></button>
              <button type="button" style={btn()} disabled={act.isPending || !draft.trim()} onClick={() => act.mutate({ action: 'save_new', text: draft, note })}><Plus size={14} /> Save as new answer<Kbd>N</Kbd></button>
              <button type="button" style={btn()} disabled={act.isPending} onClick={() => act.mutate({ action: 'escalate', note })}><CornerUpRight size={14} /> To a person<Kbd>X</Kbd></button>
              <button type="button" style={btn(false, true)} disabled={act.isPending} onClick={() => act.mutate({ action: 'reject', note })}><X size={14} /> Reject<Kbd>R</Kbd></button>
              {['approved', 'rejected', 'escalated'].includes(c.status) && <button type="button" style={btn()} onClick={() => act.mutate({ action: 'reopen' })}>Reopen</button>}
            </div>
          ) : <div style={{ fontSize: 12.5, color: MUTED, marginTop: 12 }}>Your role ({me.role}) can comment; an approver decides.</div>}

          {lastEdit && (
            <div className="grid gap-3 sm:grid-cols-2" style={{ marginTop: 16 }}>
              <div><div style={caps}>AI suggested</div><div style={{ fontSize: 13, color: MUTED, background: TINT, borderRadius: 10, padding: 10, marginTop: 4, whiteSpace: 'pre-wrap' }}>{lastEdit.original}</div></div>
              <div><div style={caps}>Approved by {lastEdit.by?.name || 'reviewer'}</div><div style={{ fontSize: 13, color: INK, background: '#E5F6EC', borderRadius: 10, padding: 10, marginTop: 4, whiteSpace: 'pre-wrap' }}>{lastEdit.answer}</div></div>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <div className="flex items-center gap-2"><span style={caps}>How customers asked it · {variations.length}</span>
              {picked.size > 0 && <button type="button" style={{ ...btn(), height: 26, fontSize: 12, marginLeft: 'auto' }} onClick={() => { const n = window.prompt(`Move ${picked.size} question(s) to a new intent named:`); if (n) split.mutate(n) }}>Split {picked.size} into new intent</button>}
            </div>
            {(showAll ? variations : variations.slice(0, 8)).map((v) => (
              <label key={v._id} className="flex items-start gap-2" style={{ padding: '7px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
                <input type="checkbox" checked={picked.has(v._id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(v._id); else n.delete(v._id); setPicked(n) }} style={{ marginTop: 3 }} aria-label="Select question" />
                <span className="min-w-0 flex-1">
                  <span style={{ color: INK }} dir="auto">{v.text}</span>
                  {v.repeats > 1 && <span style={{ color: MUTED }}> ×{v.repeats}</span>}
                  {v.split === 'eval' && <span title="Kept aside to test the AI, not used to write answers" style={{ fontSize: 10.5, fontWeight: 700, color: PURPLE, marginLeft: 6 }}>TEST</span>}
                  {v.humanReply && <span className="block" style={{ color: MUTED, fontSize: 12 }}>Team replied: {v.humanReply.slice(0, 220)}</span>}
                </span>
              </label>
            ))}
            {variations.length > 8 && <button type="button" onClick={() => setShowAll(!showAll)} style={{ fontSize: 12.5, color: PURPLE, fontWeight: 700, marginTop: 6 }}>{showAll ? 'Show fewer' : `Show all ${variations.length}`}</button>}
          </div>
        </div>

        <aside style={{ borderLeft: `1px solid ${LINE}`, padding: '16px 16px', background: '#FCFBFE' }}>
          <div style={caps}><MessageSquare size={11} style={{ display: 'inline', marginRight: 4 }} />Comments</div>
          {(c.comments ?? []).map((m, i) => <div key={i} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: `1px solid ${LINE}` }}><b>{m.by?.name}</b> <span style={{ color: MUTED }}>{when(m.at)}</span><div>{m.text}</div></div>)}
          <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('c') as HTMLInputElement; if (f.value.trim()) { act.mutate({ action: 'comment', text: f.value }); f.value = '' } }}>
            <input name="c" placeholder="Add a comment" aria-label="Comment" style={{ ...field, marginTop: 6, fontSize: 12.5 }} />
          </form>
          <div style={{ ...caps, marginTop: 16 }}>History</div>
          {[...(c.history ?? [])].reverse().slice(0, 12).map((h, i) => (
            <div key={i} style={{ fontSize: 12, color: MUTED, padding: '4px 0' }}><span style={{ color: INK, fontWeight: 600 }}>{h.action.replace('_', ' ')}</span> · {h.by?.name} · {when(h.at)}{h.note ? <div style={{ color: INK }}>{h.note}</div> : null}</div>
          ))}
          {versions.length > 0 && (<>
            <div style={{ ...caps, marginTop: 16 }}>Versions</div>
            {[...versions].reverse().filter((v) => v.note !== 'previous').map((v, i) => <div key={i} style={{ fontSize: 12, color: MUTED, padding: '3px 0' }}>v{v.version} · {v.by?.name} · {when(v.at)}</div>)}
          </>)}
        </aside>
      </div>
    </div>
  )
}
