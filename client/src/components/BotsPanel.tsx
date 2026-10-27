import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot as BotIcon, Globe, Mail, MessageCircle, Pencil, Pin, Play, Plus, Pause, Trash2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { SlideOver } from './ui'

/**
 * Bots on the dashboard: jobs that run on a clock (server services/bots.js).
 * Each card shows the bot's latest result. An email bot's run waits here for
 * a person to send it, unless an admin set it to send by itself.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const TINT = '#F7F3FF'
const LINE = 'rgba(20,8,31,.08)'
const FIELD = 'rgba(20,8,31,.14)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Cadence = 'manual' | 'daily' | 'weekly' | 'monthly'
type RunItem = { _id: string; channel?: 'email' | 'whatsapp'; phone?: string; reason?: string; name: string; email: string; unit: string; endDate: string; subject: string; body: string; status: 'pending' | 'sent' | 'skipped' | 'failed'; error?: string }
type Run = { _id: string; createdAt: string; status: 'ok' | 'waiting' | 'failed'; summary: string; answer: string; sources: { label: string; url: string }[]; items: RunItem[]; error: string }
export type BotRow = {
  _id: string; name: string; kind: 'ai_report' | 'contract_emails' | 'quiet_leads'; icon: string
  instruction: string; web: boolean; days: number; subject: string; message: string
  quietDays: number; maxQuietDays: number; templateName: string; templateLanguage: string
  sendMode: 'review' | 'auto'; dailyCap: number
  schedule: { cadence: Cadence; hour: number; dayOfWeek: number; dayOfMonth: number }
  showOnDashboard: boolean; enabled: boolean; scheduleLabel: string; lastRun: Run | null
}
type Draft = Omit<BotRow, '_id' | 'scheduleLabel' | 'lastRun'> & { _id?: string }

const btn = (primary = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, borderRadius: 9, padding: '7px 12px', cursor: 'pointer',
  border: primary ? 0 : `1px solid ${LINE}`, background: primary ? PURPLE : '#fff', color: primary ? '#fff' : INK,
})
const fieldStyle: React.CSSProperties = { width: '100%', height: 38, border: `1px solid ${FIELD}`, borderRadius: 9, padding: '0 11px', fontSize: 13.5, background: '#fff', color: INK }
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 5 }

const PILL = {
  ok: { bg: '#DCFCE7', fg: '#15803D' },
  waiting: { bg: '#FFF3D6', fg: '#8A5A00' },
  failed: { bg: '#FEE2E2', fg: '#B91C1C' },
  paused: { bg: '#F3F4F6', fg: '#4B5563' },
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })

/** Starting points for "New bot". */
const PRESETS: { title: string; hint: string; draft: Partial<Draft> }[] = [
  { title: 'Renewal reminder emails', hint: 'Email everyone whose contract ends soon', draft: { name: 'Renewal reminder emails', kind: 'contract_emails', icon: '✉️', days: 30, schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1, dayOfMonth: 1 } } },
  { title: 'Competitor watch', hint: 'Prices and offers from the web', draft: { name: 'Competitor watch', kind: 'ai_report', icon: '🔎', web: true, instruction: 'Find current monthly prices and any offers for self-storage units of about 25, 50 and 100 sq ft from storage companies in Dubai, and compare them with our prices for the same sizes. Name each company and where the price came from.', schedule: { cadence: 'daily', hour: 8, dayOfWeek: 1, dayOfMonth: 1 } } },
  { title: 'Morning lead summary', hint: 'Yesterday’s leads and what is due', draft: { name: 'Morning lead summary', kind: 'ai_report', icon: '☀️', instruction: 'How many leads came in yesterday and from which sources, which leads have not had a reply, how many follow-ups are due today, and which contracts end this week.', schedule: { cadence: 'daily', hour: 9, dayOfWeek: 1, dayOfMonth: 1 } } },
  { title: 'Quiet good leads', hint: 'WhatsApp good leads that went quiet', draft: { name: 'Quiet good leads', kind: 'quiet_leads', icon: '💬', quietDays: 3, maxQuietDays: 30, dailyCap: 30, schedule: { cadence: 'daily', hour: 11, dayOfWeek: 1, dayOfMonth: 1 } } },
  { title: 'Your own', hint: 'Any question, on a schedule', draft: { name: '', kind: 'ai_report', icon: '🤖', instruction: '' } },
]

const EMPTY: Draft = {
  name: '', kind: 'ai_report', icon: '🤖', instruction: '', web: false, days: 30, subject: '', message: '',
  quietDays: 3, maxQuietDays: 30, templateName: '', templateLanguage: 'en',
  sendMode: 'review', dailyCap: 50, schedule: { cadence: 'weekly', hour: 9, dayOfWeek: 1, dayOfMonth: 1 }, showOnDashboard: true, enabled: true,
}

/** **bold** as bold. */
function withBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part))
}

export default function BotsPanel({ pinnedOnly = false }: { pinnedOnly?: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ bots: BotRow[]; defaults: { subject: string; message: string }; recommendedMissing?: string[] }>({
    queryKey: ['bots'],
    queryFn: () => api.get('/bots').then((r) => r.data),
    refetchInterval: 60_000,
  })
  const [editing, setEditing] = useState<Draft | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [reviewing, setReviewing] = useState<{ bot: BotRow; run: Run } | null>(null)
  const [err, setErr] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['bots'] })

  const addRecommended = useMutation({
    mutationFn: () => api.post('/bots/recommended').then((r) => r.data),
    onSuccess: refresh,
    onError: (e) => setErr(apiError(e)),
  })
  const missing = data?.recommendedMissing ?? []

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/bots/${id}`),
    onSuccess: refresh,
    onError: (e) => setErr(apiError(e)),
  })

  const run = useMutation({
    mutationFn: (id: string) => api.post(`/bots/${id}/run`).then((r) => r.data),
    onSuccess: refresh,
    onError: (e) => setErr(apiError(e)),
  })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Draft> }) => api.put(`/bots/${id}`, body),
    onSuccess: refresh,
    onError: (e) => setErr(apiError(e)),
  })

  const bots = (data?.bots ?? []).filter((b) => !pinnedOnly || b.showOnDashboard)
  if (pinnedOnly && !bots.length) return null

  const start = (d: Partial<Draft>) => {
    setChoosing(false)
    setEditing({ ...EMPTY, ...d, subject: d.kind === 'contract_emails' ? data?.defaults.subject ?? '' : '', message: d.kind === 'contract_emails' ? data?.defaults.message ?? '' : '' })
  }

  return (
    <div>
      {!pinnedOnly && (
        <div className="flex items-center gap-3 mb-4">
          <div style={{ fontSize: 13, color: MUTED }} className="mr-auto">Each bot runs on its schedule and keeps its latest result here. Pinned bots also show on Overview.</div>
          {missing.length > 0 && (
            <button type="button" style={btn()} disabled={addRecommended.isPending} onClick={() => { setErr(''); addRecommended.mutate() }}
              title={`Adds: ${missing.join(', ')}. Only the renewal emails reach customers, and they wait for you to send them.`}>
              <BotIcon size={14} /> {addRecommended.isPending ? 'Adding…' : `Add recommended bots (${missing.length})`}
            </button>
          )}
          <button type="button" style={btn(true)} onClick={() => setChoosing(true)}><Plus size={14} /> New bot</button>
        </div>
      )}
      {pinnedOnly && (
        <div className="mb-3 flex items-center gap-2" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
          <BotIcon size={13} /> Bots
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: '#B91C1C', marginBottom: 10 }}>{err}</div>}

      {isLoading ? null : !bots.length ? (
        <div className="text-center py-12 rounded-2xl" style={{ border: `1px dashed ${FIELD}`, color: MUTED, fontSize: 13.5 }}>
          <BotIcon size={22} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          No bots yet. Make one to email renewals, watch competitors or send a morning summary.
        </div>
      ) : (
        <div className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-3 items-start">
          {bots.map((b) => (
            <BotCard key={b._id} bot={b} running={run.isPending && run.variables === b._id}
              onRun={() => { setErr(''); run.mutate(b._id) }}
              onEdit={() => setEditing({ ...b })}
              onToggle={() => patch.mutate({ id: b._id, body: { enabled: !b.enabled } })}
              onPin={() => patch.mutate({ id: b._id, body: { showOnDashboard: !b.showOnDashboard } })}
              onReview={(r) => setReviewing({ bot: b, run: r })}
              onDelete={() => { if (window.confirm(`Delete the bot “${b.name}”? Its results go with it.`)) remove.mutate(b._id) }} />
          ))}
        </div>
      )}

      <SlideOver open={choosing} onClose={() => setChoosing(false)} title="New bot" subtitle="Start from one of these, then adjust.">
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button key={p.title} type="button" onClick={() => start(p.draft)} className="text-left rounded-xl hover:bg-[#F7F3FF]"
              style={{ border: `1px solid ${LINE}`, padding: '14px 16px', background: '#fff', cursor: 'pointer' }}>
              <div style={{ fontSize: 20 }}>{p.draft.icon}</div>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14.5, color: INK, marginTop: 4 }}>{p.title}</div>
              <div style={{ fontSize: 12.5, color: MUTED }}>{p.hint}</div>
            </button>
          ))}
        </div>
      </SlideOver>

      {editing && <BotEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      {reviewing && <ReviewRun bot={reviewing.bot} run={reviewing.run} onClose={() => setReviewing(null)} onDone={refresh} />}
    </div>
  )
}

function BotCard({ bot, running, onRun, onEdit, onToggle, onPin, onReview, onDelete }: {
  bot: BotRow; running: boolean; onRun: () => void; onEdit: () => void; onToggle: () => void; onPin: () => void; onReview: (r: Run) => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const r = bot.lastRun
  const pill = !bot.enabled ? { ...PILL.paused, text: 'Paused' }
    : !r ? { ...PILL.paused, text: 'Not run yet' }
      : r.status === 'waiting' ? { ...PILL.waiting, text: `${r.items.filter((i) => i.status === 'pending').length} to approve` }
        : r.status === 'failed' ? { ...PILL.failed, text: 'Failed' }
          : { ...PILL.ok, text: `Ran ${when(r.createdAt)}` }
  const pending = r?.items.filter((i) => i.status === 'pending') ?? []

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', opacity: bot.enabled ? 1 : 0.75 }} aria-label={`Bot ${bot.name}`}>
      <div className="flex items-start gap-3">
        <div style={{ width: 34, height: 34, borderRadius: 10, background: TINT, display: 'grid', placeItems: 'center', fontSize: 17, flex: '0 0 auto' }}>{bot.icon || '🤖'}</div>
        <div className="min-w-0 flex-1">
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }} className="truncate">{bot.name}</div>
          <div style={{ fontSize: 12, color: MUTED }}>
            {bot.scheduleLabel}
            {bot.kind !== 'ai_report' && ` · ${bot.sendMode === 'auto' ? 'sends by itself' : 'asks first'}`}
            {bot.kind === 'ai_report' && bot.web && ' · searches the web'}
          </div>
          <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: pill.bg, color: pill.fg, whiteSpace: 'nowrap' }}>{pill.text}</span>
        </div>
      </div>

      {r?.error && <div style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 10 }}>{r.error}</div>}

      {bot.kind === 'ai_report' && r?.answer && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: INK, whiteSpace: 'pre-wrap', maxHeight: open ? 'none' : 168, overflow: 'hidden' }}>{withBold(r.answer)}</div>
          {r.answer.length > 360 && (
            <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 12, fontWeight: 600, color: PURPLE_INK, background: 'none', border: 0, padding: 0, marginTop: 4, cursor: 'pointer' }}>
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
          {r.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 8 }}>
              {r.sources.slice(0, 4).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1"
                  style={{ fontSize: 11.5, fontWeight: 600, color: PURPLE_INK, border: `1px solid ${LINE}`, borderRadius: 7, padding: '3px 8px', maxWidth: 200 }}>
                  <Globe size={11} /> <span className="truncate">{s.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {bot.kind !== 'ai_report' && r && (
        <div style={{ marginTop: 10 }}>
          {pending.slice(0, 4).map((i) => (
            <div key={i._id} className="flex justify-between gap-3" style={{ fontSize: 12.5, padding: '6px 0', borderTop: `1px solid ${LINE}` }}>
              <span className="truncate">{i.name}{i.unit ? ` · ${i.unit}` : ''}</span>
              <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>{i.channel === 'whatsapp' ? i.reason : `ends ${day(i.endDate)}`}</span>
            </div>
          ))}
          {pending.length > 4 && <div style={{ fontSize: 12, color: MUTED, paddingTop: 4 }}>+ {pending.length - 4} more</div>}
          {!pending.length && <div style={{ fontSize: 12.5, color: MUTED }}>{r.summary}</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 14 }}>
        {pending.length > 0 && r && <button type="button" style={btn(true)} onClick={() => onReview(r)}>{bot.kind === 'quiet_leads' ? <MessageCircle size={13} /> : <Mail size={13} />} Review &amp; send {pending.length}</button>}
        <button type="button" style={btn(!pending.length)} onClick={onRun} disabled={running}><Play size={13} /> {running ? 'Running…' : 'Run now'}</button>
        <button type="button" style={btn()} onClick={onEdit} aria-label="Edit"><Pencil size={13} /></button>
        <button type="button" style={btn()} onClick={onToggle} aria-label={bot.enabled ? 'Pause' : 'Resume'}>{bot.enabled ? <Pause size={13} /> : <Play size={13} />}</button>
        <button type="button" style={{ ...btn(), color: '#B91C1C' }} onClick={onDelete} aria-label="Delete" title="Delete this bot"><Trash2 size={13} /></button>
        <button type="button" onClick={onPin} aria-label={bot.showOnDashboard ? 'Unpin from Overview' : 'Pin to Overview'} title={bot.showOnDashboard ? 'On Overview' : 'Pin to Overview'}
          style={{ ...btn(), marginLeft: 'auto', color: bot.showOnDashboard ? PURPLE : MUTED, borderColor: bot.showOnDashboard ? PURPLE : LINE }}>
          <Pin size={13} />
        </button>
      </div>
    </div>
  )
}

function BotEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft)
  const [err, setErr] = useState('')
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const setS = (p: Partial<Draft['schedule']>) => setD((x) => ({ ...x, schedule: { ...x.schedule, ...p } }))
  const save = useMutation({
    mutationFn: () => (d._id ? api.put(`/bots/${d._id}`, d) : api.post('/bots', d)),
    onSuccess: onSaved,
    onError: (e) => setErr(apiError(e)),
  })
  const del = useMutation({ mutationFn: () => api.delete(`/bots/${d._id}`), onSuccess: onSaved, onError: (e) => setErr(apiError(e)) })

  const seg = (on: boolean): React.CSSProperties => ({
    flex: 1, textAlign: 'center', padding: '8px 6px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${on ? PURPLE : FIELD}`, background: on ? TINT : '#fff', color: on ? PURPLE_INK : INK,
  })
  const toggle = (on: boolean, flip: () => void, text: string) => (
    <label className="flex items-center justify-between" style={{ fontSize: 13, color: INK, cursor: 'pointer', margin: '10px 0' }}>
      {text}
      <button type="button" role="switch" aria-checked={on} aria-label={text} onClick={flip}
        style={{ width: 36, height: 21, borderRadius: 999, border: 0, background: on ? PURPLE : '#D7D3DE', position: 'relative', cursor: 'pointer' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 18 : 3, width: 15, height: 15, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
      </button>
    </label>
  )

  return (
    <SlideOver open onClose={onClose} title={d._id ? 'Edit bot' : 'New bot'} subtitle={d.kind === 'contract_emails' ? 'Emails customers whose contract is ending.' : d.kind === 'quiet_leads' ? 'WhatsApps good leads that have gone quiet.' : 'Answers your question on a schedule.'}>
      <form onSubmit={(e) => { e.preventDefault(); setErr(''); save.mutate() }} className="space-y-4">
        <div className="flex gap-3">
          <label style={{ width: 70 }}><span style={label}>Icon</span><input value={d.icon} onChange={(e) => set({ icon: e.target.value })} style={{ ...fieldStyle, textAlign: 'center' }} aria-label="Icon" /></label>
          <label style={{ flex: 1 }}><span style={label}>Name</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} style={fieldStyle} aria-label="Name" /></label>
        </div>

        <div>
          <span style={label}>Does</span>
          <div className="flex gap-2">
            <div role="button" tabIndex={0} style={seg(d.kind === 'ai_report')} onClick={() => set({ kind: 'ai_report' })}>Finds out and reports</div>
            <div role="button" tabIndex={0} style={seg(d.kind === 'contract_emails')} onClick={() => set({ kind: 'contract_emails' })}>Emails ending contracts</div>
            <div role="button" tabIndex={0} style={seg(d.kind === 'quiet_leads')} onClick={() => set({ kind: 'quiet_leads' })}>WhatsApps quiet leads</div>
          </div>
        </div>

        {d.kind === 'ai_report' ? (
          <>
            <label style={{ display: 'block' }}>
              <span style={label}>What should it find out? (plain words)</span>
              <textarea value={d.instruction} onChange={(e) => set({ instruction: e.target.value })} rows={4} aria-label="What should it find out"
                style={{ ...fieldStyle, height: 'auto', padding: '9px 11px', lineHeight: 1.45, resize: 'vertical' }} />
            </label>
            {toggle(d.web, () => set({ web: !d.web }), 'Can search the web')}
          </>
        ) : d.kind === 'quiet_leads' ? (
          <QuietLeadsFields d={d} set={set} seg={seg} />
        ) : (
          <>
            <label style={{ display: 'block' }}>
              <span style={label}>Contracts ending in the next</span>
              <div className="flex items-center gap-2"><input type="number" min={1} max={120} value={d.days} onChange={(e) => set({ days: Number(e.target.value) })} style={{ ...fieldStyle, width: 90 }} aria-label="Days" /><span style={{ fontSize: 13, color: MUTED }}>days</span></div>
            </label>
            <label style={{ display: 'block' }}><span style={label}>Subject</span><input value={d.subject} onChange={(e) => set({ subject: e.target.value })} style={fieldStyle} aria-label="Subject" /></label>
            <label style={{ display: 'block' }}>
              <span style={label}>Message · {'{name}'} {'{unit}'} {'{endDate}'} {'{daysLeft}'} {'{contractNo}'} are filled in</span>
              <textarea value={d.message} onChange={(e) => set({ message: e.target.value })} rows={8} aria-label="Message"
                style={{ ...fieldStyle, height: 'auto', padding: '9px 11px', lineHeight: 1.45, resize: 'vertical' }} />
            </label>
            <div>
              <span style={label}>Sending</span>
              <div className="flex gap-2">
                <div role="button" tabIndex={0} style={seg(d.sendMode === 'review')} onClick={() => set({ sendMode: 'review' })}>Ask me first</div>
                <div role="button" tabIndex={0} style={seg(d.sendMode === 'auto')} onClick={() => set({ sendMode: 'auto' })}>Send by itself</div>
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
                {d.sendMode === 'review'
                  ? 'Each run’s emails wait on the dashboard until you press Send.'
                  : <>Sends on schedule, at most <input type="number" min={1} max={500} value={d.dailyCap} onChange={(e) => set({ dailyCap: Number(e.target.value) })} aria-label="Daily cap" style={{ width: 56, height: 24, border: `1px solid ${FIELD}`, borderRadius: 6, padding: '0 6px' }} /> a day. Skips anyone renewing, not renewing, or emailed by this bot in the last 7 days.</>}
              </div>
            </div>
          </>
        )}

        <div>
          <span style={label}>How often</span>
          <div className="flex gap-2">
            {(['daily', 'weekly', 'monthly', 'manual'] as Cadence[]).map((c) => (
              <div key={c} role="button" tabIndex={0} style={seg(d.schedule.cadence === c)} onClick={() => setS({ cadence: c })}>
                {c === 'manual' ? 'When I run it' : c[0].toUpperCase() + c.slice(1)}
              </div>
            ))}
          </div>
        </div>
        {d.schedule.cadence !== 'manual' && (
          <div className="flex gap-3">
            {d.schedule.cadence === 'weekly' && (
              <label style={{ flex: 1 }}><span style={label}>Day</span>
                <select value={d.schedule.dayOfWeek} onChange={(e) => setS({ dayOfWeek: Number(e.target.value) })} style={fieldStyle} aria-label="Day">
                  {DAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </label>
            )}
            {d.schedule.cadence === 'monthly' && (
              <label style={{ flex: 1 }}><span style={label}>Day of month</span>
                <select value={d.schedule.dayOfMonth} onChange={(e) => setS({ dayOfMonth: Number(e.target.value) })} style={fieldStyle} aria-label="Day of month">
                  {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>
            )}
            <label style={{ flex: 1 }}><span style={label}>Time (Dubai)</span>
              <select value={d.schedule.hour} onChange={(e) => setS({ hour: Number(e.target.value) })} style={fieldStyle} aria-label="Time">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>
        )}

        {toggle(d.showOnDashboard, () => set({ showOnDashboard: !d.showOnDashboard }), 'Show on Overview')}

        {err && <div style={{ fontSize: 12.5, color: '#B91C1C' }}>{err}</div>}
        <div className="flex items-center gap-2">
          <button type="submit" style={btn(true)} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save bot'}</button>
          <button type="button" style={btn()} onClick={onClose}>Cancel</button>
          {d._id && (
            <button type="button" style={{ ...btn(), marginLeft: 'auto', color: '#B91C1C' }} onClick={() => { if (window.confirm(`Delete “${d.name}”?`)) del.mutate() }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </form>
    </SlideOver>
  )
}

/** A run's waiting emails: read them, untick any, send the rest. */
function ReviewRun({ bot, run, onClose, onDone }: { bot: BotRow; run: Run; onClose: () => void; onDone: () => void }) {
  const pending = run.items.filter((i) => i.status === 'pending')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(pending.map((i) => i._id)))
  const [open, setOpen] = useState<string | null>(pending[0]?._id ?? null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const send = useMutation({
    mutationFn: async () => {
      const ids = [...picked]
      const skip = pending.filter((i) => !picked.has(i._id)).map((i) => i._id)
      const { data } = await api.post(`/bots/runs/${run._id}/send`, { ids })
      if (skip.length) await api.post(`/bots/runs/${run._id}/skip`, { ids: skip })
      return data as { sent: number; run: Run }
    },
    onSuccess: (data) => {
      const failed = data.run.items.filter((i) => i.status === 'failed').length
      setDone(`${data.sent} sent${failed ? ` · ${failed} failed` : ''}.`)
      onDone()
    },
    onError: (e) => setErr(apiError(e)),
  })
  const flip = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <SlideOver open onClose={onClose} title={`${bot.name}`} subtitle={`${pending.length} ${bot.kind === 'quiet_leads' ? 'WhatsApp messages' : 'emails'} waiting · prepared ${when(run.createdAt)}`}>
      {done ? (
        <div className="space-y-3">
          <div style={{ fontSize: 14, color: INK }}>{done}</div>
          <button type="button" style={btn(true)} onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((i) => (
            <div key={i._id} style={{ border: `1px solid ${LINE}`, borderRadius: 12 }}>
              <div className="flex items-center gap-3" style={{ padding: '10px 12px' }}>
                <input type="checkbox" checked={picked.has(i._id)} onChange={() => flip(i._id)} aria-label={`Send to ${i.name}`} style={{ width: 16, height: 16, accentColor: PURPLE }} />
                <button type="button" onClick={() => setOpen(open === i._id ? null : i._id)} className="flex-1 min-w-0 text-left" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                  <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{i.name}{i.unit ? ` · ${i.unit}` : ''}</div>
                  <div className="truncate" style={{ fontSize: 12, color: MUTED }}>{i.channel === 'whatsapp' ? `${i.phone} · ${i.reason}` : `${i.email} · ends ${day(i.endDate)}`}</div>
                </button>
              </div>
              {open === i._id && (
                <div style={{ borderTop: `1px solid ${LINE}`, padding: '10px 12px', background: '#FBFAFD' }}>
                  {i.subject && <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 6 }}>{i.subject}</div>}
                  <div style={{ fontSize: 12.5, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{i.body}</div>
                </div>
              )}
            </div>
          ))}
          {err && <div style={{ fontSize: 12.5, color: '#B91C1C' }}>{err}</div>}
          <div className="flex items-center gap-3" style={{ paddingTop: 8 }}>
            <button type="button" style={btn(true)} disabled={!picked.size || send.isPending} onClick={() => { setErr(''); send.mutate() }}>
              {bot.kind === 'quiet_leads' ? <MessageCircle size={13} /> : <Mail size={13} />} {send.isPending ? 'Sending…' : bot.kind === 'quiet_leads' ? `Send ${picked.size} WhatsApp${picked.size === 1 ? '' : 's'}` : `Send ${picked.size} email${picked.size === 1 ? '' : 's'}`}
            </button>
            {picked.size < pending.length && <span style={{ fontSize: 12, color: MUTED }}>{pending.length - picked.size} left out of this run</span>}
          </div>
        </div>
      )}
    </SlideOver>
  )
}

/* The quiet-leads settings: how long silent, which approved template, and
   whether it asks first. Templates come from WhatsApp itself: approved, with
   one blank (the first name) or none. */
function QuietLeadsFields({ d, set, seg }: { d: Draft; set: (p: Partial<Draft>) => void; seg: (on: boolean) => React.CSSProperties }) {
  const { data } = useQuery<{ error: string; templates: { name: string; language: string; bodyText: string; variableCount: number }[] }>({
    queryKey: ['bot-templates'],
    queryFn: () => api.get('/bots/templates').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const chosen = data?.templates.find((t) => t.name === d.templateName)
  return (
    <>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
        Picks open leads that were a good catch — hot or warm, or with a quotation, site visit or follow-up — where nothing has been said either way for a while.
        Skips anyone with a follow-up already planned, or messaged by this bot in the last week.
      </div>
      <div className="flex gap-3">
        <label style={{ flex: 1 }}><span style={label}>Quiet for at least</span>
          <div className="flex items-center gap-2"><input type="number" min={1} max={60} value={d.quietDays} onChange={(e) => set({ quietDays: Number(e.target.value) })} style={{ ...fieldStyle, width: 80 }} aria-label="Quiet days" /><span style={{ fontSize: 13, color: MUTED }}>days</span></div>
        </label>
        <label style={{ flex: 1 }}><span style={label}>Customer last wrote within</span>
          <div className="flex items-center gap-2"><input type="number" min={2} max={180} value={d.maxQuietDays} onChange={(e) => set({ maxQuietDays: Number(e.target.value) })} style={{ ...fieldStyle, width: 80 }} aria-label="Within days" /><span style={{ fontSize: 13, color: MUTED }}>days</span></div>
        </label>
      </div>
      <label style={{ display: 'block' }}>
        <span style={label}>WhatsApp template (approved by Meta — needed after 24 hours of silence)</span>
        <select value={d.templateName} onChange={(e) => { const t = data?.templates.find((x) => x.name === e.target.value); set({ templateName: e.target.value, templateLanguage: t?.language || 'en' }) }} style={fieldStyle} aria-label="Template">
          <option value="">Choose a template…</option>
          {(data?.templates ?? []).map((t) => <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} ({t.language})</option>)}
        </select>
      </label>
      {data?.error && <div style={{ fontSize: 12, color: '#B91C1C' }}>{data.error}</div>}
      {chosen && (
        <div style={{ fontSize: 12.5, color: '#374151', background: '#FBFAFD', border: `1px solid ${LINE}`, borderRadius: 9, padding: '9px 11px', whiteSpace: 'pre-wrap' }}>
          {chosen.bodyText.replaceAll('{{1}}', 'Sara')}
        </div>
      )}
      <div>
        <span style={label}>Sending</span>
        <div className="flex gap-2">
          <div role="button" tabIndex={0} style={seg(d.sendMode === 'review')} onClick={() => set({ sendMode: 'review' })}>Ask me first</div>
          <div role="button" tabIndex={0} style={seg(d.sendMode === 'auto')} onClick={() => set({ sendMode: 'auto' })}>Send by itself</div>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
          At most <input type="number" min={1} max={200} value={d.dailyCap} onChange={(e) => set({ dailyCap: Number(e.target.value) })} aria-label="Daily cap" style={{ width: 56, height: 24, border: `1px solid ${FIELD}`, borderRadius: 6, padding: '0 6px' }} /> a day, best leads first.
        </div>
      </div>
    </>
  )
}
