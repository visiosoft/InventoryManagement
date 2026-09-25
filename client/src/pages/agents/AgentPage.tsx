import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { agentsApi, agentColor, agoText, type Bucket } from '../../lib/agentsApi'
import { Button, PageHeader, Spinner } from '../../components/ui'
import { AgentNav, Avatar, C, Eyebrow, Note, Panel, Pill, Stat, Tag } from './ui'

export default function AgentPage() {
  const { agentId = '' } = useParams()
  const team = useQuery({ queryKey: ['agents', 'team'], queryFn: agentsApi.team })
  const inbox = useQuery({ queryKey: ['agents', 'inbox', agentId], queryFn: () => agentsApi.inbox(agentId), enabled: Boolean(agentId) })
  const a = team.data?.agents.find((x) => x._id === agentId)
  if (team.isLoading) return <Spinner />
  if (!a) return <div><AgentNav /><Note>No such agent.</Note></div>
  const esc = typeof a.escalateTo === 'object' && a.escalateTo ? a.escalateTo.name : 'nobody yet'
  const t = a.today
  const items = inbox.data ? [...inbox.data.drafts.map((d) => ({ at: d.at, text: `drafted a reply to ${d.lead.fullName}`, tag: d.needsHuman ? 'check' : 'draft', lead: d.lead._id })), ...inbox.data.touches.map((x) => ({ at: x.at, text: `proposed ${x.template?.name || 'a follow-up'} to ${x.lead.fullName}`, tag: 'proposed', lead: x.lead._id })), ...inbox.data.handed.map((h) => ({ at: h.at, text: `handed ${h.lead.fullName} to a person — ${h.why}`, tag: 'hand-over', lead: h.lead._id }))].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()) : []

  return (
    <div>
      <AgentNav />
      <PageHeader
        title={a.name}
        subtitle={<span><Tag tone={a.mode === 'off' ? 'grey' : 'amber'}>{a.mode === 'off' ? 'off duty' : 'shadow'}</Tag> {a.role} · owns {a.ownsBuckets.map((b) => b === 'tenant' ? <Tag key={b} tone="grey">existing customers</Tag> : <Pill key={b} bucket={b as Bucket} />)} · instructions v{a.promptVersion} · {a.model || 'server model'} · hands over to {esc}</span>}
        action={<Link to={`/agents/profiles/${a._id}`}><Button size="sm" variant="outline"><Pencil size={13} /> Edit</Button></Link>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12 }} className="agent-page-grid">
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><Eyebrow>Today</Eyebrow><Avatar name={a.name} color={agentColor(a)} size={34} /></div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Stat value={a.leads} label="leads in its care" />
            <Stat value={t.drafts} label="drafts written" />
            <Stat value={t.approved} label="approved as written" tone={C.ok} />
            <Stat value={t.edited} label="edited first" tone={C.amber} />
            <Stat value={t.dismissed} label="dismissed" />
            <Stat value={t.handed} label="handed to a person" />
            <Stat value={t.proposed} label="follow-ups proposed" />
          </div>
          <Note>{t.approvedRate === null ? 'Approval rate shows once a person has answered a draft today.' : `${t.approvedRate}% of today's answered drafts went out as written. When this holds above 85% for two weeks, that is the signal to move FAQ and pricing replies to live.`}</Note>
        </Panel>
        <Panel>
          <Eyebrow>Waiting on a person</Eyebrow>
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Drafts to review</span><b>{inbox.data?.drafts.length ?? '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Follow-ups proposed</span><b>{inbox.data?.touches.length ?? '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Handed over</span><b>{inbox.data?.handed.length ?? '—'}</b></div>
          </div>
          <Note><Link to="/agents" style={{ color: C.purple, fontWeight: 700 }}>Open Needs you</Link> filtered to {a.name}.</Note>
        </Panel>
      </div>
      <Panel style={{ marginTop: 12 }}>
        <Eyebrow>What is waiting, newest first</Eyebrow>
        <div style={{ display: 'grid', gap: 8 }}>
          {items.length === 0 && <Note>Nothing waiting on a person right now.</Note>}
          {items.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 10, fontSize: 13, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: C.muted }}>{agoText(it.at)}</span>
              <Link to={`/agents/leads/${it.lead}`} style={{ color: C.ink, textDecoration: 'none' }}><b style={{ color: agentColor(a) }}>{a.name}</b> {it.text}</Link>
              <Tag tone={it.tag === 'hand-over' ? 'danger' : it.tag === 'check' ? 'amber' : it.tag === 'proposed' ? 'amber' : 'ok'}>{it.tag}</Tag>
            </div>
          ))}
        </div>
      </Panel>
      <style>{`@media (max-width: 860px) { .agent-page-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}
