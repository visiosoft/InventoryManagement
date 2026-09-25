import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Send, Pencil, X, UserCheck, Undo2 } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, agoText, needText, agentColor, type InboxDraft, type InboxTouch, type Resolution } from '../../lib/agentsApi'
import { Button, PageHeader, Spinner, Textarea } from '../../components/ui'
import { AgentNav, Avatar, AgentChip, C, Draft, Note, Panel, Pill, Quote, SectionHead, Stat, Tag, Trace } from './ui'

function DraftCard({ d, onResolve, busy }: { d: InboxDraft; onResolve: (r: Resolution, text?: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.reply)
  const flag = d.needsHuman || (d.grounded && !d.grounded.ok)
  return (
    <Panel style={{ display: 'grid', gap: 10, borderColor: flag ? C.amber : C.line }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Avatar name={d.lead.fullName} size={30} color={C.grey} />
          <div>
            <b>{d.lead.fullName}</b> <Pill bucket={d.bucket} label={d.bucketLabel} />
            <div style={{ fontSize: 12, color: C.muted }}>{d.lead.phone} · wrote {agoText(d.at)} · <AgentChip agent={d.agent} /> drafted</div>
          </div>
        </div>
        <Tag tone={flag ? 'amber' : 'ok'}>{flag ? 'check before sending' : 'confident'}</Tag>
      </div>
      {d.customerText && <Quote>"{d.customerText}"</Quote>}
      {editing ? <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /> : <Draft>{d.reply || <i style={{ color: C.muted }}>No reply drafted — {d.summary}</i>}</Draft>}
      <Trace items={[...d.trace.map((t) => t.replace(/_/g, ' ')), ...(d.grounded && !d.grounded.ok ? [`figures not backed by a tool: ${d.grounded.loose.join(', ')}`] : []), ...(needText(d.need) ? [`lead file: ${needText(d.need)}`] : [])]} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editing ? (
            <>
              <Button size="sm" disabled={busy || !text.trim()} onClick={() => onResolve('edited', text)}><Send size={13} /> Send edited as {d.agent?.name}</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setText(d.reply) }}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy || !d.reply} onClick={() => onResolve('approved')}><Send size={13} /> Send as {d.agent?.name}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil size={13} /> Edit</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve('dismissed')}><X size={13} /> Dismiss</Button>
            </>
          )}
        </div>
        <Link to={`/agents/leads/${d.lead._id}`} style={{ fontSize: 12.5, color: C.purple, fontWeight: 700, textDecoration: 'none', alignSelf: 'center' }}>Open conversation →</Link>
      </div>
    </Panel>
  )
}

function TouchRow({ t, onResolve, busy }: { t: InboxTouch; onResolve: (r: Resolution) => void; busy: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 2fr auto', gap: 14, alignItems: 'center', padding: '12px 16px', border: `1px solid ${C.line}`, borderLeft: `4px solid ${agentColor(t.agent)}`, borderRadius: 12, background: C.card }}>
      <div><div style={{ fontWeight: 700 }}>{t.lead.fullName}</div><div style={{ fontSize: 12, color: C.muted }}>{t.bucketLabel} · {t.stage} · <AgentChip agent={t.agent} /></div></div>
      <div>{t.template ? <Tag tone="amber">{t.template.intent}</Tag> : <Tag tone="danger">no template</Tag>}</div>
      <div style={{ fontSize: 12.5, color: C.ink }}>{t.template ? <>Template <b style={{ fontFamily: 'ui-monospace, monospace' }}>{t.template.name}</b>{t.template.bodyText ? <span style={{ color: C.muted }}> — "{t.template.bodyText.slice(0, 90)}…"</span> : null}</> : <span style={{ color: C.muted }}>{t.summary}</span>}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" disabled={busy || !t.template} onClick={() => onResolve('approved')}>Send</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve('skipped')}>Skip</Button>
      </div>
    </div>
  )
}

export default function AgentInbox() {
  const qc = useQueryClient()
  const [agent, setAgent] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const team = useQuery({ queryKey: ['agents', 'team'], queryFn: agentsApi.team })
  const inbox = useQuery({ queryKey: ['agents', 'inbox', agent], queryFn: () => agentsApi.inbox(agent || undefined), refetchInterval: 20_000 })
  const all = useQuery({ queryKey: ['agents', 'inbox', ''], queryFn: () => agentsApi.inbox(), enabled: Boolean(agent) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] })

  const resolve = useMutation({
    mutationFn: ({ id, r, text }: { id: string; r: Resolution; text?: string }) => agentsApi.resolve(id, r, text),
    onSuccess: (res, v) => { setErr(''); setOk(v.r === 'approved' || v.r === 'edited' ? (res.sent ? 'Sent.' : 'Done.') : 'Dismissed.'); setTimeout(() => setOk(''), 1500); refresh() },
    onError: (e) => setErr(apiError(e)),
  })
  const handBack = useMutation({ mutationFn: (leadId: string) => agentsApi.handBack(leadId), onSuccess: refresh, onError: (e) => setErr(apiError(e)) })

  const agents = team.data?.agents.filter((a) => a.isActive) || []
  const onDuty = agents.filter((a) => a.mode !== 'off')
  const totals = (all.data && agent ? all.data : inbox.data)
  const countFor = (id: string) => totals ? [...totals.drafts, ...totals.touches].filter((x) => String(x.agent?._id) === id).length + totals.handed.filter((h) => String(h.agent?._id) === id).length : 0
  const total = totals ? totals.drafts.length + totals.touches.length + totals.handed.length : 0
  const data = inbox.data

  return (
    <div>
      <AgentNav counts={{ inbox: total }} />
      <PageHeader
        title="Needs you"
        subtitle={onDuty.length ? <span>{onDuty.length} agent{onDuty.length === 1 ? '' : 's'} on duty · shadow — they draft and propose, you decide what goes out.</span> : <span>No agent on duty. <Link to="/agents/profiles/new" style={{ color: C.purple, fontWeight: 700 }}>Onboard one</Link> to start.</span>}
        action={<div style={{ display: 'flex', gap: 22 }}><Stat value={data?.drafts.length ?? '—'} label="drafts to review" /><Stat value={data?.handed.length ?? '—'} label="handed to you" tone={C.danger} /><Stat value={data?.touches.length ?? '—'} label="follow-ups proposed" tone={C.amber} /></div>}
      />
      {agents.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <button onClick={() => setAgent('')} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 700, background: agent ? C.greySoft : C.ink, color: agent ? C.second : '#fff' }}>All agents · {total}</button>
          {agents.map((a) => (
            <button key={a._id} onClick={() => setAgent(a._id)} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 700, background: agent === a._id ? agentColor(a) : C.greySoft, color: agent === a._id ? '#fff' : agentColor(a) }}>{a.name} · {countFor(a._id)}</button>
          ))}
        </div>
      )}
      {(err || ok) && <p style={{ fontSize: 12.5, color: err ? C.danger : C.ok, margin: '6px 0' }}>{err || ok}</p>}
      {inbox.isLoading ? <Spinner /> : !data ? null : (
        <>
          <SectionHead title={`Drafts to review · ${data.drafts.length}`} hint="newest first · approve sends it as that agent, edit lets you change it first" />
          <div style={{ display: 'grid', gap: 10 }}>
            {data.drafts.length === 0 && <Note>Nothing waiting. When a customer writes in, the draft appears here.</Note>}
            {data.drafts.map((d) => <DraftCard key={d.actionId} d={d} busy={resolve.isPending} onResolve={(r, text) => resolve.mutate({ id: d.actionId, r, text })} />)}
          </div>

          <SectionHead title={`Handed to you · ${data.handed.length}`} hint="the agent stopped and wrote down why — you take it from here" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
            {data.handed.length === 0 && <Note>Nobody is waiting on a person.</Note>}
            {data.handed.map((h) => (
              <Panel key={h.leadFileId} style={{ display: 'grid', gap: 8, borderLeft: `4px solid ${C.danger}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Avatar name={h.lead.fullName} size={28} color={C.grey} /><b>{h.lead.fullName}</b><Tag tone="danger">{h.why.slice(0, 40) || 'needs a person'}</Tag><AgentChip agent={h.agent} prefix="from " /></div>
                <div style={{ fontSize: 13, color: C.second }}>
                  {needText(h.need) && <div><b style={{ color: C.ink }}>Needs:</b> {needText(h.need)}</div>}
                  {h.offers.length > 0 && <div><b style={{ color: C.ink }}>Offered:</b> {h.offers.map((o) => `${o.unitNumber} at AED ${o.monthlyPrice}/4 wk`).join('; ')}</div>}
                  {h.why && <div><b style={{ color: C.ink }}>Why:</b> {h.why}</div>}
                  {h.lastSummary && <div><b style={{ color: C.ink }}>Where it stands:</b> {h.lastSummary}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link to={`/agents/leads/${h.lead._id}`}><Button size="sm"><UserCheck size={13} /> Take over</Button></Link>
                  <Button size="sm" variant="outline" disabled={handBack.isPending} onClick={() => handBack.mutate(h.lead._id)}><Undo2 size={13} /> Hand back to {h.agent?.name || 'the agent'}</Button>
                </div>
              </Panel>
            ))}
          </div>

          <SectionHead title={`Follow-ups proposed · ${data.touches.length}`} hint="approved templates only — the words are already Meta-approved, only the name is filled in" />
          <div style={{ display: 'grid', gap: 8 }}>
            {data.touches.length === 0 && <Note>No follow-ups are due right now.</Note>}
            {data.touches.map((t) => <TouchRow key={t.actionId} t={t} busy={resolve.isPending} onResolve={(r) => resolve.mutate({ id: t.actionId, r })} />)}
          </div>
        </>
      )}
    </div>
  )
}
