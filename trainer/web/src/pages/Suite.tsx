import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Circle, PlayCircle, EyeOff, Rocket, ChevronRight } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, ACCENT, LINE, TINT, HEAD, btn, panel, caps, field, when } from './theme'
import { Pill } from './shared'
import { Score } from './ScoreCard'
import { type PlaybookResp, type Run, type Gate, labelOf, scoreTone } from './sales'

/* The regression suite and the way to live traffic (Specification §17, §18):
   every approved scenario is put to the agent, scored, and checked against
   the graduation gates; a blind review adds the human verdict; the agent
   moves stage by stage only on a run that passes every gate. */

const ICON = { pass: <CheckCircle2 size={16} color="#16A34A" />, fail: <XCircle size={16} color="#DC2626" />, pending: <Circle size={16} color="#CBD5E1" /> }

export default function Suite({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState('core')
  const [agent, setAgent] = useState('hosted')
  const [open, setOpen] = useState<string | null>(null)
  const [blind, setBlind] = useState(false)
  const [err, setErr] = useState('')
  const pb = useQuery<PlaybookResp>({ queryKey: ['playbook', me.org.id], queryFn: () => api.get('/sales/playbook').then((r) => r.data) })
  const runs = useQuery<{ runs: Run[] }>({
    queryKey: ['runs', me.org.id], queryFn: () => api.get('/sales/runs').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.runs.some((x) => x.status === 'running') ? 4000 : false),
  })
  const start = useMutation({
    mutationFn: () => api.post('/sales/runs', { scope, agent }), onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['runs', me.org.id] }) }, onError: (e) => setErr(apiError(e)),
  })
  const latest = runs.data?.runs.find((r) => r.status === 'done')
  const running = runs.data?.runs.find((r) => r.status === 'running')
  const p = pb.data?.playbook

  return (
    <div className="space-y-4">
      {pb.data && <Rollout me={me} pb={pb.data} passed={Boolean(runs.data?.runs.find((r) => r.status === 'done' && ['core', 'all'].includes(r.scope))?.passedAll)} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div style={{ ...panel, padding: 18 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}><PlayCircle size={16} style={{ color: ACCENT }} /> Run the scenario suite</div>
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>Every approved scenario is put to the agent and scored. Run it after any change to the playbook, the knowledge or the model; the run records all three.</p>
          {me.permissions.includes('evaluate') && (
            <div className="flex flex-wrap items-end gap-2">
              <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scenarios to run" style={{ ...field, width: 200 }}>
                <option value="core">Core suite</option><option value="all">All approved</option>
                {p?.groups.map((g) => <option key={g.key} value={g.key}>{g.label} only</option>)}
              </select>
              {me.org.connector.enabled && <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent" style={{ ...field, width: 190 }}><option value="hosted">Playbook agent</option><option value="connected">Your connected agent</option></select>}
              <button type="button" style={btn(true)} disabled={Boolean(running) || start.isPending} onClick={() => start.mutate()}>Run</button>
            </div>
          )}
          {running && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10 }}>Running {running.label}: {running.progress.done} of {running.progress.total}</div>}
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        </div>

        <div style={{ ...panel, padding: 18 }}>
          <div className="flex items-center gap-2">
            <span style={{ fontWeight: 800, color: INK }}>Graduation gates</span>
            {latest && <Pill status={latest.passedAll ? 'approved' : 'rejected'}>{latest.passedAll ? 'All passed' : 'Not yet'}</Pill>}
            <div className="flex-1" />
            {latest && me.permissions.includes('review') && <button type="button" style={{ ...btn(), height: 30 }} onClick={() => setBlind(true)}><EyeOff size={13} /> Blind review</button>}
          </div>
          {!latest ? <div style={{ fontSize: 13, color: MUTED, marginTop: 8 }}>Run the suite to measure them.</div> : (
            <div style={{ marginTop: 8 }}>
              {latest.gates.map((g: Gate) => (
                <div key={g.key} className="flex items-center gap-2.5" style={{ padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
                  {ICON[g.status]}
                  <span className="min-w-0 flex-1" style={{ color: INK }}>{g.label}{g.note && <span style={{ color: MUTED }}> · {g.note}</span>}</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>{g.target}</span>
                  <b style={{ width: 52, textAlign: 'right', color: g.status === 'fail' ? '#DC2626' : INK }}>{g.actual ?? '—'}</b>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>From {latest.label} · {when(latest.createdAt)}. Scores are a model's estimate; the blind review is people's.</div>
            </div>
          )}
        </div>
      </div>

      {blind && latest && <Blind run={latest} onClose={() => { setBlind(false); qc.invalidateQueries({ queryKey: ['runs', me.org.id] }) }} />}

      <div style={panel}>
        <div style={{ ...caps, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>Suite runs</div>
        {!runs.data?.runs.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>No runs yet. Approve scenarios first, then run the suite.</div>}
        {runs.data?.runs.map((r) => (
          <div key={r._id}>
            <button type="button" onClick={() => setOpen(open === r._id ? null : r._id)} className="block w-full text-left" style={{ padding: '12px 18px', borderBottom: `1px solid ${LINE}`, background: open === r._id ? TINT : 'transparent' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span style={{ fontWeight: 700, color: INK }}>{r.label}</span><Pill status={r.status} />
                {r.status === 'done' && <Pill status={r.passedAll ? 'approved' : 'rejected'}>{r.passedAll ? 'Gates passed' : 'Gates not met'}</Pill>}
                <span style={{ fontSize: 12, color: MUTED }}>{r.agent} · {r.model} · playbook {r.promptVersion} · knowledge v{r.knowledgeVersion} · {when(r.createdAt)}</span>
              </div>
              {r.summary && (
                <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>
                  <span>Score <b style={{ color: INK, fontFamily: HEAD, fontSize: 15 }}>{r.summary.avgScore ?? '—'}</b>/100</span>
                  <span><b style={{ color: INK }}>{r.summary.passed}</b>/{r.summary.completed} passed</span>
                  <span><b style={{ color: r.summary.autoFails ? '#B91C1C' : INK }}>{r.summary.autoFails}</b> automatic fails</span>
                  <span>Right action <b style={{ color: INK }}>{r.summary.nbaPct ?? '—'}%</b></span>
                  {r.regressions.length > 0 && <span style={{ color: '#B91C1C' }}><b>{r.regressions.length}</b> newly failing</span>}
                </div>
              )}
            </button>
            {open === r._id && <Cases id={r._id} me={me} pb={pb.data} regressions={r.regressions} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Cases({ id, me, pb, regressions }: { id: string; me: Me; pb?: PlaybookResp; regressions: string[] }) {
  const run = useQuery<{ run: Run }>({ queryKey: ['run', id], queryFn: () => api.get(`/sales/runs/${id}`).then((r) => r.data) })
  const [fix, setFix] = useState<number | null>(null)
  const [onlyFail, setOnlyFail] = useState(true)
  const p = pb?.playbook
  const cases = (run.data?.run.cases ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !onlyFail || !c.grade?.pass)
  return (
    <div style={{ background: '#FBFCFE', borderBottom: `1px solid ${LINE}` }}>
      <label className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: MUTED, padding: '10px 18px' }}><input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> Failing only</label>
      {!cases.length && <div style={{ padding: '0 18px 14px', fontSize: 13, color: MUTED }}>{run.isLoading ? 'Loading…' : 'Nothing failing.'}</div>}
      {cases.map(({ c, i }) => (
        <div key={i} style={{ padding: '10px 18px', borderTop: `1px solid ${LINE}`, fontSize: 12.5 }}>
          <div className="flex flex-wrap items-center gap-2">
            <b style={{ color: INK }}>{c.title}</b><span style={{ color: MUTED }}>{labelOf(p?.groups, c.group)}</span>
            {c.grade && <Pill status={scoreTone(c.grade.score, p?.passMark)}>{c.grade.score ?? '—'}</Pill>}
            {regressions.includes(c.scenario) && <Pill status="rejected">Newly failing</Pill>}
            {c.error && <span style={{ color: '#B91C1C' }}>{c.error}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-2" style={{ marginTop: 6 }}>
            <div><div style={caps}>Customer</div><div dir="auto" style={{ color: INK }}>{c.message}</div>
              <div style={{ color: MUTED, marginTop: 4 }}>Expected: {c.expected.map((k) => labelOf(p?.actions, k)).join(' or ')} · Chose: <b style={{ color: c.grade?.nbaOk ? INK : '#B45309' }}>{labelOf(p?.actions, c.out?.nba ?? '') || '—'}</b></div></div>
            <div><div style={caps}>Agent replied</div><div dir="auto" style={{ color: INK, whiteSpace: 'pre-wrap' }}>{c.out?.reply || (c.out?.needsHuman ? 'Handed to a person' : '—')}</div></div>
          </div>
          {c.grade && <Score g={c.grade} pb={pb} />}
          {c.out && me.permissions.includes('approve') && (fix === i ? <Correct runId={id} i={i} ideal={c.ideal} nba={c.expected[0] ?? ''} pb={pb} done={() => { setFix(null); run.refetch() }} /> : <button type="button" style={{ ...btn(), height: 28, marginTop: 6 }} onClick={() => setFix(i)}>Correct the scenario</button>)}
        </div>
      ))}
    </div>
  )
}

function Correct({ runId, i, ideal, nba, pb, done }: { runId: string; i: number; ideal: string; nba: string; pb?: PlaybookResp; done: () => void }) {
  const [text, setText] = useState(ideal)
  const [action, setAction] = useState(nba)
  const [critique, setCritique] = useState('')
  const [err, setErr] = useState('')
  const save = useMutation({ mutationFn: () => api.post(`/sales/runs/${runId}/cases/${i}/correct`, { idealResponse: text, nba: [action], critique }), onSuccess: done, onError: (e) => setErr(apiError(e)) })
  return (
    <div className="space-y-2" style={{ marginTop: 8, maxWidth: 680 }}>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="The reply it should have sent" aria-label="Corrected reply" style={field} dir="auto" />
      <div className="flex flex-wrap gap-2">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Correct action" style={{ ...field, width: 220 }}>{pb?.playbook.actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        <input value={critique} onChange={(e) => setCritique(e.target.value)} placeholder="What was wrong" style={{ ...field, flex: 1, minWidth: 200 }} />
        <button type="button" style={btn(true)} disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
      {err && <div style={{ color: '#B91C1C' }}>{err}</div>}
    </div>
  )
}

const RATE = [['send', 'Send as-is', '1'], ['minor', 'Minor edit', '2'], ['major', 'Major edit', '3'], ['wrong', 'Wrong', '4']] as const

/** One reply at a time, with no score, agent name or expected answer shown. */
function Blind({ run, onClose }: { run: Run; onClose: () => void }) {
  const next = useQuery<{ remaining: number; rated: number; item: { index: number; context: { from: string; text: string }[]; message: string; reply: string } | null }>({
    queryKey: ['blind', run._id], queryFn: () => api.get(`/sales/runs/${run._id}/blind`).then((r) => r.data), gcTime: 0,
  })
  const rate = useMutation({ mutationFn: (rating: string) => api.post(`/sales/runs/${run._id}/blind`, { index: next.data?.item?.index, rating }), onSuccess: () => next.refetch() })
  const item = next.data?.item
  return (
    <div style={{ ...panel, padding: 18 }} onKeyDown={(e) => { const r = RATE.find((x) => x[2] === e.key); if (r && item) rate.mutate(r[0]) }} tabIndex={-1}>
      <div className="flex items-center gap-2">
        <EyeOff size={16} style={{ color: ACCENT }} /><b style={{ color: INK }}>Blind review</b>
        <span style={{ fontSize: 12.5, color: MUTED }}>{next.data ? `${next.data.rated} rated · ${next.data.remaining} left` : ''}</span>
        <div className="flex-1" /><button type="button" style={btn()} onClick={onClose}>Done</button>
      </div>
      {!item ? <div style={{ fontSize: 13, color: MUTED, marginTop: 10 }}>{next.isLoading ? 'Loading…' : 'Every reply in this run has been rated.'}</div> : (
        <div style={{ marginTop: 12, maxWidth: 720 }}>
          <div className="space-y-1.5" style={{ fontSize: 13 }}>
            {[...item.context, { from: 'customer', text: item.message }].map((m, k) => <div key={k} dir="auto" style={{ color: m.from === 'agent' ? MUTED : INK }}><b>{m.from === 'agent' ? 'Agent' : 'Customer'}:</b> {m.text}</div>)}
          </div>
          <div dir="auto" style={{ background: TINT, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 14, color: INK, whiteSpace: 'pre-wrap' }}>{item.reply || <i>(no reply — handed to a person)</i>}</div>
          <div style={{ fontSize: 12.5, color: MUTED, margin: '10px 0 6px' }}>Would you send this reply to the customer?</div>
          <div className="flex flex-wrap gap-2">{RATE.map(([k, l, key]) => <button key={k} type="button" style={btn(k === 'send')} disabled={rate.isPending} onClick={() => rate.mutate(k)}>{l} <span style={{ opacity: 0.6, fontSize: 11 }}>{key}</span></button>)}</div>
        </div>
      )}
    </div>
  )
}

function Rollout({ me, pb, passed }: { me: Me; pb: PlaybookResp; passed: boolean }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [intents, setIntents] = useState(pb.rollout.intents.join('\n'))
  const [err, setErr] = useState('')
  const at = Math.max(0, pb.stages.findIndex((s) => s.key === pb.rollout.stage))
  const nextStage = pb.stages[at + 1]
  const move = useMutation({
    mutationFn: (stage: string) => api.put('/sales/rollout', { stage, note, intents: intents.split('\n').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { setErr(''); setNote(''); qc.invalidateQueries({ queryKey: ['playbook', me.org.id] }) }, onError: (e) => setErr(apiError(e)),
  })
  const needsGates = nextStage && at + 1 >= 2
  return (
    <div style={{ ...panel, padding: 18 }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}><Rocket size={16} style={{ color: ACCENT }} /> Go-live stage</div>
      <div className="flex flex-wrap items-center gap-1" style={{ margin: '12px 0' }}>
        {pb.stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <span title={s.body} style={{ fontSize: 12.5, padding: '5px 11px', borderRadius: 99, fontWeight: i === at ? 700 : 500, background: i === at ? ACCENT : i < at ? '#E5F6EC' : TINT, color: i === at ? '#fff' : i < at ? '#166534' : MUTED }}>{s.label}</span>
            {i < pb.stages.length - 1 && <ChevronRight size={14} color="#CBD5E1" />}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: INK }}>{pb.stages[at]?.body}{pb.rollout.changedBy && <span style={{ color: MUTED }}> · set by {pb.rollout.changedBy.name} {when(pb.rollout.at)}</span>}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>The stage is recorded here and shared with your system by API (<code>GET /api/v1/rollout</code>); your system decides what it sends.</div>
      {me.permissions.includes('manage') && (
        <div className="space-y-2" style={{ marginTop: 12 }}>
          {['limited', 'expanded', 'optimized'].includes(nextStage?.key ?? pb.rollout.stage) && <textarea rows={2} value={intents} onChange={(e) => setIntents(e.target.value)} placeholder="Low-risk intents allowed to send on their own, one per line" aria-label="Autonomous intents" style={field} />}
          <div className="flex flex-wrap gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (kept in the audit log)" style={{ ...field, flex: 1, minWidth: 200 }} />
            {at > 0 && <button type="button" style={btn()} disabled={move.isPending} onClick={() => move.mutate(pb.stages[at - 1].key)}>Step back</button>}
            {nextStage && <button type="button" style={btn(true)} disabled={move.isPending || (needsGates && !passed)} title={needsGates && !passed ? 'The latest suite run must pass every gate' : ''} onClick={() => move.mutate(nextStage.key)}>Move to {nextStage.label}</button>}
          </div>
          {needsGates && !passed && <div style={{ fontSize: 12, color: MUTED }}>Moving to {nextStage.label} needs the latest suite run to pass every gate.</div>}
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5 }}>{err}</div>}
        </div>
      )}
    </div>
  )
}
