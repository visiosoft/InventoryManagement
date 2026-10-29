import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Send, RotateCcw, Gauge, Check, PenLine, Film, Zap, BookOpen } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, ACCENT, LINE, TINT, btn, panel, caps, field } from './theme'
import { Pill, PageTitle } from './shared'
import { type PlaybookResp, type Scenario, type Turn, type Grade, type Lead, type Msg, labelOf } from './sales'
import { Score } from './ScoreCard'

/* The sandbox (Specification §14): a tester plays the customer, the agent
   answers, and beside it the lead state, the chosen Next Best Action and the
   knowledge it used. Media, visits, reservations and payments are simulated —
   nothing is sent. Any reply can be scored, approved or corrected; approved
   and corrected replies become scenarios for the regression suite. */

type Line = Msg & { id?: string; out?: Turn; grade?: Grade; leadBefore?: Lead; saved?: string }

export default function Sandbox() {
  const { me } = useOutletContext<{ me: Me }>()
  const pb = useQuery<PlaybookResp>({ queryKey: ['playbook', me.org.id], queryFn: () => api.get('/sales/playbook').then((r) => r.data) })
  const scen = useQuery<{ scenarios: Scenario[] }>({ queryKey: ['scenarios', me.org.id, 'all'], queryFn: () => api.get('/sales/scenarios').then((r) => r.data) })
  const [lines, setLines] = useState<Line[]>([])
  const [lead, setLead] = useState<Lead>({})
  const [text, setText] = useState('')
  const [agent, setAgent] = useState<'hosted' | 'connected'>('hosted')
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [session, setSession] = useState(() => crypto.randomUUID())
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const [params, setParams] = useSearchParams()
  const wanted = params.get('scenario')
  useEffect(() => {
    const s = wanted && scen.data?.scenarios.find((x) => x._id === wanted)
    if (s) { reset(s); setParams({}, { replace: true }) }
    // reset is stable enough here: it only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, scen.data])
  const p = pb.data?.playbook
  const last = [...lines].reverse().find((l) => l.out)?.out

  const send = useMutation({
    mutationFn: (message: string) => api.post('/sales/sandbox/turn', { session, message, context: lines.map(({ from, text }) => ({ from, text })), lead, agent, scenario: scenario?._id }).then((r) => r.data as { id: string; out: Turn }),
    onSuccess: (d, message) => {
      setErr('')
      setLines((ls) => [...ls, { from: 'customer', text: message }, { from: 'agent', text: d.out.reply, id: d.id, out: d.out, leadBefore: lead }])
      setLead(d.out.lead)
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
    },
    onError: (e) => setErr(apiError(e)),
  })
  const score = useMutation({
    mutationFn: (i: number) => api.post(`/sales/sandbox/${lines[i].id}/score`).then((r) => ({ i, grade: r.data.grade as Grade })),
    onSuccess: ({ i, grade }) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, grade } : l))), onError: (e) => setErr(apiError(e)),
  })

  function reset(s: Scenario | null = null) {
    setSession(crypto.randomUUID()); setErr(''); setEditing(null); setScenario(s)
    setLines(s ? s.context.map((m) => ({ ...m })) : [])
    setLead(Object.fromEntries(Object.entries(s?.leadBefore ?? {}).map(([k, v]) => [k, { value: String(v), confidence: 1 }])))
    setText(s?.message ?? '')
  }
  const submit = () => { const t = text.trim(); if (t && !send.isPending) { setText(''); send.mutate(t) } }

  return (
    <div>
      <PageTitle title="Sandbox" sub="Play the customer. The agent replies as it would live; nothing is sent, booked or charged." action={
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Start from a scenario" value={scenario?._id ?? ''} onChange={(e) => reset(scen.data?.scenarios.find((s) => s._id === e.target.value) ?? null)} style={{ ...field, width: 240, height: 36 }}>
            <option value="">Free conversation</option>
            {scen.data?.scenarios.map((s) => <option key={s._id} value={s._id}>{labelOf(p?.groups, s.group)} · {s.title}</option>)}
          </select>
          {me.org.connector.enabled && (
            <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value as 'hosted' | 'connected')} style={{ ...field, width: 190, height: 36 }}>
              <option value="hosted">Playbook agent</option><option value="connected">Your connected agent</option>
            </select>
          )}
          <button type="button" style={btn()} onClick={() => reset(scenario)}><RotateCcw size={14} /> {scenario ? 'Replay' : 'Reset'}</button>
        </div>
      } />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div style={{ ...panel, display: 'flex', flexDirection: 'column', minHeight: 560 }}>
          {scenario && (
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${LINE}`, fontSize: 12.5, color: MUTED }}>
              <b style={{ color: INK }}>{scenario.title}</b> · expected: {scenario.nba.map((k) => labelOf(p?.actions, k)).join(' or ') || '—'}{scenario.mustEscalate ? ' · must hand over' : ''}
            </div>
          )}
          <div className="flex-1 space-y-3" style={{ padding: 18, overflowY: 'auto', maxHeight: 640 }}>
            {!lines.length && <div style={{ color: MUTED, fontSize: 13.5, textAlign: 'center', marginTop: 80 }}>Write as a customer would on WhatsApp — or pick a scenario above.</div>}
            {lines.map((l, i) => l.from === 'customer' ? (
              <div key={i} className="flex justify-end"><div dir="auto" style={{ background: 'linear-gradient(180deg,#3B82F6,#2563EB)', color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '9px 13px', maxWidth: '75%', fontSize: 14, whiteSpace: 'pre-wrap' }}>{l.text}</div></div>
            ) : (
              <div key={i} style={{ maxWidth: '85%' }}>
                <div dir="auto" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: '16px 16px 16px 4px', padding: '9px 13px', fontSize: 14, color: INK, whiteSpace: 'pre-wrap' }}>{l.text || <i style={{ color: MUTED }}>No reply</i>}</div>
                {l.out && (
                  <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 6, fontSize: 12 }}>
                    <Pill status="published">{labelOf(p?.actions, l.out.nba) || 'no action'}</Pill>
                    {l.out.needsHuman && <Pill status="escalated">To a person</Pill>}
                    {l.out.trace.media.map((m) => <span key={m.key} className="inline-flex items-center gap-1" style={{ color: MUTED }}><Film size={12} /> would send {m.label}</span>)}
                    {l.out.actions.map((a, k) => <span key={k} className="inline-flex items-center gap-1" style={{ color: MUTED }}><Zap size={12} /> simulated: {a.type}{a.detail ? ` — ${a.detail}` : ''}</span>)}
                  </div>
                )}
                {l.id && (
                  <div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
                    {!l.grade && <button type="button" style={{ ...btn(), height: 28 }} disabled={score.isPending} onClick={() => score.mutate(i)}><Gauge size={13} /> Score</button>}
                    {l.saved ? <span style={{ fontSize: 12, color: '#166534' }}>Saved as a scenario · <Link to="/scenarios" style={{ color: ACCENT }}>open</Link></span> : me.permissions.includes('review') && <>
                      <button type="button" style={{ ...btn(), height: 28 }} onClick={() => setEditing(editing === i ? null : i)}><PenLine size={13} /> Correct</button>
                      <Save i={i} line={l} lines={lines} setLines={setLines} p={pb.data} corrected={false} />
                    </>}
                  </div>
                )}
                {l.grade && <Score g={l.grade} pb={pb.data} />}
                {editing === i && <Save i={i} line={l} lines={lines} setLines={(f) => { setLines(f); setEditing(null) }} p={pb.data} corrected />}
              </div>
            ))}
            {send.isPending && <div style={{ fontSize: 13, color: MUTED }}>Agent is thinking…</div>}
            <div ref={end} />
          </div>
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5, padding: '0 18px 8px' }}>{err}</div>}
          <div className="flex gap-2" style={{ padding: 14, borderTop: `1px solid ${LINE}` }}>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} placeholder="Customer message…" aria-label="Customer message" dir="auto" style={{ ...field, resize: 'none' }} disabled={!me.permissions.includes('evaluate')} />
            <button type="button" style={{ ...btn(true), height: 'auto' }} disabled={!text.trim() || send.isPending} onClick={submit} aria-label="Send"><Send size={15} /></button>
          </div>
        </div>

        <div className="space-y-4">
          <LeadPanel lead={lead} pb={pb.data} state={last?.state} />
          <div style={{ ...panel, padding: 16 }}>
            <div style={caps}>Next best action</div>
            <div style={{ fontWeight: 700, color: INK, marginTop: 4 }}>{last ? labelOf(p?.actions, last.nba) || '—' : '—'}</div>
            {last?.reason && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>{last.reason}</div>}
          </div>
          <Trace out={last} />
        </div>
      </div>
    </div>
  )
}

function LeadPanel({ lead, pb, state }: { lead: Lead; pb?: PlaybookResp; state?: string }) {
  const p = pb?.playbook
  return (
    <div style={{ ...panel, padding: 16 }}>
      <div style={caps}>Conversation state</div>
      <div className="flex flex-wrap gap-1" style={{ margin: '6px 0 14px' }}>
        {p?.states.map((s) => <span key={s.key} title={s.objective} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 99, background: s.key === state ? ACCENT : TINT, color: s.key === state ? '#fff' : MUTED, fontWeight: s.key === state ? 700 : 500 }}>{s.label}</span>)}
      </div>
      <div style={caps}>Lead state</div>
      <div style={{ marginTop: 6 }}>
        {p?.fields.map((f) => {
          const v = lead[f.key]
          return (
            <div key={f.key} className="flex items-center gap-2" style={{ padding: '4px 0', fontSize: 12.5, borderBottom: `1px solid ${LINE}` }}>
              <span style={{ color: MUTED, width: 118, flex: '0 0 auto' }}>{f.label}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: v ? INK : '#CBD5E1', fontWeight: v ? 600 : 400 }} title={v?.value}>{v?.value ?? 'unknown'}</span>
              {v && <span title={`Confidence ${Math.round(v.confidence * 100)}%`} style={{ width: 34, height: 5, borderRadius: 9, background: '#E2E8F0', overflow: 'hidden', flex: '0 0 auto' }}><span style={{ display: 'block', height: '100%', width: `${v.confidence * 100}%`, background: v.confidence >= 0.7 ? '#22C55E' : '#F59E0B' }} /></span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Trace({ out }: { out?: Turn }) {
  return (
    <div style={{ ...panel, padding: 16 }}>
      <div className="flex items-center gap-1.5" style={caps}><BookOpen size={12} /> Knowledge trace</div>
      {!out ? <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>What the agent relied on shows here.</div> : (
        <div style={{ fontSize: 12.5, marginTop: 6 }} className="space-y-2">
          {out.trace.answers.map((a) => <div key={a.id}><b style={{ color: INK }}>Approved answer</b> <span style={{ color: MUTED }}>({Math.round(a.score * 100)}% match)</span><div style={{ color: MUTED }}>{a.question}</div></div>)}
          {out.trace.facts.map((f, i) => <div key={i} style={{ color: INK }}>“{f}”</div>)}
          {out.trace.tools.map((t) => <div key={t} style={{ color: MUTED }}>Tool used: {t}</div>)}
          {!out.trace.answers.length && !out.trace.facts.length && !out.trace.tools.length && <div style={{ color: '#B45309' }}>No approved answer or fact was cited.</div>}
          <div style={{ color: MUTED, fontSize: 11.5, paddingTop: 6, borderTop: `1px solid ${LINE}` }}>{out.agent} · {out.model} · playbook {out.promptVersion} · knowledge v{out.knowledgeVersion} · {(out.latencyMs / 1000).toFixed(1)}s</div>
        </div>
      )}
    </div>
  )
}

/** Approve the reply as it is (one click), or correct it: either way it becomes a scenario. */
function Save({ i, line, lines, setLines, p, corrected }: { i: number; line: Line; lines: Line[]; setLines: (f: (ls: Line[]) => Line[]) => void; p?: PlaybookResp; corrected: boolean }) {
  const [ideal, setIdeal] = useState(line.text)
  const [nba, setNba] = useState(line.out?.nba ?? '')
  const [critique, setCritique] = useState('')
  const [group, setGroup] = useState(p?.playbook.groups[0]?.key ?? '')
  const [err, setErr] = useState('')
  const title = useMemo(() => [...lines.slice(0, i)].reverse().find((l) => l.from === 'customer')?.text.slice(0, 80) ?? '', [lines, i])
  const save = useMutation({
    mutationFn: (body: object) => api.post(`/sales/sandbox/${line.id}/save`, body).then((r) => r.data),
    onSuccess: (d) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, saved: d.scenario._id } : l))), onError: (e) => setErr(apiError(e)),
  })
  if (!corrected) return <button type="button" style={{ ...btn(), height: 28 }} disabled={save.isPending} title="Save this reply as the right answer for this situation" onClick={() => save.mutate({ group, title })}><Check size={13} /> Approve</button>
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginTop: 8 }} className="space-y-2">
      <div style={caps}>What it should have said</div>
      <textarea rows={4} value={ideal} onChange={(e) => setIdeal(e.target.value)} dir="auto" style={field} aria-label="Ideal reply" />
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={nba} onChange={(e) => setNba(e.target.value)} style={field} aria-label="Correct next action">{p?.playbook.actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        <select value={group} onChange={(e) => setGroup(e.target.value)} style={field} aria-label="Scenario group">{p?.playbook.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select>
      </div>
      <input value={critique} onChange={(e) => setCritique(e.target.value)} placeholder="Why the agent's reply was wrong (optional)" style={field} />
      {err && <div style={{ color: '#B91C1C', fontSize: 12 }}>{err}</div>}
      <button type="button" style={btn(true)} disabled={!ideal.trim() || save.isPending} onClick={() => save.mutate({ idealResponse: ideal, nba: [nba], critique, group, title })}>Save correction</button>
    </div>
  )
}
