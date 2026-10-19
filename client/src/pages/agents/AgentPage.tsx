import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, Pencil, PlayCircle, Sparkles, Plus } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, agentColor, agoText, composeJob, dueText, parseJob, BUCKET_TONE, JOB_SECTIONS, type AgentBoard, type AgentPlan, type Bucket, type PlanLead, type Rehearsal, type Review } from '../../lib/agentsApi'
import { Button, PageHeader, Spinner } from '../../components/ui'
import { AgentNav, Avatar, C, DecisionView, DISPLAY, Eyebrow, Note, Panel, Pill, Stat, Tag, fmtTime } from './ui'

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`)

function Bars({ series }: { series: { day: string; drafted: number; approved: number; edited: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.drafted))
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 56 }} aria-hidden="true">
      {series.map((s) => (
        <div key={s.day} title={`${s.day}: ${s.drafted} drafted, ${s.approved} approved as written, ${s.edited} edited`} style={{ flex: 1, display: 'grid', alignItems: 'end', height: '100%' }}>
          <div style={{ position: 'relative', height: `${(s.drafted / max) * 100}%`, background: '#E4D8FA', borderRadius: '3px 3px 0 0', minHeight: s.drafted ? 3 : 0 }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: s.drafted ? `${(s.approved / s.drafted) * 100}%` : 0, background: C.purple, borderRadius: '3px 3px 0 0' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TeachRow({ agentId, rehearsalId, turnIndex, correctedReply }: { agentId: string; rehearsalId: string; turnIndex: number; correctedReply?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(correctedReply || '')
  const teach = useMutation({
    mutationFn: () => agentsApi.teachFromRehearsal(agentId, rehearsalId, turnIndex, text),
    onSuccess: (r) => { setSaved(r.correctedReply); setOpen(false); setText('') },
  })
  if (saved) return <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: C.okSoft, fontSize: 12 }}><b style={{ color: C.ok }}>Taught:</b> {saved}</div>
  if (!open) return <button onClick={() => setOpen(true)} style={{ marginTop: 6, border: 'none', background: 'none', cursor: 'pointer', color: C.purple, fontSize: 11.5, fontWeight: 700, padding: 0 }}>Not quite — teach it the right answer</button>
  return (
    <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write roughly what you'd actually say — grammar doesn't matter, it gets cleaned up." rows={2}
        style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: 'inherit', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => teach.mutate()} disabled={teach.isPending || !text.trim()} style={{ border: 'none', borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, background: C.purple, color: '#fff', cursor: 'pointer' }}>{teach.isPending ? 'Teaching…' : 'Save as training example'}</button>
        <button onClick={() => { setOpen(false); setText('') }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted, fontSize: 11.5 }}>Cancel</button>
      </div>
    </div>
  )
}

function PlanRow({ agentId, lead }: { agentId: string; lead: PlanLead }) {
  const [decision, setDecision] = useState<import('../../lib/agentsApi').Decision | null>(null)
  const preview = useMutation({
    mutationFn: () => agentsApi.simulate({ leadId: lead.leadId || undefined, trigger: 'touch', persist: false, agentId }),
    onSuccess: (r) => setDecision(r.decision),
  })
  return (
    <div style={{ display: 'grid', gap: 8, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 10, background: C.card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          {lead.leadId ? <Link to={`/agents/leads/${lead.leadId}`} style={{ fontWeight: 700, color: C.ink, textDecoration: 'none' }}>{lead.name}</Link> : <b>{lead.name}</b>}
          <span style={{ fontSize: 11.5, color: C.muted, marginLeft: 6 }}><Pill bucket={lead.bucket} label={lead.bucketLabel} /> · {lead.stage}</span>
        </div>
        {lead.leadId && (
          <Button size="sm" variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending ? 'Thinking…' : decision ? 'Preview again' : 'Preview what it will send'}
          </Button>
        )}
      </div>
      {decision && <DecisionView d={decision} />}
    </div>
  )
}

function PlanView({ agentId, plan }: { agentId: string; plan: AgentPlan }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Stat value={plan.dailyTouchCap > 0 ? `${plan.sentToday}/${plan.dailyTouchCap}` : plan.sentToday} label="sent today" tone={plan.capReached ? C.danger : C.ok} />
        <Stat value={plan.waitingNow} label="waiting for your review" tone={C.amber} />
        <Stat value={plan.skippedToday} label="skipped today" />
        {plan.overdueCount > 0 && <Stat value={plan.overdueCount} label="overdue — the clock will catch these up shortly" tone={C.danger} />}
      </div>
      {plan.capReached && <Note>Today's real-send cap ({plan.dailyTouchCap}) is reached — anything still waiting will hold until tomorrow, or raise the cap in this agent's settings.</Note>}
      {plan.upcoming.length === 0 && <Note>Nothing scheduled in the next few days.</Note>}
      {plan.upcoming.map((day) => (
        <div key={day.date}>
          <Eyebrow>{day.isToday ? 'Today' : new Date(day.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · {day.count} due</Eyebrow>
          <div style={{ display: 'grid', gap: 6 }}>
            {day.leads.map((l) => <PlanRow key={l.leadId || l.name} agentId={agentId} lead={l} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One column per cadence stage — a lead sits here until its touch
 * actually sends, then it's read straight off touchCount into the next
 * column on the board's next load. Nothing here is dragged by hand; the
 * board shows what the clock has already decided. */
function StageDots({ index, total, color }: { index: number; total: number; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: i <= index ? color : `${color}33` }} />
      ))}
    </div>
  )
}

function BoardView({ board }: { board: AgentBoard }) {
  const initials = (name: string) => name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 6 }}>
      {board.columns.map((col, ci) => {
        const tone = BUCKET_TONE[col.bucket]
        return (
          <div key={col.key} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            <div style={{ flex: '0 0 232px', borderRadius: 16, background: C.card, boxShadow: '0 1px 2px rgba(20,8,31,0.06), 0 8px 20px -12px rgba(20,8,31,0.15)', display: 'flex', flexDirection: 'column', maxHeight: 440, overflow: 'hidden' }}>
              <div style={{ height: 5, background: `linear-gradient(90deg, ${tone.fg}, ${tone.fg}99)` }} />
              <div style={{ padding: '12px 14px 10px', background: `linear-gradient(180deg, ${tone.bg}, ${C.card})` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: tone.fg }}>{col.bucketLabel}</div>
                    <div style={{ fontSize: 12, color: C.second, marginTop: 2, fontWeight: 600 }}>{col.stageLabel}</div>
                  </div>
                  <span style={{ width: 30, height: 30, borderRadius: 999, background: tone.fg, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, flex: 'none' }}>{col.count}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <StageDots index={col.stageIndex} total={col.stageTotal} color={tone.fg} />
                  <span style={{ fontSize: 10.5, color: C.muted }}>day {col.dueDays}</span>
                </div>
              </div>
              <div style={{ overflowY: 'auto', padding: 10, display: 'grid', gap: 7, flex: 1 }}>
                {col.leads.length === 0 && <div style={{ fontSize: 11.5, color: C.muted, padding: '10px 2px', textAlign: 'center' }}>Nobody here yet</div>}
                {col.leads.map((l) => (
                  <Link key={l.leadId || l.name} to={l.leadId ? `/agents/leads/${l.leadId}` : '#'} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="board-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 9px', borderRadius: 11, background: C.page, border: `1px solid ${C.line}`, fontSize: 12, transition: 'box-shadow .15s, transform .15s' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 999, background: `${tone.fg}22`, color: tone.fg, display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 10.5, flex: 'none' }}>{initials(l.name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                        <div style={{ color: C.muted, fontSize: 10.5 }}>{dueText(l.nextTouchAt)}</div>
                      </div>
                    </div>
                  </Link>
                ))}
                {col.count > col.leads.length && <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', padding: '2px' }}>and {col.count - col.leads.length} more</div>}
              </div>
            </div>
            {ci < board.columns.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', color: C.line, flex: 'none' }}><ChevronRight size={16} /></div>
            )}
          </div>
        )
      })}
      <style>{`.board-card:hover { box-shadow: 0 4px 14px -6px rgba(20,8,31,.25); transform: translateY(-1px); }`}</style>
    </div>
  )
}

function RehearsalView({ r, agentName, agentId }: { r: Rehearsal; agentName: string; agentId: string }) {
  const done = r.status === 'done'
  const isTouch = r.mode === 'touch'
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {isTouch && <Note>{agentName} only ever fires on the follow-up clock, never on a live reply — this replays real silences from your history and shows which template it would pick, not how it would answer a message.</Note>}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.status === 'running' && <Tag tone="amber">running · {r.progress.done} of {r.progress.total || '…'} turns</Tag>}
        {r.status === 'failed' && <Tag tone="danger">failed: {r.error}</Tag>}
        {done && <>
          <Stat value={r.summary.conversations} label="conversations replayed" />
          <Stat value={r.summary.turns} label={isTouch ? 'silences replayed' : 'customer messages'} />
          <Stat value={pct(r.summary.turns ? Math.round((r.summary.grounded / r.summary.turns) * 100) : null)} label="figures all backed" tone={C.ok} />
          <Stat value={pct(r.summary.turns ? Math.round((r.summary.handedOver / r.summary.turns) * 100) : null)} label="handed to a person" tone={C.amber} />
          <span style={{ fontSize: 12, color: C.muted }}>instructions v{r.promptVersion} · {r.model} · {agoText(r.finishedAt || r.startedAt)}</span>
        </>}
      </div>
      {r.turns.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {r.turns.slice(0, 40).map((t, i) => (
            <div key={i} style={{ padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10, background: C.card, fontSize: 12.5 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }} className="rehearsal-row">
                <div><div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}><Link to={`/agents/leads/${t.lead}`} style={{ color: C.muted }}>{t.leadName}</Link> · {fmtTime(t.at)}</div><div style={{ color: C.second, whiteSpace: 'pre-line' }}>{isTouch ? t.customerText : `"${t.customerText}"`}</div></div>
                <div>
                  <div style={{ fontSize: 11, color: agentColor({ name: agentName }), fontWeight: 700, marginBottom: 3 }}>{agentName} would {isTouch ? 'send' : 'say'} {t.needsHuman ? <Tag tone="danger">hand over</Tag> : null}{!t.groundedOk ? <Tag tone="amber">figure not backed</Tag> : null}</div>
                  <div style={{ whiteSpace: 'pre-line' }}>{t.error ? <span style={{ color: C.danger }}>{t.error}</span> : t.agentReply || <i style={{ color: C.muted }}>{t.reason || 'no reply'}</i>}</div>
                  {!t.error && !isTouch && <TeachRow agentId={agentId} rehearsalId={r._id} turnIndex={i} correctedReply={t.correctedReply} />}
                </div>
                <div><div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 3 }}>{isTouch ? 'what actually happened next' : 'your rep said'}</div><div style={{ color: C.second, whiteSpace: 'pre-line' }}>{t.humanReply || <i style={{ color: C.muted }}>{isTouch ? 'nothing — the thread just ended' : 'no reply recorded'}</i>}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`@media (max-width: 860px) { .rehearsal-row { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function ReviewView({ r, onApply, applying }: { r: Review; onApply: (s: Review['review']['suggestions'][number]) => void; applying: boolean }) {
  const v = r.review
  const tone = v.grade === 'A' ? C.ok : v.grade === 'B' ? C.purple : v.grade === 'C' ? C.amber : C.danger
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {v.grade && <span style={{ fontFamily: DISPLAY, fontSize: 40, fontWeight: 800, lineHeight: 1, color: tone }}>{v.grade}</span>}
        <div><p style={{ fontSize: 14, color: C.ink, margin: 0 }}>{v.summary}</p><div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>reviewed {agoText(r.at)} · last {r.periodDays} days · instructions v{r.promptVersion}</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="review-cols">
        <div><Eyebrow tone={C.ok}>Doing well</Eyebrow><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.second }}>{v.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        <div><Eyebrow tone={C.danger}>Costing us</Eyebrow><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.second }}>{v.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      </div>
      {v.suggestions.length > 0 && (
        <div>
          <Eyebrow>What to change in the instructions</Eyebrow>
          <div style={{ display: 'grid', gap: 8 }}>
            {v.suggestions.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 13 }}><b>{s.change}</b> <Tag tone="grey">{JOB_SECTIONS.find((j) => j.key === s.section)?.label}</Tag></div>
                  <div style={{ fontSize: 12, color: C.muted }}>{s.why}</div>
                  <div style={{ fontSize: 12.5, color: C.ink, marginTop: 4, fontStyle: 'italic' }}>"{s.text}"</div>
                </div>
                <Button size="sm" variant="outline" disabled={applying || !s.text} onClick={() => onApply(s)}><Plus size={12} /> Add to instructions</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`@media (max-width: 700px) { .review-cols { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

export default function AgentPage() {
  const { agentId = '' } = useParams()
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [live, setLive] = useState<Rehearsal | null>(null)
  const team = useQuery({ queryKey: ['agents', 'team'], queryFn: agentsApi.team })
  const insights = useQuery({ queryKey: ['agents', 'insights', agentId], queryFn: () => agentsApi.insights(agentId, 30), enabled: Boolean(agentId) })
  const plan = useQuery({ queryKey: ['agents', 'plan', agentId], queryFn: () => agentsApi.plan(agentId, 3), enabled: Boolean(agentId) })
  const board = useQuery({ queryKey: ['agents', 'board', agentId], queryFn: () => agentsApi.board(agentId), enabled: Boolean(agentId) })
  const profiles = useQuery({ queryKey: ['agents', 'profiles'], queryFn: agentsApi.profiles })
  const a = team.data?.agents.find((x) => x._id === agentId)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] })

  const rehearse = useMutation({ mutationFn: () => agentsApi.rehearse(agentId, { conversations: 8, turns: 3 }), onSuccess: (r) => { setLive(r.rehearsal); setErr('') }, onError: (e) => setErr(apiError(e)) })
  const review = useMutation({ mutationFn: () => agentsApi.review(agentId, 30), onSuccess: () => { setErr(''); refresh() }, onError: (e) => setErr(apiError(e)) })
  const apply = useMutation({
    mutationFn: async (s: Review['review']['suggestions'][number]) => {
      const p = profiles.data?.profiles.find((x) => x._id === agentId)
      if (!p) throw new Error('Could not load the agent')
      const parts = parseJob(p.systemPrompt)
      parts[s.section] = `${parts[s.section]}\n${s.text}`.trim()
      return agentsApi.updateProfile(agentId, { systemPrompt: composeJob(parts) })
    },
    onSuccess: () => { setErr(''); refresh() }, onError: (e) => setErr(apiError(e)),
  })

  // A rehearsal runs on the server; watch it until it finishes.
  useEffect(() => {
    if (!live || live.status !== 'running') return
    const t = setInterval(async () => {
      try { const r = await agentsApi.rehearsal(agentId, live._id); setLive(r); if (r.status !== 'running') { clearInterval(t); refresh() } } catch { clearInterval(t) }
    }, 3000)
    return () => clearInterval(t)
  }, [live, agentId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (team.isLoading) return <Spinner />
  if (!a) return <div><AgentNav /><Note>No such agent.</Note></div>
  const esc = typeof a.escalateTo === 'object' && a.escalateTo ? a.escalateTo.name : 'nobody yet'
  const s = insights.data?.stats
  const latestRehearsal = live || insights.data?.rehearsals[0] || null
  const latestReview = insights.data?.reviews[0] || null
  const nurture = a.ownsBuckets.some((b) => b === 'quiet' || b === 'dormant')
  const closing = a.ownsBuckets.some((b) => b === 'quoted' || b === 'booking')

  return (
    <div>
      <AgentNav />
      <PageHeader
        title={a.name}
        subtitle={<span><Tag tone={a.mode === 'off' ? 'grey' : 'amber'}>{a.mode === 'off' ? 'off duty' : 'drafting for review'}</Tag> {a.role} · owns {a.ownsBuckets.map((b) => b === 'tenant' ? <Tag key={b} tone="grey">existing customers</Tag> : <Pill key={b} bucket={b as Bucket} />)} · instructions v{a.promptVersion} · {a.model || 'server model'} · hands over to {esc}</span>}
        action={<div style={{ display: 'flex', gap: 8 }}><Avatar name={a.name} color={agentColor(a)} size={38} /><Link to={`/agents/profiles/${a._id}`}><Button size="sm" variant="outline"><Pencil size={13} /> Edit</Button></Link></div>}
      />
      {err && <p style={{ color: C.danger, fontSize: 12.5 }}>{err}</p>}

      {insights.isLoading || !s ? <Spinner /> : (
        <>
          <Panel>
            <Eyebrow>Last {s.days} days</Eyebrow>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Stat value={s.peopleApproachedAllTime} label="people approached, all time" />
              <Stat value={s.leadsInCare} label="leads in its care" />
              <Stat value={s.drafts + s.touchesProposed} label="drafts and follow-ups written" />
              <Stat value={pct(s.approvedRate)} label="sent as written" tone={s.approvedRate !== null && s.approvedRate >= 85 ? C.ok : undefined} />
              <Stat value={s.edited} label="edited by a person" tone={C.amber} />
              <Stat value={s.dismissed} label="thrown away" />
              <Stat value={s.handedOver} label="handed to a person" tone={C.danger} />
              {nurture && <Stat value={s.cameBack} label="came back after a touch" tone={C.ok} />}
              {closing && <Stat value={s.toBooking} label="quoted → booking" tone={C.ok} />}
              {!nurture && !closing && a.ownsBuckets.includes('new') && <Stat value={s.toQuoted} label="reached a quotation" tone={C.ok} />}
            </div>
            <div style={{ marginTop: 14 }}><Eyebrow>Drafted per day, and how much of it went out as written</Eyebrow><Bars series={s.series} /></div>
            <Note>{s.approvedRate === null ? 'The approval rate appears once people have answered drafts in Needs you.' : `${pct(s.approvedRate)} of ${s.judged} answered drafts went out untouched. Above 85% for two weeks is the signal to move FAQ and pricing replies to live.`}</Note>
          </Panel>

          {(nurture || closing) && (
            <Panel style={{ marginTop: 12 }}>
              <Eyebrow>The follow-up board — one column per stage, a lead moves right the moment its touch sends</Eyebrow>
              {board.isLoading || !board.data ? <Spinner /> : board.data.columns.length === 0 ? <Note>Nothing cadenced yet.</Note> : <BoardView board={board.data} />}
            </Panel>
          )}

          {(nurture || closing) && (
            <Panel style={{ marginTop: 12 }}>
              <Eyebrow>The standup — what {a.name} did, is doing, and plans to do</Eyebrow>
              {plan.isLoading || !plan.data ? <Spinner /> : <PlanView agentId={agentId} plan={plan.data} />}
            </Panel>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 12, marginTop: 12 }} className="agent-page-grid">
            <Panel>
              <Eyebrow>Where it hands over</Eyebrow>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                {s.handovers.length === 0 && <Note>No hand-overs in this period.</Note>}
                {s.handovers.map((h) => <div key={h.key} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{h.label}</span><b>{h.n}</b></div>)}
              </div>
              {s.handovers[0]?.key === 'discount' && <Note>Discounts are the top reason. A discount rule in the instructions would let {a.name} answer most of these.</Note>}
            </Panel>
            <Panel>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div><Eyebrow>Rehearsal</Eyebrow><p style={{ margin: 0, fontSize: 13, color: C.second }}>Replay real past conversations through {a.name} and read its draft beside what your rep actually said. Nothing is sent, nothing is saved to a lead.</p></div>
                <Button size="sm" disabled={rehearse.isPending || latestRehearsal?.status === 'running'} onClick={() => rehearse.mutate()}><PlayCircle size={13} /> {latestRehearsal?.status === 'running' ? 'Running…' : 'Rehearse on 8 conversations'}</Button>
              </div>
              <div style={{ marginTop: 12 }}>{latestRehearsal ? <RehearsalView r={latestRehearsal} agentName={a.name} agentId={agentId} /> : <Note>No rehearsal yet.</Note>}</div>
            </Panel>
          </div>

          <Panel style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div><Eyebrow>Manager's review, written by the model</Eyebrow><p style={{ margin: 0, fontSize: 13, color: C.second }}>Reads the numbers, the drafts people changed or threw away, the hand-overs and the latest rehearsal, and says what to change — as sentences you can add to the instructions with one click.</p></div>
              <Button size="sm" disabled={review.isPending} onClick={() => review.mutate()}><Sparkles size={13} /> {review.isPending ? 'Reviewing…' : latestReview ? 'Review again' : 'Write a review'}</Button>
            </div>
            <div style={{ marginTop: 12 }}>{latestReview ? <ReviewView r={latestReview} onApply={(sg) => apply.mutate(sg)} applying={apply.isPending} /> : <Note>No review yet. Run a rehearsal first so the review has something to read.</Note>}</div>
          </Panel>
        </>
      )}
      <style>{`@media (max-width: 860px) { .agent-page-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}
