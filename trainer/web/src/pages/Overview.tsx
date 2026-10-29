import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MessagesSquare, Layers, CheckCircle2, Rocket, FlaskConical, ArrowUpRight, ArrowDownRight, ArrowRight, Check, Pencil, X, CornerUpRight, Upload, KeyRound, Users, Plug, FileCheck2, type LucideIcon } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { type Me, INK, MUTED, ACCENT, SERIES, panel } from './theme'
import { Pill } from './shared'

/* The dashboard: where training stands, what moved this week, and what to
   look at next. Every figure and line is the organisation's own record —
   nothing here is illustrative. */

type Day = { day: string; questions: number; approved: number; edited: number; rejected: number; escalated: number }
type Activity = { _id: string; by?: { name?: string }; action: string; target?: string; detail?: Record<string, unknown>; at: string }
type QueueItem = { _id: string; name: string; question: string; count: number; category: string; status: string; createdAt: string }
type OverviewData = {
  questions: number; holdout: number; intents: number; review: Record<string, number>; knowledge: Record<string, number>
  edited: number; conflicts: number; activeSnapshot: number; snapshots: number; openFeedback: number
  evals: { label: string; createdAt: string; summary: { mean: number | null; checksPassed: number; completed: number } }[]
  trend: Day[]; activity: Activity[]; queue: QueueItem[]; top: { _id: string; name: string; count: number; status: string; category: string }[]
  testTrend: { at: string; mean: number | null }[]
}

const sum = (rows: Day[], f: (d: Day) => number) => rows.reduce((n, d) => n + f(d), 0)
const decided = (d: Day) => d.approved + d.edited + d.rejected + d.escalated
/** This week against the week before, as a % change; null when there is nothing to compare. */
function weekChange(trend: Day[], f: (d: Day) => number) {
  const now = sum(trend.slice(-7), f); const before = sum(trend.slice(-14, -7), f)
  if (!before) return now ? { text: `${now} this week`, up: true } : null
  const pct = Math.round(((now - before) / before) * 100)
  return { text: `${Math.abs(pct)}% vs last week`, up: pct >= 0 }
}
const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const short = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function Spark({ data, color }: { data: { v: number }[]; color: string }) {
  if (!data.some((d) => d.v)) return <div style={{ height: 44 }} />
  const id = `sp${color.slice(1)}`
  return (
    <div style={{ height: 44, marginTop: 6 }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Kpi({ icon: Icon, tint, color, label, value, unit, change, spark, to }: { icon: LucideIcon; tint: string; color: string; label: string; value: ReactNode; unit?: string; change?: { text: string; up: boolean } | null; spark: { v: number }[]; to: string }) {
  return (
    <Link to={to} className="block" style={{ ...panel, padding: '16px 16px 10px' }}>
      <div className="flex items-center gap-2.5">
        <span style={{ width: 34, height: 34, borderRadius: 10, background: tint, display: 'grid', placeItems: 'center' }}><Icon size={17} color={color} strokeWidth={2} /></span>
        <span className="truncate" style={{ fontSize: 13.5, color: '#334155', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: INK, letterSpacing: '-.02em', marginTop: 12, lineHeight: 1 }}>{value}{unit && <span style={{ fontSize: 18, fontWeight: 600, marginLeft: 4 }}>{unit}</span>}</div>
      <div className="flex items-center gap-1" style={{ fontSize: 12.5, color: MUTED, marginTop: 8, minHeight: 18 }}>
        {change ? <>{change.up ? <ArrowUpRight size={14} color="#16A34A" /> : <ArrowDownRight size={14} color="#DC2626" />}<span>{change.text}</span></> : <span>&nbsp;</span>}
      </div>
      <Spark data={spark} color={color} />
    </Link>
  )
}

const Card = ({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={className} style={{ ...panel, padding: 20 }}>
    <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 15.5, fontWeight: 600, color: INK, margin: 0 }}>{title}</h2>
      <div className="flex-1" />{action}
    </div>
    {children}
  </section>
)
const ViewAll = ({ to, label = 'View all' }: { to: string; label?: string }) => <Link to={to} style={{ fontSize: 12.5, fontWeight: 600, color: ACCENT, border: '1px solid rgba(37,99,235,.18)', borderRadius: 9, padding: '5px 11px', background: '#fff' }}>{label}</Link>

const ACTION: Record<string, { label: string; icon: LucideIcon; color: string; bg: string }> = {
  'review.approve': { label: 'Answer approved', icon: Check, color: '#16A34A', bg: '#DCFCE7' },
  'review.edit': { label: 'Answer edited and approved', icon: Pencil, color: '#2563EB', bg: '#DBEAFE' },
  'review.save_new': { label: 'New answer saved', icon: Check, color: '#16A34A', bg: '#DCFCE7' },
  'review.reject': { label: 'Suggestion rejected', icon: X, color: '#DC2626', bg: '#FEE2E2' },
  'review.escalate': { label: 'Sent to a person', icon: CornerUpRight, color: '#D97706', bg: '#FEF3C7' },
  'review.bulk_approve': { label: 'Low-risk answers approved', icon: Check, color: '#16A34A', bg: '#DCFCE7' },
  'import.start': { label: 'Conversations imported', icon: Upload, color: '#7C3AED', bg: '#EDE9FE' },
  publish: { label: 'Answers published', icon: Rocket, color: '#2563EB', bg: '#DBEAFE' },
  rollback: { label: 'Rolled back', icon: CornerUpRight, color: '#D97706', bg: '#FEF3C7' },
  'eval.start': { label: 'Test started', icon: FlaskConical, color: '#0891B2', bg: '#CFFAFE' },
  'knowledge.edit': { label: 'Answer updated', icon: Pencil, color: '#2563EB', bg: '#DBEAFE' },
  'knowledge.archive': { label: 'Answer archived', icon: X, color: '#64748B', bg: '#F1F5F9' },
  'key.create': { label: 'API key created', icon: KeyRound, color: '#64748B', bg: '#F1F5F9' },
  'invite.create': { label: 'Teammate invited', icon: Users, color: '#64748B', bg: '#F1F5F9' },
  'connector.set': { label: 'System connected', icon: Plug, color: '#64748B', bg: '#F1F5F9' },
}
const actionOf = (a: string) => ACTION[a] ?? { label: a.replace(/[._]/g, ' '), icon: FileCheck2, color: '#64748B', bg: '#F1F5F9' }

const LINES: { key: keyof Day; label: string }[] = [
  { key: 'approved', label: 'Approved' }, { key: 'edited', label: 'Edited' }, { key: 'rejected', label: 'Rejected' }, { key: 'escalated', label: 'To a person' },
]

export default function Overview() {
  const { me } = useOutletContext<{ me: Me }>()
  const { user } = useSession()
  const [range, setRange] = useState(14)
  const { data } = useQuery<OverviewData>({ queryKey: ['overview', me.org.id], queryFn: () => api.get('/training/overview').then((r) => r.data) })
  const first = (user?.name || '').split(' ')[0]
  if (!data) return <div style={{ color: MUTED }}>Loading…</div>

  const t = data.trend ?? []
  const toReview = (data.review.new ?? 0) + (data.review.suggested ?? 0)
  const approved = (data.knowledge.approved ?? 0) + (data.knowledge.published ?? 0)
  const last = data.evals[0]
  const chart = t.slice(-range)
  const donut = [
    { name: 'Live', value: data.knowledge.published ?? 0, color: '#2563EB' },
    { name: 'Approved, to publish', value: data.knowledge.approved ?? 0, color: '#22C55E' },
    { name: 'Sent to a person', value: data.review.escalated ?? 0, color: '#F59E0B' },
    { name: 'To review', value: toReview, color: '#CBD5E1' },
  ]
  const donutTotal = donut.reduce((n, d) => n + d.value, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-.02em' }}>Welcome back{first ? `, ${first}` : ''} <span aria-hidden>👋</span></h1>
        <p style={{ fontSize: 14.5, color: MUTED, margin: '6px 0 0' }}>Here's how {me.org.name}'s AI training is going today.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi to="/imports" icon={MessagesSquare} tint="#EEF2FF" color="#6366F1" label="Questions imported" value={data.questions.toLocaleString()} change={weekChange(t, (d) => d.questions)} spark={t.map((d) => ({ v: d.questions }))} />
        <Kpi to="/review" icon={Layers} tint="#F3E8FF" color="#9333EA" label="Common questions" value={data.intents} change={toReview ? { text: `${toReview} waiting for review`, up: true } : null} spark={t.map((d) => ({ v: decided(d) }))} />
        <Kpi to="/answers" icon={CheckCircle2} tint="#DCFCE7" color="#16A34A" label="Approved answers" value={approved} change={weekChange(t, (d) => d.approved + d.edited)} spark={t.map((d) => ({ v: d.approved + d.edited }))} />
        <Kpi to="/answers" icon={Rocket} tint="#FFEDD5" color="#EA580C" label="Live for agents" value={data.activeSnapshot ? `v${data.activeSnapshot}` : '—'} change={(data.knowledge.approved ?? 0) ? { text: `${data.knowledge.approved} to publish`, up: true } : null} spark={[]} />
        <Kpi to="/tests" icon={FlaskConical} tint="#CCFBF1" color="#0D9488" label="Test grade" value={last?.summary?.mean != null ? last.summary.mean : '—'} unit={last?.summary?.mean != null ? '/5' : undefined}
          change={data.testTrend.length >= 2 && data.testTrend.at(-1)!.mean != null && data.testTrend.at(-2)!.mean != null ? { text: `${Math.abs(Math.round((data.testTrend.at(-1)!.mean! - data.testTrend.at(-2)!.mean!) * 100) / 100)} vs last test`, up: data.testTrend.at(-1)!.mean! >= data.testTrend.at(-2)!.mean! } : null}
          spark={data.testTrend.map((x) => ({ v: x.mean ?? 0 }))} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <Card title="Review activity" action={
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Period" style={{ border: '1px solid rgba(15,23,42,.1)', borderRadius: 10, padding: '6px 10px', fontSize: 13, background: '#fff', color: INK }}>
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>}>
          <div className="flex flex-wrap gap-4" style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>
            {LINES.map((l) => <span key={l.key} className="flex items-center gap-1.5"><span style={{ width: 14, height: 4, borderRadius: 9, background: SERIES[l.key as keyof typeof SERIES] }} />{l.label}</span>)}
          </div>
          <div style={{ height: 260 }}>
            {chart.some(decided) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                  <defs>{LINES.map((l) => <linearGradient key={l.key} id={`g-${l.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES[l.key as keyof typeof SERIES]} stopOpacity={0.22} /><stop offset="100%" stopColor={SERIES[l.key as keyof typeof SERIES]} stopOpacity={0} /></linearGradient>)}</defs>
                  <CartesianGrid stroke="rgba(15,23,42,.06)" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={short} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <Tooltip labelFormatter={(d) => short(String(d))} contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,23,42,.08)', boxShadow: '0 10px 30px -12px rgba(15,23,42,.25)', fontSize: 12.5 }} />
                  {LINES.map((l) => <Area key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={SERIES[l.key as keyof typeof SERIES]} strokeWidth={2.2} fill={`url(#g-${l.key})`} dot={{ r: 2.5, strokeWidth: 0, fill: SERIES[l.key as keyof typeof SERIES] }} activeDot={{ r: 4 }} isAnimationActive={false} />)}
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full flex-col items-center justify-center gap-2" style={{ color: MUTED, fontSize: 13.5 }}>No review decisions in this period yet.<Link to="/review" style={{ color: ACCENT, fontWeight: 600 }}>Start reviewing →</Link></div>}
          </div>
        </Card>

        <Card title="Recent activity" action={me.permissions.includes('manage') ? <ViewAll to="/settings?tab=usage" label="Usage" /> : undefined}>
          {!data.activity.length && <div style={{ color: MUTED, fontSize: 13.5 }}>Nothing yet.</div>}
          <div className="space-y-1">
            {data.activity.slice(0, 6).map((a) => {
              const k = actionOf(a.action)
              return (
                <div key={a._id} className="flex items-center gap-3" style={{ padding: '8px 0' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 99, background: k.bg, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><k.icon size={15} color={k.color} strokeWidth={2.4} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13.5, fontWeight: 500, color: INK }}>{k.label}</div>
                    <div className="truncate" style={{ fontSize: 12, color: MUTED }}>{a.by?.name || 'Someone'}</div>
                  </div>
                  <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>{ago(a.at)}</span>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: k.color }} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Most asked" action={<ViewAll to="/review" />}>
          <div className="flex" style={{ fontSize: 11, color: MUTED, fontWeight: 600, padding: '0 0 6px' }}><span className="flex-1">Question</span><span style={{ width: 54, textAlign: 'right' }}>Asked</span><span style={{ width: 92, textAlign: 'right' }}>Status</span></div>
          {data.top.map((c, i) => (
            <div key={c._id} className="flex items-center gap-2.5" style={{ padding: '9px 0', borderTop: '1px solid rgba(15,23,42,.05)' }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: ['#EEF2FF', '#DCFCE7', '#F3E8FF', '#FFEDD5', '#CCFBF1', '#FCE7F3'][i % 6], display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, color: '#334155', flex: '0 0 auto' }}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5, color: INK }}>{c.name}</span>
              <span style={{ width: 54, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: INK }}>{c.count}</span>
              <span style={{ width: 92, textAlign: 'right' }}><Pill status={c.status} /></span>
            </div>
          ))}
          {!data.top.length && <div style={{ color: MUTED, fontSize: 13.5 }}>Import conversations to see what customers ask most.</div>}
        </Card>

        <Card title="Review queue" action={<ViewAll to="/review" />}>
          {data.queue.map((q, i) => (
            <Link key={q._id} to="/review" className="flex items-center gap-3 rounded-xl hover:bg-white" style={{ padding: '9px 6px' }}>
              <span style={{ minWidth: 38, height: 38, borderRadius: 11, background: ['#FFF1F2', '#EEF2FF', '#EFF6FF', '#F0FDF4', '#FFF7ED'][i % 5], color: ['#E11D48', '#4F46E5', '#2563EB', '#16A34A', '#EA580C'][i % 5], display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>{q.count}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 500, color: INK }}>{q.name}</span>
                <span className="block truncate" style={{ fontSize: 12, color: MUTED }}>{q.category} · asked {q.count} time{q.count === 1 ? '' : 's'}</span>
              </span>
            </Link>
          ))}
          {!data.queue.length && <div className="flex items-center gap-2" style={{ color: '#16A34A', fontSize: 13.5 }}><CheckCircle2 size={16} /> Nothing waiting — all reviewed.</div>}
        </Card>

        <Card title="Answers" className="lg:col-span-2 xl:col-span-1">
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative" style={{ width: 150, height: 150, flex: '0 0 auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutTotal ? donut : [{ name: 'none', value: 1, color: '#E2E8F0' }]} dataKey="value" innerRadius={52} outerRadius={70} paddingAngle={donutTotal ? 2 : 0} stroke="none" isAnimationActive={false}>
                    {(donutTotal ? donut : [{ color: '#E2E8F0' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span style={{ fontSize: 28, fontWeight: 700, color: INK, lineHeight: 1 }}>{donutTotal}</span>
                <span style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Total</span>
              </div>
            </div>
            <div className="min-w-[140px] flex-1 space-y-2.5">
              {donut.map((d) => (
                <div key={d.name} className="flex items-center gap-2" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: d.color, flex: '0 0 auto' }} /><span className="min-w-0 flex-1 truncate" style={{ color: '#334155' }}>{d.name}</span><b style={{ color: INK }}>{d.value}</b>
                </div>
              ))}
            </div>
          </div>
          <Link to="/answers" className="mt-4 flex items-center justify-center gap-1.5" style={{ background: 'linear-gradient(180deg,#F5F8FF,#EDF3FF)', borderRadius: 12, padding: '10px 0', fontSize: 13.5, fontWeight: 600, color: ACCENT }}>Manage answers <ArrowRight size={15} /></Link>
        </Card>
      </div>
      <p style={{ fontSize: 12, color: MUTED }}>Test grades are AI-graded estimates for comparing runs. Approving an answer does not retrain the model; it becomes a versioned answer your agents look up, ranked below your live data.</p>
    </div>
  )
}
