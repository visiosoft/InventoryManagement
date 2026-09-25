import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bot, Pause, Play, RotateCcw, Undo2, UserCheck, X, Zap } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, agoText, dueText, BUCKET_TONE, type Bucket, type Decision, type DeskRow } from '../../lib/agentsApi'
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, Textarea, Input } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const LINE = '#E6E0F0'
const PURPLE = '#5B2BC9'

function Pill({ bucket, label }: { bucket: Bucket; label: string }) {
  const t = BUCKET_TONE[bucket]
  return <span style={{ background: t.bg, color: t.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{label}</span>
}

function needText(n: DeskRow['need']) {
  return [n.sizeSqf && `${n.sizeSqf} sqft`, n.moveIn && `from ${n.moveIn}`, n.durationWeeks && `${n.durationWeeks}w`, n.budget && `AED ${n.budget}/mo`, n.storing]
    .filter(Boolean).join(' · ') || 'nothing learned yet'
}

/** What the agent decided, laid out so a person can judge it in ten seconds. */
function DecisionView({ d }: { d: Decision }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, background: '#fff', display: 'grid', gap: 10 }}>
      <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', color: MUTED }}>{d.model} · prompt v{d.promptVersion}{d.usage?.total_tokens ? ` · ${d.usage.total_tokens} tokens` : ''}</span>
        <Pill bucket={d.bucketBefore} label={d.bucketBefore} />
        {d.bucketAfter !== d.bucketBefore && <><span style={{ color: MUTED }}>→</span><Pill bucket={d.bucketAfter} label={d.bucketAfter} /></>}
        <span style={{ marginLeft: 'auto', color: d.needsHuman ? '#B91C1C' : '#15803D', fontWeight: 700 }}>{d.needsHuman ? 'Hands to a person' : 'Would act on its own'}</span>
      </div>
      {d.trigger === 'inbound' && (
        <div>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Would reply (shadow — not sent)</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: INK, background: '#EAF7EF', border: '1px solid #BFE5CC', borderRadius: 10, padding: '10px 12px', marginTop: 4 }}>{d.reply || <i style={{ color: MUTED }}>no reply drafted</i>}</div>
        </div>
      )}
      {d.trigger === 'touch' && (
        <div>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Would send template (shadow — not sent)</div>
          <div style={{ fontSize: 14, color: INK, marginTop: 4 }}>
            {d.template ? <><b>{d.template.name}</b> — {d.template.intent}{d.template.bodyText ? <div style={{ color: MUTED, fontSize: 12.5, marginTop: 4 }}>"{d.template.bodyText}"</div> : null}</> : <i style={{ color: MUTED }}>no approved template chosen</i>}
          </div>
        </div>
      )}
      {d.reason && <div style={{ fontSize: 13, color: d.needsHuman ? '#B91C1C' : MUTED }}><b>Reason:</b> {d.reason}</div>}
      {d.summary && <div style={{ fontSize: 13, color: MUTED }}><b>Where this lead stands:</b> {d.summary}</div>}
      {!d.grounded.ok && <div style={{ fontSize: 12.5, color: '#B91C1C' }}>Figures not backed by any tool result: {d.grounded.loose.join(', ')}</div>}
      {d.toolCalls.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: PURPLE, fontWeight: 600 }}>{d.toolCalls.length} tool call{d.toolCalls.length === 1 ? '' : 's'}</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {d.toolCalls.map((c, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', background: '#FAF7F2', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, overflowX: 'auto' }}>
                <div style={{ color: PURPLE, fontWeight: 700 }}>{c.name}({JSON.stringify(c.args)})</div>
                <div style={{ color: MUTED, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.result, null, 1).slice(0, 1200)}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function LeadDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents', 'lead', leadId], queryFn: () => agentsApi.lead(leadId) })
  const [text, setText] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [err, setErr] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['agents'] }) }

  const simulate = useMutation({
    mutationFn: (trigger: 'inbound' | 'touch') => agentsApi.simulate({ leadId, text, trigger }),
    onSuccess: (r) => { setDecision(r.decision); setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  const f = data?.file
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(20,8,31,.35)' }} />
      <div style={{ position: 'relative', width: 'min(720px, 100%)', height: '100%', overflowY: 'auto', background: '#FAF7F2', boxShadow: '-12px 0 40px rgba(0,0,0,.18)', padding: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{f?.lead?.fullName || 'Lead'}</div>
            <div style={{ fontSize: 12.5, color: MUTED }}>{f?.lead?.phone} · looked after by {f?.agent?.name} (prompt v{f?.agent?.promptVersion})</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>

        {isLoading || !f ? <Spinner /> : (
          <div style={{ display: 'grid', gap: 14 }}>
            <Card>
              <CardHeader title="The lead file" subtitle={<span><Pill bucket={f.bucket} label={f.bucketLabel} /> {f.stage && <span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>{f.stage}</span>} {f.frozenAt && <span style={{ fontSize: 12, color: '#B91C1C', marginLeft: 6 }}>· cadence stopped</span>}</span>}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => act.mutate(() => agentsApi.freeze(leadId, Boolean(f.frozenAt)))}>
                      {f.frozenAt ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Stop cadence</>}
                    </Button>
                    {f.bucket === 'with_person' && (
                      <Button size="sm" onClick={() => act.mutate(() => agentsApi.handBack(leadId))}><UserCheck size={13} /> Hand back</Button>
                    )}
                  </div>
                } />
              <CardBody>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, fontSize: 13 }}>
                  <div><div style={{ color: MUTED, fontSize: 11 }}>Needs</div><div style={{ color: INK }}>{needText(f.need)}</div></div>
                  <div><div style={{ color: MUTED, fontSize: 11 }}>Offered so far</div><div style={{ color: INK }}>{f.offers.length ? f.offers.map((o) => `${o.unitNumber} at AED ${o.monthlyPrice}/mo`).join('; ') : 'nothing yet'}</div></div>
                  <div><div style={{ color: MUTED, fontSize: 11 }}>Next touch</div><div style={{ color: INK }}>{f.nextTouchAt ? `${dueText(f.nextTouchAt)} · ${new Date(f.nextTouchAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'nothing scheduled'}</div></div>
                  <div><div style={{ color: MUTED, fontSize: 11 }}>Open questions</div><div style={{ color: INK }}>{f.openQuestions.length ? f.openQuestions.join('; ') : 'none'}</div></div>
                </div>
                {f.lastSummary && <div style={{ marginTop: 10, fontSize: 13, color: MUTED }}><b style={{ color: INK }}>Agent's last read:</b> {f.lastSummary}</div>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Watch it think" subtitle="Runs the agent against this lead's real history. Shadow mode: it drafts, it never sends." />
              <CardBody>
                <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what the customer would say…" />
                <div className="flex gap-2 flex-wrap" style={{ marginTop: 8 }}>
                  <Button size="sm" disabled={simulate.isPending || !text.trim()} onClick={() => simulate.mutate('inbound')}><Zap size={13} /> {simulate.isPending ? 'Thinking…' : 'Run as customer message'}</Button>
                  <Button size="sm" variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate('touch')}><RotateCcw size={13} /> Run the next follow-up touch</Button>
                </div>
                {err && <p style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</p>}
                {decision && <div style={{ marginTop: 12 }}><DecisionView d={decision} /></div>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={`What the agent did (${data.actions.length})`} subtitle="Newest first. Open a row for the full detail; revert restores the lead file to before that action." />
              <CardBody>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.actions.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>Nothing yet.</div>}
                  {data.actions.map((a) => (
                    <details key={a._id} style={{ border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', padding: '8px 12px', opacity: a.revertedAt ? .55 : 1 }}>
                      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: PURPLE, fontWeight: 700, whiteSpace: 'nowrap', marginTop: 3 }}>{a.kind.replace(/_/g, ' ')}</span>
                        <span style={{ flex: 1, fontSize: 13, color: INK, textDecoration: a.revertedAt ? 'line-through' : 'none' }}>{a.summary}</span>
                        <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{a.actor === 'agent' ? 'agent' : a.user?.name || a.actor} · {agoText(a.at)}</span>
                      </summary>
                      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                        <div style={{ fontSize: 12, color: MUTED }}>
                          {a.bucketBefore && a.bucketAfter && a.bucketBefore !== a.bucketAfter ? <>Bucket {a.bucketBefore} → {a.bucketAfter} · </> : null}
                          {new Date(a.at).toLocaleString('en-GB')}{a.revertedAt ? ` · reverted ${agoText(a.revertedAt)}` : ''}
                        </div>
                        {a.detail ? (
                          <pre style={{ fontSize: 11, background: '#FAF7F2', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, overflowX: 'auto', maxHeight: 320, margin: 0 }}>{JSON.stringify(a.detail, null, 1).slice(0, 6000)}</pre>
                        ) : <div style={{ fontSize: 12, color: MUTED }}>No detail kept for this row.</div>}
                        {a.revertible && !a.revertedAt && (
                          <div><Button size="sm" variant="outline" onClick={() => act.mutate(() => agentsApi.revert(a._id))}><Undo2 size={13} /> Revert this</Button></div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AgentDesk() {
  const qc = useQueryClient()
  const [bucket, setBucket] = useState<'' | Bucket>('')
  const [openLead, setOpenLead] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [quick, setQuick] = useState<Decision | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery({ queryKey: ['agents', 'desk', bucket], queryFn: () => agentsApi.desk(bucket || undefined), refetchInterval: 30_000 })
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] })

  const tick = useMutation({ mutationFn: agentsApi.tick, onSuccess: (r) => { setNote(`Clock ran: ${r.proposed} touch(es) proposed, ${r.silenced} went quiet, ${r.exhausted} exhausted${r.failed ? `, ${r.failed} failed` : ''}`); refresh() }, onError: (e) => setErr(apiError(e)) })
  const adopt = useMutation({ mutationFn: () => agentsApi.adoptOpen(25), onSuccess: (r) => { setNote(`Agent took on ${r.created} open lead(s)`); refresh() }, onError: (e) => setErr(apiError(e)) })
  const simulate = useMutation({
    mutationFn: () => agentsApi.simulate({ phone, text: msg, trigger: 'inbound' }),
    onSuccess: (r) => { setQuick(r.decision); setErr(''); refresh(); setOpenLead(r.lead._id) },
    onError: (e) => setErr(apiError(e)),
  })

  const total = data?.buckets.reduce((s, b) => s + b.count, 0) ?? 0

  return (
    <div>
      <PageHeader
        title="Agent Desk"
        subtitle={data?.agent
          ? <span><b>{data.agent.name}</b> is on duty in <b>{data.agent.mode}</b> mode (prompt v{data.agent.promptVersion}) — it drafts and proposes, nothing is sent.</span>
          : <span>No agent on duty. <Link to="/agents/profiles" style={{ color: PURPLE, fontWeight: 600 }}>Onboard one</Link> to start.</span>}
        action={
          <div className="flex gap-2 flex-wrap">
            <Link to="/agents/profiles"><Button size="sm" variant="outline"><Bot size={13} /> Agents</Button></Link>
            <Button size="sm" variant="outline" disabled={adopt.isPending || !data?.agent} onClick={() => adopt.mutate()}>Take on 25 open leads</Button>
            <Button size="sm" disabled={tick.isPending || !data?.agent} onClick={() => tick.mutate()}><RotateCcw size={13} /> {tick.isPending ? 'Running…' : 'Run the clock now'}</Button>
          </div>
        }
      />
      {(note || err) && <p style={{ fontSize: 12.5, color: err ? '#B91C1C' : '#15803D', marginBottom: 10 }}>{err || note}</p>}

      <Card>
        <CardHeader title="Try it on any lead" subtitle="Enter a lead's phone number and a message. The agent reads that lead's real WhatsApp history and lead file, then drafts. Nothing is sent." />
        <CardBody>
          <div className="flex gap-2 flex-wrap">
            <Input style={{ maxWidth: 220 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 5x xxx xxxx" />
            <Input style={{ flex: '1 1 320px' }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Hi, how much is a small unit for 2 months from next week?" />
            <Button size="sm" disabled={simulate.isPending || !phone.trim() || !msg.trim() || !data?.agent} onClick={() => simulate.mutate()}><Zap size={13} /> {simulate.isPending ? 'Thinking…' : 'Run'}</Button>
          </div>
          {quick && <div style={{ marginTop: 12 }}><DecisionView d={quick} /></div>}
        </CardBody>
      </Card>

      <div className="flex gap-1.5 flex-wrap" style={{ margin: '18px 0 12px' }}>
        <button onClick={() => setBucket('')} style={{ border: `1px solid ${bucket === '' ? PURPLE : LINE}`, background: bucket === '' ? '#EFE7FB' : '#fff', color: bucket === '' ? PURPLE : INK, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>All · {total}</button>
        {data?.buckets.map((b) => (
          <button key={b.key} onClick={() => setBucket(b.key)} style={{ border: `1px solid ${bucket === b.key ? BUCKET_TONE[b.key].fg : LINE}`, background: bucket === b.key ? BUCKET_TONE[b.key].bg : '#fff', color: bucket === b.key ? BUCKET_TONE[b.key].fg : INK, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            {b.label} · {b.count}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {data?.rows.length === 0 && <Card><CardBody><div style={{ color: MUTED, fontSize: 13 }}>Nothing in this bucket. Use "Take on 25 open leads" to give the agent something to work on, or run a message above.</div></CardBody></Card>}
          {data?.rows.map((r) => (
            <div key={r.leadFileId} role="button" tabIndex={0} onClick={() => setOpenLead(r.leadId)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenLead(r.leadId) }}
              className="flex flex-wrap items-center" style={{ gap: 14, background: '#fff', border: `1px solid ${LINE}`, borderLeft: `4px solid ${BUCKET_TONE[r.bucket].fg}`, borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }}>
              <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                <div style={{ fontWeight: 700, color: INK }}>{r.name}</div>
                <div style={{ fontSize: 12, color: MUTED }}>{r.phone}{r.temperature ? ` · ${r.temperature}` : ''}</div>
              </div>
              <div style={{ flex: '0 0 150px' }}>
                <Pill bucket={r.bucket} label={r.bucketLabel} />
                {r.stage && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{r.stage}{r.frozen ? ' · stopped' : ''}</div>}
              </div>
              <div style={{ flex: '1 1 220px', fontSize: 12.5, color: MUTED }}>
                <div style={{ color: INK }}>{r.lastAction?.summary || 'No action yet'}</div>
                <div style={{ fontSize: 11 }}>{r.lastAction ? agoText(r.lastAction.at) : ''}{r.need && needText(r.need) !== 'nothing learned yet' ? ` · ${needText(r.need)}` : ''}</div>
              </div>
              <div style={{ flex: '0 0 110px', textAlign: 'right', fontSize: 12.5, color: r.nextTouchAt && new Date(r.nextTouchAt).getTime() <= Date.now() ? '#B91C1C' : MUTED, fontWeight: 600 }}>
                {r.nextTouchAt ? `next ${dueText(r.nextTouchAt)}` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {openLead && <LeadDrawer leadId={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  )
}
