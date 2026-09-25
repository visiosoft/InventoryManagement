import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { BUCKET_TONE, agentColor, type Bucket, type Decision } from '../../lib/agentsApi'

export const C = {
  ink: '#14081F', second: '#4A4357', muted: '#756E80', line: '#E6E0F0', page: '#FAF7F2', card: '#FFFFFF',
  purple: '#5B2BC9', purpleSoft: '#EFE7FB', ok: '#1B7A4B', okSoft: '#EAF7EF', danger: '#C22A2A', dangerSoft: '#FBEAEA',
  amber: '#B45309', amberSoft: '#FEF3C7', blue: '#1D4ED8', blueSoft: '#DBEAFE', grey: '#374151', greySoft: '#F3F4F6',
}
export const DISPLAY = "'Bricolage Grotesque', 'Plus Jakarta Sans', system-ui, sans-serif"

const TONES: Record<string, { bg: string; fg: string }> = {
  purple: { bg: C.purpleSoft, fg: C.purple }, blue: { bg: C.blueSoft, fg: C.blue }, amber: { bg: C.amberSoft, fg: C.amber },
  ok: { bg: C.okSoft, fg: C.ok }, danger: { bg: C.dangerSoft, fg: C.danger }, grey: { bg: C.greySoft, fg: C.grey },
}

export function Tag({ tone = 'grey', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone]
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: t.bg, color: t.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
}

export function Pill({ bucket, label }: { bucket: Bucket; label?: string }) {
  const t = BUCKET_TONE[bucket]
  return <span style={{ display: 'inline-flex', background: t.bg, color: t.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{label || bucket}</span>
}

export function Avatar({ name, color, size = 36 }: { name?: string; color?: string; size?: number }) {
  const initials = (name || '?').split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const c = color || agentColor({ name })
  return (
    <span style={{ width: size, height: size, borderRadius: 999, background: `linear-gradient(135deg, ${c}, ${c}AA)`, color: '#fff', display: 'inline-grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: Math.round(size * 0.4), flex: 'none' }}>{initials}</span>
  )
}

export function AgentChip({ agent, prefix = '' }: { agent?: { name?: string; avatarColor?: string } | null; prefix?: string }) {
  if (!agent?.name) return null
  return <span style={{ fontSize: 12, color: C.muted }}>{prefix}<b style={{ color: agentColor(agent) }}>{agent.name}</b></span>
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      <b style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, lineHeight: 1, color: tone || C.ink }}>{value}</b>
      <span style={{ fontSize: 11.5, color: C.muted }}>{label}</span>
    </span>
  )
}

export function SectionHead({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '22px 0 10px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, margin: 0, color: C.ink }}>{title}</h2>
        {hint && <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>}
      </div>
      {action}
    </div>
  )
}

export function Eyebrow({ children, tone }: { children: ReactNode; tone?: string }) {
  return <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: tone || C.muted, fontWeight: 700, marginBottom: 8 }}>{children}</div>
}

export function Panel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px', ...style }}>{children}</div>
}

export function Trace({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div style={{ fontSize: 12, color: C.muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map((t, i) => <span key={i}>{i > 0 && <span style={{ marginRight: 8, opacity: .5 }}>·</span>}{t}</span>)}
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12, color: C.muted, marginTop: 10, marginBottom: 0 }}>{children}</p>
}

export function Quote({ children }: { children: ReactNode }) {
  return <div style={{ borderLeft: `3px solid ${C.line}`, paddingLeft: 10, color: C.second, fontSize: 13, whiteSpace: 'pre-line' }}>{children}</div>
}

export function Draft({ children }: { children: ReactNode }) {
  return <div style={{ background: C.okSoft, border: '1px solid #BFE5CC', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: C.ink, whiteSpace: 'pre-line' }}>{children}</div>
}

export function AgentNav({ counts }: { counts?: { inbox?: number } }) {
  const item = (to: string, label: string, badge?: number) => (
    <NavLink to={to} end={to === '/agents'} style={({ isActive }) => ({
      textDecoration: 'none', fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999,
      background: isActive ? C.ink : 'transparent', color: isActive ? '#F5EE8F' : C.second, border: `1px solid ${isActive ? C.ink : C.line}`,
    })}>
      {label}{badge ? <span style={{ marginLeft: 6, background: C.purple, color: '#fff', borderRadius: 999, padding: '0 6px', fontSize: 10.5 }}>{badge}</span> : null}
    </NavLink>
  )
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>{item('/agents', 'Needs you', counts?.inbox)}{item('/agents/pipeline', 'Pipeline')}{item('/agents/team', 'Team')}</div>
}

/** What an agent decided, laid out so a person can judge it in ten seconds. */
export function DecisionView({ d, agentName }: { d: Decision; agentName?: string }) {
  const toolLine = (c: Decision['toolCalls'][number]) => {
    const r = c.result as Record<string, unknown> | null
    if (c.name === 'units_available' && r && typeof r.count === 'number') return `Looked up availability → ${r.count} free`
    if (c.name === 'price_booking' && r && typeof r.total === 'number') return `Priced the booking → AED ${r.total}`
    if (c.name === 'update_lead_file') return 'Wrote to the lead file'
    if (c.name === 'note_offer') return `Noted the offer ${String((c.args as { unitNumber?: string }).unitNumber || '')}`
    if (c.name === 'escalate') return 'Asked for a person'
    if (c.name === 'propose_follow_up_template') return `Chose template ${String((c.args as { templateName?: string }).templateName || '')}`
    if (c.name === 'move_bucket') return `Moved the bucket (${String((c.args as { event?: string }).event || '')})`
    return c.name
  }
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: C.card, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ color: C.muted }}>{agentName ? `${agentName} · ` : ''}instructions v{d.promptVersion} · {d.model}{d.usage?.total_tokens ? ` · ${d.usage.total_tokens} tokens` : ''}</span>
        <Pill bucket={d.bucketBefore} />
        {d.bucketAfter !== d.bucketBefore && <><span style={{ color: C.muted }}>→</span><Pill bucket={d.bucketAfter} /></>}
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: d.needsHuman ? C.danger : C.ok }}>{d.needsHuman ? 'Hands to a person' : 'Would act on its own'}</span>
      </div>
      {d.trigger === 'inbound' && (
        <div><Eyebrow>Would reply — shadow, not sent</Eyebrow><Draft>{d.reply || <i style={{ color: C.muted }}>no reply drafted</i>}</Draft></div>
      )}
      {d.trigger === 'touch' && (
        <div><Eyebrow>Would send — shadow, not sent</Eyebrow>
          <div style={{ fontSize: 13.5 }}>{d.template ? <><b>{d.template.name}</b> — {d.template.intent}{d.template.bodyText ? <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4 }}>"{d.template.bodyText}"</div> : null}</> : <i style={{ color: C.muted }}>no approved template chosen</i>}</div>
        </div>
      )}
      <Trace items={d.toolCalls.map(toolLine)} />
      {d.reason && <div style={{ fontSize: 13, color: d.needsHuman ? C.danger : C.muted }}><b>Why:</b> {d.reason}</div>}
      {d.summary && <div style={{ fontSize: 13, color: C.muted }}><b>Where this lead stands:</b> {d.summary}</div>}
      {!d.grounded.ok && <div style={{ fontSize: 12.5, color: C.danger }}>Figures not backed by any tool result: {d.grounded.loose.join(', ')}</div>}
      {d.toolCalls.length > 0 && (
        <details><summary style={{ cursor: 'pointer', fontSize: 12, color: C.purple, fontWeight: 600 }}>technical</summary>
          <pre style={{ fontSize: 11, background: C.page, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, overflowX: 'auto', margin: '6px 0 0', maxHeight: 280 }}>{JSON.stringify(d.toolCalls, null, 1).slice(0, 5000)}</pre>
        </details>
      )}
    </div>
  )
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—')
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
