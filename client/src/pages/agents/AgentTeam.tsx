import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Pencil, PlayCircle } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, agentColor, agoText, type Bucket, type TeamAgent } from '../../lib/agentsApi'
import { Button, PageHeader, Spinner } from '../../components/ui'
import { AgentNav, Avatar, C, Eyebrow, Note, Panel, Pill, Stat, Tag } from './ui'

const escName = (a: TeamAgent) => (typeof a.escalateTo === 'object' && a.escalateTo ? a.escalateTo.name : '')

export default function AgentTeam() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents', 'team'], queryFn: agentsApi.team })
  const toggle = useMutation({
    mutationFn: (a: TeamAgent) => agentsApi.updateProfile(a._id, { mode: a.mode === 'off' ? 'shadow' : 'off' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: (e) => alert(apiError(e)),
  })
  const seed = useMutation({
    mutationFn: agentsApi.seedTeam,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: (e) => alert(apiError(e)),
  })
  const run = useMutation({
    mutationFn: (id: string) => agentsApi.run(id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['agents'] }); alert(`Done: ${r.sorted} sorted, ${r.drafts} draft${r.drafts === 1 ? '' : 's'} waiting in Needs you.`) },
    onError: (e) => alert(apiError(e)),
  })
  const agents = data?.agents.filter((a) => a.isActive) || []
  const buckets = data?.buckets || []
  const ownerOf = (b: string) => agents.find((a) => a.mode !== 'off' && a.ownsBuckets.includes(b as Bucket))
  const defaultAgent = agents.find((a) => a.isDefault && a.mode !== 'off') || agents.find((a) => a.mode !== 'off')

  return (
    <div>
      <AgentNav />
      <PageHeader title="The team" subtitle="One lead is owned by one agent at a time. Work moves between them at bucket boundaries, and every handoff is logged."
        action={<Link to="/agents/profiles/new"><Button size="sm"><Plus size={13} /> Onboard an agent</Button></Link>} />
      {isLoading ? <Spinner /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {agents.length === 0 && (
              <Panel style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <b>No agents yet.</b>
                <span style={{ fontSize: 13, color: C.second }}>Start with the four-agent team — Aisha answers first, Omar follows up, Layla closes, Sam looks after tenants — each with its job and permissions already set. Or onboard one from scratch.</span>
                <div><Button size="sm" disabled={seed.isPending} onClick={() => seed.mutate()}>{seed.isPending ? 'Adding…' : 'Add the starter team'}</Button></div>
              </Panel>
            )}
            {agents.map((a) => (
              <Panel key={a._id} style={{ display: 'grid', gap: 8, borderTop: `4px solid ${agentColor(a)}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar name={a.name} color={agentColor(a)} size={30} /><b>{a.name}</b></div>
                  <button onClick={() => toggle.mutate(a)} title={a.mode === 'off' ? 'Put on duty (shadow)' : 'Take off duty'} style={{ width: 36, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', background: a.mode === 'off' ? C.line : C.purple, position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 2, [a.mode === 'off' ? 'left' : 'right']: 2, width: 16, height: 16, borderRadius: 999, background: '#fff' }} />
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: C.second }}><b style={{ color: C.ink }}>{a.role || 'No role yet'}</b>{a.kind === 'scheduled' ? <> · <Tag tone="grey">{a.scheduleText}</Tag>{a.lastRunAt ? <span style={{ color: C.muted }}> · last ran {agoText(a.lastRunAt)}</span> : null}</> : a.ownsBuckets.length ? <> · owns {a.ownsBuckets.map((b) => b === 'tenant' ? <Tag key={b} tone="grey">existing customers</Tag> : <Pill key={b} bucket={b} label={buckets.find((x) => x.key === b)?.label} />)}</> : <> · owns nothing yet</>}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{[a.languages.length ? a.languages.join(', ') : '', escName(a) ? `hands to ${escName(a)}` : 'hands to nobody yet', a.isDefault ? 'default' : ''].filter(Boolean).join(' · ')}</div>
                <div style={{ display: 'flex', gap: 14 }}>
                  <Stat value={a.leads} label="leads" />
                  <Stat value={a.today.drafts + a.today.proposed} label="drafted today" />
                  <Stat value={a.today.approvedRate === null ? '—' : `${a.today.approvedRate}%`} label="approved as is" tone={a.today.approvedRate !== null && a.today.approvedRate >= 85 ? C.ok : undefined} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Tag tone={a.mode === 'off' ? 'grey' : 'amber'}>{a.mode === 'off' ? 'off duty' : 'shadow'} · v{a.promptVersion}</Tag>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {a.kind === 'scheduled' && a.mode !== 'off' && <button onClick={() => run.mutate(a._id)} disabled={run.isPending} title="Run now" style={{ border: 'none', background: 'transparent', color: C.purple, cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, fontWeight: 700, padding: '4px 6px' }}><PlayCircle size={13} /> {run.isPending ? 'Running…' : 'Run now'}</button>}
                    <Link to={`/agents/${a._id}`} style={{ fontSize: 12, color: C.purple, fontWeight: 700, textDecoration: 'none', padding: '4px 6px' }}>Open →</Link>
                    <Link to={`/agents/profiles/${a._id}`} style={{ fontSize: 12, color: C.muted, textDecoration: 'none', padding: '4px 6px', display: 'inline-flex', gap: 4, alignItems: 'center' }}><Pencil size={11} /> Edit</Link>
                  </div>
                </div>
              </Panel>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 14 }}>
            <Panel>
              <Eyebrow>Routing rules · first match wins · decides the first owner</Eyebrow>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <div style={{ padding: '8px 12px', border: `1px solid ${C.line}`, borderRadius: 10 }}><b>1 · Already a tenant</b><div style={{ fontSize: 12, color: C.muted }}>→ {ownerOf('tenant')?.name || 'no tenants agent on duty → falls through'}</div></div>
                {agents.filter((a) => a.mode !== 'off' && (a.languages.length)).map((a) => (
                  <div key={`l-${a._id}`} style={{ padding: '8px 12px', border: `1px solid ${C.line}`, borderRadius: 10 }}><b>Writes in {a.languages.join(' or ')}</b><div style={{ fontSize: 12, color: C.muted }}>→ {a.name}</div></div>
                ))}
                <div style={{ padding: '8px 12px', border: `1px solid ${C.line}`, borderRadius: 10 }}><b>Everything else</b><div style={{ fontSize: 12, color: C.muted }}>→ {ownerOf('new')?.name || defaultAgent?.name || 'nobody on duty'}{ownerOf('new') ? ' (owns New)' : defaultAgent ? ' (default)' : ''}</div></div>
              </div>
              <Note>Rules only choose the first owner. After that, ownership follows the buckets — and stays put when a lead comes back to Engaged. Edit an agent to change its numbers, languages or buckets.</Note>
            </Panel>
            <Panel>
              <Eyebrow>Who owns which bucket</Eyebrow>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                {(['new', 'engaged', 'quoted', 'booking', 'quiet', 'dormant'] as Bucket[]).map((b) => (
                  <div key={b} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Pill bucket={b} label={buckets.find((x) => x.key === b)?.label} /><b style={{ color: ownerOf(b) ? agentColor(ownerOf(b)) : C.muted }}>{ownerOf(b)?.name || 'nobody — stays with the current owner'}</b></div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Tag tone="grey">existing customers</Tag><b style={{ color: ownerOf('tenant') ? agentColor(ownerOf('tenant')) : C.muted }}>{ownerOf('tenant')?.name || 'nobody'}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Pill bucket="with_person" label="With a person" /><b>the person</b></div>
              </div>
              <div style={{ height: 14 }} />
              <Eyebrow>Daily budgets</Eyebrow>
              <div style={{ fontSize: 12.5, color: C.second }}>{agents.map((a) => `${a.name} ${a.dailyBudgetAed ? `AED ${a.dailyBudgetAed}` : 'no cap'}`).join(' · ') || '—'}</div>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
