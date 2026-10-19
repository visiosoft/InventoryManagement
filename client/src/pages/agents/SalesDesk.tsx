import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { agentsApi, type InboxDraft, type InboxHanded, type InboxTouch, type TeamAgent } from '../../lib/agentsApi'
import { Avatar } from './ui'
import FollowUpWeek from './FollowUpWeek'

/**
 * The AI Sales Desk: the agents' work on one screen of its own, opened from
 * its own link (/sales-desk) without the CRM around it. Numbers across the
 * top, the agents down the left, what needs a decision in the middle, and
 * the lead behind the selected item on the right.
 */

type Desk = {
  repliedToday: number; waiting: number; avgFirstReplyMin: number | null; sentAsWrittenPct: number | null
  quotationsToday: number; followUpsDueToday: number; autoSentToday: number; handedToday: number
}
type Item =
  | { kind: 'draft'; id: string; at: string; agent: InboxDraft['agent']; lead: InboxDraft['lead']; d: InboxDraft }
  | { kind: 'touch'; id: string; at: string; agent: InboxTouch['agent']; lead: InboxTouch['lead']; d: InboxTouch }
  | { kind: 'handed'; id: string; at: string; agent: InboxHanded['agent']; lead: InboxHanded['lead']; d: InboxHanded }

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#6B6478'
const LINE = '#E9E4F1'
const SOFT = '#F5F1FC'
const FONT = "'Inter', system-ui, sans-serif"

const MODE: Record<TeamAgent['mode'], { label: string; bg: string; fg: string }> = {
  shadow: { label: 'Draft', bg: '#EDE5FF', fg: '#5B2BC9' },
  auto: { label: 'Auto-send', bg: '#DCFCE7', fg: '#15803D' },
  off: { label: 'Off', bg: '#F1F1F4', fg: '#6B7280' },
}

const mins = (m: number | null) => (m == null ? '—' : m < 60 ? `${Math.floor(m)}m ${Math.round((m % 1) * 60)}s` : `${(m / 60).toFixed(1)}h`)
const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })

export default function SalesDesk() {
  const qc = useQueryClient()
  const [agentId, setAgentId] = useState<string>('')
  const [selected, setSelected] = useState<string>('')
  const [editing, setEditing] = useState<string>('')
  const [editText, setEditText] = useState('')
  const [err, setErr] = useState('')

  const { data: desk } = useQuery<Desk>({ queryKey: ['agents-desk'], queryFn: () => api.get('/agents/desk').then((r) => r.data), refetchInterval: 30_000 })
  const { data: team } = useQuery({ queryKey: ['agents-team'], queryFn: agentsApi.team, refetchInterval: 60_000 })
  const { data: inbox, isLoading } = useQuery({ queryKey: ['agents-inbox', 'desk'], queryFn: () => agentsApi.inbox(), refetchInterval: 20_000 })
  const { data: sizes = [] } = useQuery<{ sizeSqf: number; total: number; available: number }[]>({ queryKey: ['unit-sizes'], queryFn: () => api.get('/units/sizes').then((r) => r.data), staleTime: 5 * 60_000 })

  const items: Item[] = useMemo(() => {
    if (!inbox) return []
    const all: Item[] = [
      ...inbox.drafts.map((d) => ({ kind: 'draft' as const, id: d.actionId, at: d.at, agent: d.agent, lead: d.lead, d })),
      ...inbox.touches.map((d) => ({ kind: 'touch' as const, id: d.actionId, at: d.at, agent: d.agent, lead: d.lead, d })),
      ...inbox.handed.map((d) => ({ kind: 'handed' as const, id: d.leadFileId, at: d.at, agent: d.agent, lead: d.lead, d })),
    ]
    return all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [inbox])

  const pendingBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) if (it.agent?._id) m.set(it.agent._id, (m.get(it.agent._id) || 0) + 1)
    return m
  }, [items])

  const visible = agentId ? items.filter((it) => it.agent?._id === agentId) : items
  const current = visible.find((it) => it.id === selected) || visible[0]
  const counts = { drafts: inbox?.drafts.length ?? 0, touches: inbox?.touches.length ?? 0, handed: inbox?.handed.length ?? 0 }
  const needsYou = counts.drafts + counts.touches + counts.handed
  const agentName = agentId ? team?.agents.find((a) => a._id === agentId)?.name : ''

  const resolve = useMutation({
    mutationFn: (v: { id: string; resolution: 'approved' | 'edited' | 'skipped'; text?: string }) => agentsApi.resolve(v.id, v.resolution, v.text || ''),
    onSuccess: () => {
      setErr(''); setEditing('')
      qc.invalidateQueries({ queryKey: ['agents-inbox'] })
      qc.invalidateQueries({ queryKey: ['agents-desk'] })
    },
    onError: (e) => setErr(apiError(e)),
  })

  const kpi = (value: string | number, label: string, extra?: React.ReactNode, alert = false) => (
    <div style={{ padding: '8px 14px', borderRadius: 12, border: `1px solid ${alert ? '#FBCACA' : LINE}`, background: alert ? '#FEF2F2' : '#fff', minWidth: 104 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: alert ? '#DC2626' : INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: MUTED }}>{label}{extra}</div>
    </div>
  )

  const brief = [
    `${desk?.waiting ?? 0} customers waiting for a reply`,
    `${counts.drafts} drafts and ${counts.touches} follow-ups ready for your review`,
    counts.handed ? `${counts.handed} conversations handed over to you` : '',
    desk?.autoSentToday ? `${desk.autoSentToday} follow-ups sent by the agents on their own today` : '',
    desk ? `${desk.followUpsDueToday} follow-ups due today` : '',
  ].filter(Boolean)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#FBFAFE', fontFamily: FONT, color: INK }}>
      <style>{`
        .sd-body { display: grid; grid-template-columns: 270px minmax(0,1fr) 300px; flex: 1; min-height: 0; }
        .sd-col { overflow-y: auto; }
        @media (max-width: 1100px) { .sd-body { grid-template-columns: 230px minmax(0,1fr); } .sd-ctx { display: none; } }
        @media (max-width: 760px) { .sd-body { grid-template-columns: 1fr; } .sd-agents { display: none; } }
      `}</style>

      {/* Top bar */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: `1px solid ${LINE}`, background: '#fff', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8, flex: '0 0 auto' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: PURPLE, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800 }}>AI</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>AI Sales Desk</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>PurpleBox · {today()}</div>
          </div>
        </div>
        {kpi(desk?.repliedToday ?? '—', 'Replied today')}
        {kpi(desk?.waiting ?? '—', 'Leads waiting')}
        {kpi(mins(desk?.avgFirstReplyMin ?? null), 'Avg first reply · 7 days')}
        <div style={{ padding: '8px 14px', borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', minWidth: 190 }}>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{desk?.sentAsWrittenPct == null ? '—' : `${desk.sentAsWrittenPct}%`} <span style={{ fontSize: 11.5, fontWeight: 500, color: MUTED }}>sent as written · target 85%</span></div>
          <div style={{ position: 'relative', height: 5, borderRadius: 9, background: '#EEE9F7', marginTop: 5 }}>
            <div style={{ width: `${desk?.sentAsWrittenPct ?? 0}%`, height: '100%', borderRadius: 9, background: PURPLE }} />
            <div style={{ position: 'absolute', left: '85%', top: -3, width: 2, height: 11, background: INK }} />
          </div>
        </div>
        {kpi(desk?.quotationsToday ?? '—', 'Quotations today')}
        {kpi(needsYou, 'Needs you', undefined, needsYou > 0)}
        <span style={{ flex: 1 }} />
        <Link to="/agents" style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE, whiteSpace: 'nowrap' }}>Back to the CRM →</Link>
      </header>

      <div className="sd-body">
        {/* Agents */}
        <aside className="sd-col sd-agents" style={{ borderRight: `1px solid ${LINE}`, background: '#fff', padding: 14 }}>
          <button type="button" onClick={() => setAgentId('')}
            style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 14, padding: 14, color: '#fff', background: 'linear-gradient(135deg,#6D3BE0,#4A1FA0)', fontFamily: 'inherit', outline: !agentId ? '3px solid #D8C9FF' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>📌 Needs you</span>
              <span style={{ background: '#fff', color: PURPLE, borderRadius: 999, padding: '1px 10px', fontWeight: 800, fontSize: 13 }}>{needsYou}</span>
            </div>
            <div style={{ fontSize: 12, opacity: .9, marginTop: 4 }}>{counts.drafts} drafts · {counts.handed} handed over · {counts.touches} follow-ups</div>
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: MUTED, margin: '18px 4px 8px' }}>AGENTS</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {(team?.agents ?? []).map((a) => {
              const on = a._id === agentId
              const m = MODE[a.mode] ?? MODE.off
              const n = pendingBy.get(a._id) || 0
              return (
                <button key={a._id} type="button" onClick={() => { setAgentId(on ? '' : a._id); setSelected('') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: 10, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${on ? '#CDBBF5' : 'transparent'}`, background: on ? SOFT : 'transparent' }}>
                  <span style={{ position: 'relative' }}>
                    <Avatar name={a.name} color={a.avatarColor} size={38} />
                    <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 99, border: '2px solid #fff', background: a.mode === 'off' ? '#C4C4CC' : '#22C55E' }} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13.5 }}><b>{a.name}</b> <span style={{ color: MUTED, fontSize: 12 }}>· {a.role}</span></span>
                    <span style={{ display: 'block', fontSize: 11.5, color: MUTED }}>{n} pending · {a.leads.toLocaleString()} leads</span>
                    <span style={{ display: 'inline-block', marginTop: 3, fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: m.bg, color: m.fg }}>{m.label}</span>
                  </span>
                  {n > 0 && <span style={{ background: '#DC2626', color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 11.5, fontWeight: 700 }}>{n}</span>}
                </button>
              )
            })}
          </div>
          <Link to="/agents/team" style={{ display: 'block', marginTop: 14, fontSize: 12.5, color: PURPLE, fontWeight: 600 }}>Agent settings →</Link>
        </aside>

        {/* Work */}
        <main className="sd-col" style={{ padding: 18 }}>
          {!agentId && (
            <div style={{ borderRadius: 16, padding: '16px 20px', color: '#fff', background: 'linear-gradient(135deg,#7B4AE6,#5B2BC9)', marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>☀️ Briefing — {today()}</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>{brief.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          {agentId && team?.agents.find((a) => a._id === agentId)?.ownsBuckets.some((b) => b === 'quiet' || b === 'dormant') && (
            <FollowUpWeek agentId={agentId} />
          )}
          {agentName && <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>Showing {agentName}'s work · <button type="button" onClick={() => setAgentId('')} style={{ border: 0, background: 'none', color: PURPLE, cursor: 'pointer', fontWeight: 600, padding: 0 }}>show everyone</button></div>}
          {err && <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>{err}</div>}
          {isLoading && <div style={{ color: MUTED }}>Loading…</div>}
          {!isLoading && visible.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontWeight: 600 }}>Nothing waiting for you. 👍</div>}

          <div style={{ display: 'grid', gap: 12 }}>
            {visible.slice(0, 60).map((it) => {
              const on = current?.id === it.id
              return (
                <article key={it.id} onClick={() => setSelected(it.id)}
                  style={{ background: '#fff', borderRadius: 16, padding: 16, cursor: 'pointer', border: `${on ? 2 : 1}px solid ${on ? '#8B5CF6' : LINE}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: MUTED, marginBottom: 8 }}>
                    <b style={{ color: INK, fontSize: 14 }}>{it.lead?.fullName || 'Lead'}</b>
                    <span>{it.agent?.name} · {it.kind === 'draft' ? 'Draft reply' : it.kind === 'touch' ? 'Follow-up template' : 'Handed to you'}</span>
                  </div>

                  {it.kind === 'draft' && (
                    <>
                      {it.d.customerText && <div style={{ display: 'inline-block', background: '#F3F2F7', borderRadius: 12, padding: '8px 12px', fontSize: 14, marginBottom: 8 }}>{it.d.customerText}</div>}
                      {editing === it.id
                        ? <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} onClick={(e) => e.stopPropagation()} style={{ width: '100%', borderRadius: 12, border: `1px solid #CDBBF5`, padding: 10, fontSize: 14, fontFamily: 'inherit' }} />
                        : <div style={{ background: SOFT, border: '1px solid #E4D9FF', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}>{it.d.reply || <i style={{ color: MUTED }}>No reply drafted</i>}</div>}
                      {it.d.summary && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>💡 {it.d.summary}</div>}
                    </>
                  )}
                  {it.kind === 'touch' && (
                    <>
                      <div style={{ background: SOFT, border: '1px solid #E4D9FF', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}>
                        {it.d.template ? <><b>{it.d.template.name}</b>{it.d.template.bodyText ? <div style={{ marginTop: 4 }}>{it.d.template.bodyText}</div> : null}</> : <i style={{ color: MUTED }}>No template chosen</i>}
                      </div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>💡 {it.d.stage} · {it.d.bucketLabel}{it.d.summary ? ` · ${it.d.summary}` : ''}</div>
                    </>
                  )}
                  {it.kind === 'handed' && (
                    <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}>
                      <b>Why:</b> {it.d.why || 'Needs a person'}
                      {it.d.lastSummary && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{it.d.lastSummary}</div>}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    {it.kind === 'handed' ? (
                      <Link to={`/leads/${it.lead?._id}`} style={btn(true)}>Open the lead</Link>
                    ) : editing === it.id ? (
                      <>
                        <button type="button" disabled={resolve.isPending || !editText.trim()} onClick={() => resolve.mutate({ id: it.id, resolution: 'edited', text: editText })} style={btn(true)}>Send edited</button>
                        <button type="button" onClick={() => setEditing('')} style={btn(false)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: it.id, resolution: 'approved' })} style={btn(true)}>Send</button>
                        {it.kind === 'draft' && <button type="button" onClick={() => { setEditing(it.id); setEditText(it.d.reply || '') }} style={btn(false)}>Edit</button>}
                        <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: it.id, resolution: 'skipped' })} style={btn(false)}>Skip</button>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </main>

        {/* Lead context */}
        <aside className="sd-col sd-ctx" style={{ borderLeft: `1px solid ${LINE}`, background: '#fff', padding: 18 }}>
          {current ? (() => {
            const need = current.kind === 'handed' ? current.d.need : current.d.need
            const temp = current.lead?.temperature
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: MUTED }}>LEAD CONTEXT</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{current.lead?.fullName}</div>
                <div style={{ fontSize: 12.5, color: MUTED }}>{current.lead?.phone}</div>
                {temp && <span style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: temp === 'hot' ? '#FEE2E2' : temp === 'cold' ? '#E0F2FE' : '#FEF3C7', color: temp === 'hot' ? '#B91C1C' : temp === 'cold' ? '#0369A1' : '#B45309' }}>{temp[0].toUpperCase() + temp.slice(1)}</span>}
                <dl style={{ margin: '14px 0 0', fontSize: 13.5 }}>
                  {([
                    ['Size', need?.sizeSqf ? `${need.sizeSqf} sq ft` : 'Not sure yet'],
                    ['Needs from', need?.moveIn || '—'],
                    ['Storing', need?.storing || '—'],
                    ['Agent', current.agent?.name || '—'],
                    ['Stage', current.kind === 'handed' ? 'With a person' : `${current.d.bucketLabel} · ${current.d.stage}`],
                  ] as const).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
                      <dt style={{ color: MUTED }}>{k}</dt><dd style={{ margin: 0, fontWeight: 700, textAlign: 'right' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div style={{ marginTop: 16, background: '#F8F6FC', borderRadius: 14, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Unit availability</div>
                  {sizes.slice(0, 8).map((s) => (
                    <div key={s.sizeSqf} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span>{s.sizeSqf} sq ft</span>
                      <b style={{ color: s.available > 0 ? '#15803D' : '#DC2626' }}>{s.available > 0 ? `${s.available} free` : 'Full'}</b>
                    </div>
                  ))}
                  {!sizes.length && <div style={{ fontSize: 12.5, color: MUTED }}>No unit data.</div>}
                </div>
                <Link to={`/leads/${current.lead?._id}`} style={{ ...btn(true), display: 'block', textAlign: 'center', marginTop: 14 }}>Open the lead</Link>
                <Link to={`/quotes/new?lead=${current.lead?._id}`} style={{ ...btn(false), display: 'block', textAlign: 'center', marginTop: 8 }}>Make a quotation</Link>
              </>
            )
          })() : <div style={{ color: MUTED, fontSize: 13 }}>Select an item to see the lead.</div>}
        </aside>
      </div>
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: primary ? 'none' : `1px solid ${LINE}`, background: primary ? PURPLE : '#fff', color: primary ? '#fff' : INK,
    textDecoration: 'none', lineHeight: '34px',
  }
}
