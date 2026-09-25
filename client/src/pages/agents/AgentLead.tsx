import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Pause, Play, RotateCcw, Undo2, UserCheck, Zap } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, agoText, dueText, needText, agentColor, type AgentAction, type Decision } from '../../lib/agentsApi'
import { Button, PageHeader, Spinner, Textarea } from '../../components/ui'
import { AgentNav, C, DecisionView, Eyebrow, Note, Panel, Pill, Tag, fmtTime } from './ui'

function plain(a: AgentAction) {
  const who = a.actor === 'agent' ? (a.agent?.name || 'the agent') : a.actor === 'system' ? 'the system' : (a.user?.name || 'a person')
  return { who, text: a.summary.replace(/^\(shadow\)\s*/, '') }
}

export default function AgentLead() {
  const { leadId = '' } = useParams()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['agents', 'lead', leadId], queryFn: () => agentsApi.lead(leadId), enabled: Boolean(leadId) })
  const [text, setText] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [err, setErr] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] })
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { setErr(''); refresh() }, onError: (e) => setErr(apiError(e)) })
  const simulate = useMutation({
    mutationFn: (trigger: 'inbound' | 'touch') => agentsApi.simulate({ leadId, text, trigger }),
    onSuccess: (r) => { setDecision(r.decision); setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <Spinner />
  if (error || !data) return <div><AgentNav /><Note>{error ? apiError(error) : 'Not found'}</Note></div>
  const f = data.file

  return (
    <div>
      <AgentNav />
      <PageHeader
        title={f.lead.fullName}
        subtitle={<span>{f.lead.phone} · <Pill bucket={f.bucket} label={f.bucketLabel} /> {f.stage && <span style={{ color: C.muted }}>{f.stage}</span>} · owned by <b style={{ color: agentColor(f.agent) }}>{f.agent?.name}</b>{f.frozenAt ? <Tag tone="danger">follow-ups stopped</Tag> : null}</span>}
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {f.bucket === 'with_person' && <Button size="sm" onClick={() => act.mutate(() => agentsApi.handBack(leadId))}><UserCheck size={13} /> Hand back to {f.agent?.name}</Button>}
            <Button size="sm" variant="outline" onClick={() => act.mutate(() => agentsApi.freeze(leadId, Boolean(f.frozenAt)))}>{f.frozenAt ? <><Play size={13} /> Resume follow-ups</> : <><Pause size={13} /> Stop follow-ups</>}</Button>
            <Link to={`/leads/${f.lead._id}`}><Button size="sm" variant="outline">Open in Leads →</Button></Link>
          </div>
        }
      />
      {err && <p style={{ color: C.danger, fontSize: 12.5 }}>{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14 }} className="agent-lead-grid">
        <Panel>
          <Eyebrow>Conversation</Eyebrow>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.messages.length === 0 && <Note>No messages on record for this number.</Note>}
            {data.messages.map((m, i) => (
              <div key={i} style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 12, fontSize: 13, whiteSpace: 'pre-line', justifySelf: m.direction === 'inbound' ? 'start' : 'end', background: m.direction === 'inbound' ? C.card : '#DCF8C6', border: m.direction === 'inbound' ? `1px solid ${C.line}` : 'none' }}>
                {m.text}
                <span style={{ display: 'block', fontSize: 10.5, color: C.muted, marginTop: 3 }}>{fmtTime(m.at)}{m.direction === 'outbound' ? (m.byAi ? ' · agent' : ' · us') : ''}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <Panel>
            <Eyebrow>The lead file</Eyebrow>
            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <div><b>Needs</b> · {needText(f.need) || 'not yet known'}</div>
              <div><b>Offered</b> · {f.offers.length ? f.offers.map((o) => `${o.unitNumber} at AED ${o.monthlyPrice}/4 wk`).join('; ') : 'nothing yet'}</div>
              <div><b>Open</b> · {f.openQuestions.length ? f.openQuestions.join('; ') : 'nothing outstanding'}</div>
              <div><b>Next touch</b> · {f.bucket === 'with_person' ? 'paused while a person has it' : f.nextTouchAt ? `${dueText(f.nextTouchAt)} · ${fmtTime(f.nextTouchAt)}` : 'nothing scheduled'}</div>
              {f.lastSummary && <div><b>{f.agent?.name}'s read</b> · {f.lastSummary}</div>}
            </div>
          </Panel>

          <Panel>
            <Eyebrow>Watch it think</Eyebrow>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what the customer would say…" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <Button size="sm" disabled={simulate.isPending || !text.trim()} onClick={() => simulate.mutate('inbound')}><Zap size={13} /> {simulate.isPending ? 'Thinking…' : 'Run as customer message'}</Button>
              <Button size="sm" variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate('touch')}><RotateCcw size={13} /> Run the next follow-up</Button>
            </div>
            <Note>Runs {f.agent?.name} against this real history. Shadow: it drafts, it never sends.</Note>
            {decision && <div style={{ marginTop: 10 }}><DecisionView d={decision} agentName={f.agent?.name} /></div>}
          </Panel>

          <Panel>
            <Eyebrow>What the agents did</Eyebrow>
            <div style={{ display: 'grid', gap: 8 }}>
              {data.actions.length === 0 && <Note>Nothing yet.</Note>}
              {data.actions.map((a) => {
                const p = plain(a)
                const handoff = a.kind === 'handoff'
                return (
                  <div key={a._id} style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 10, alignItems: 'start', fontSize: 13, opacity: a.revertedAt ? .5 : 1 }}>
                    <div style={{ fontSize: 11, color: C.muted, paddingTop: 2 }}>{agoText(a.at)}</div>
                    <div>
                      <div style={{ textDecoration: a.revertedAt ? 'line-through' : 'none' }}>{handoff ? <b>{p.text}</b> : <><b style={{ color: a.actor === 'agent' ? agentColor(a.agent) : C.ink }}>{p.who}</b> — {p.text}</>}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                        {a.bucketBefore && a.bucketAfter && a.bucketBefore !== a.bucketAfter && <span style={{ fontSize: 11, color: C.muted }}><Pill bucket={a.bucketBefore} /> → <Pill bucket={a.bucketAfter} /></span>}
                        {a.resolution && <Tag tone={a.resolution === 'approved' ? 'ok' : a.resolution === 'edited' ? 'amber' : 'grey'}>{a.resolution}</Tag>}
                        {a.detail && (
                          <details style={{ fontSize: 12 }}><summary style={{ cursor: 'pointer', color: C.purple, fontWeight: 600 }}>technical</summary>
                            <pre style={{ fontSize: 11, background: C.page, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, overflowX: 'auto', margin: '6px 0 0', maxHeight: 260 }}>{JSON.stringify({ model: a.detail.model, promptVersion: a.detail.promptVersion, usage: a.detail.usage, toolCalls: a.detail.toolCalls, grounded: a.detail.grounded, template: a.detail.template, sentText: a.sentText || undefined }, null, 1).slice(0, 5000)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                    <div>{a.revertible && !a.revertedAt && <button onClick={() => act.mutate(() => agentsApi.revert(a._id))} style={{ border: `1px solid ${C.line}`, background: C.card, color: C.second, borderRadius: 7, padding: '2px 7px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' }}><Undo2 size={11} /> Revert</button>}</div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .agent-lead-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}
