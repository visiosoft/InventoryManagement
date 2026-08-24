import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Megaphone, Plus, Send, Play, Trash2, AlertTriangle, Mail, MessageCircle, Users } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'

const PURPLE = '#5B2BC9'
const MUTED = '#756E80'

type Audience = {
  tenants: boolean
  pastTenants: boolean
  leads: boolean
  leadStatuses: string[]
  renewalIntent: string
  owingOnly: boolean
}

type Campaign = {
  _id: string
  name: string
  channel: 'email' | 'whatsapp' | 'both'
  audience: Audience
  emailSubject: string
  emailHtml: string
  whatsapp: { templateName: string; language: string; variables: string[] }
  status: 'draft' | 'sending' | 'sent' | 'cancelled' | 'failed'
  stats: { targeted: number; sent: number; failed: number; skipped: number }
  createdByName: string
  createdAt: string
}

type WaTemplate = { name: string; language: string; status: string; category: string; bodyText: string; variableCount: number }

type Channels = {
  email: boolean
  whatsapp: boolean
  templates: { configured: boolean; error: string; approved: WaTemplate[]; all: WaTemplate[] }
}

type Counts = { total: number; byEmail: number; byWhatsApp: number; unreachable: number; recentlyMessaged: number; noWhatsAppOptIn: number }

const emptyAudience: Audience = {
  tenants: true, pastTenants: false, leads: false,
  leadStatuses: [], renewalIntent: '', owingOnly: false,
}

const statusTone: Record<string, string> = {
  draft: 'gray', sending: 'blue', sent: 'green', cancelled: 'gray', failed: 'red',
}

export default function Marketing() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [error, setError] = useState('')

  const { data: channels } = useQuery<Channels>({
    queryKey: ['campaign-channels'],
    queryFn: () => api.get('/campaigns/channels').then((r) => r.data),
    staleTime: 60_000,
  })

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns').then((r) => r.data),
    // A sending campaign moves; keep the list honest without hammering.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'sending') ? 5_000 : false),
  })

  const create = useMutation({
    mutationFn: () => api.post('/campaigns', {
      name: 'Untitled campaign', channel: 'email', audience: emptyAudience,
    }).then((r) => r.data),
    onSuccess: (c: Campaign) => { qc.invalidateQueries({ queryKey: ['campaigns'] }); setEditing(c); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); setEditing(null) },
    onError: (e) => setError(apiError(e)),
  })

  if (isLoading) return <Spinner />

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Marketing"
        subtitle="Announcements, offers and seasonal messages to tenants, past tenants and leads"
        action={<Button onClick={() => create.mutate()} disabled={create.isPending}><Plus size={14} /> New campaign</Button>}
      />

      {/* What can actually be sent right now. Said up front, because both
          channels have a prerequisite outside this app. */}
      {channels && (!channels.email || !channels.templates.approved.length) && (
        <Card>
          <CardBody className="space-y-1.5 text-[13px]">
            {!channels.email && (
              <p className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Email is not connected.</strong> Campaigns cannot send until Gmail is connected in{' '}
                  <Link to="/settings" className="underline font-semibold">Settings → Integrations</Link>.
                </span>
              </p>
            )}
            {!channels.templates.approved.length && (
              <p className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>No approved WhatsApp templates.</strong>{' '}
                  {channels.templates.error || 'Create a MARKETING template in Meta and wait for approval.'}{' '}
                  WhatsApp only allows free-form messages within 24 hours of someone writing to you, so a broadcast
                  must use an approved template.
                </span>
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {!editing && <OptInPanel />}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {editing ? (
        <Composer
          campaign={editing}
          channels={channels}
          onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['campaigns'] }) }}
          onDelete={() => remove.mutate(editing._id)}
        />
      ) : campaigns.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <Megaphone size={30} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">No campaigns yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <button
              key={c._id}
              type="button"
              onClick={() => setEditing(c)}
              className="w-full text-left rounded-xl px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
              style={{ background: '#fff', border: '1px solid rgba(20,8,31,.08)' }}
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-semibold text-[14px] flex-1 truncate">{c.name}</span>
                <Badge tone={statusTone[c.status] ?? 'gray'}>{c.status}</Badge>
                <span className="text-[11.5px] inline-flex items-center gap-1" style={{ color: MUTED }}>
                  {c.channel === 'email' ? <Mail size={12} /> : c.channel === 'whatsapp' ? <MessageCircle size={12} /> : <>
                    <Mail size={12} /><MessageCircle size={12} />
                  </>}
                  {c.channel}
                </span>
              </div>
              {c.status !== 'draft' && (
                <div className="text-[12px] mt-1" style={{ color: MUTED }}>
                  {c.stats.sent} sent
                  {c.stats.failed > 0 && <span className="text-red-600 font-semibold"> · {c.stats.failed} failed</span>}
                  {c.stats.skipped > 0 && ` · ${c.stats.skipped} skipped`}
                  {` of ${c.stats.targeted}`}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * WhatsApp marketing needs a recorded opt-in per person, and nobody has one, so
 * the WhatsApp audience is empty until this is run. Offered as a deliberate,
 * previewed action rather than a default, because it is a judgement about your
 * customers to make once and knowingly.
 */
function OptInPanel() {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<{ customers: number; leads: number } | null>(null)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  const dry = useMutation({
    mutationFn: () => api.post('/campaigns/opt-in/backfill?dry=1').then((r) => r.data),
    onSuccess: (d) => { setPreview({ customers: d.customers, leads: d.leads }); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const run = useMutation({
    mutationFn: () => api.post('/campaigns/opt-in/backfill').then((r) => r.data),
    onSuccess: (d) => {
      setDone(`${d.customers} tenants and ${d.leads} leads now opted in`)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <Card>
      <CardHeader
        title="WhatsApp marketing opt-in"
        subtitle="Meta requires a recorded opt-in before a marketing template can be sent"
      />
      <CardBody className="space-y-2.5 text-[13px]">
        <p style={{ color: MUTED }}>
          Nobody is opted in yet, so WhatsApp campaigns currently reach zero people. You can record an
          opt-in for everyone who has messaged your business first — a defensible basis for consent, but
          a judgement about your customers, so it is yours to make.
        </p>
        {preview && (
          <p className="rounded-lg px-3 py-2" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF' }}>
            This would opt in <strong>{preview.customers}</strong> tenants and <strong>{preview.leads}</strong> leads.
            Nothing has changed yet.
          </p>
        )}
        {done && <p className="text-emerald-600 font-medium">{done}</p>}
        {err && <p className="text-destructive">{err}</p>}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => dry.mutate()} disabled={dry.isPending}>
            {dry.isPending ? 'Checking…' : 'Preview'}
          </Button>
          {preview && (preview.customers + preview.leads) > 0 && (
            <Button
              onClick={() => {
                if (!confirm(`Record a WhatsApp marketing opt-in for ${preview.customers + preview.leads} people who messaged you first?`)) return
                run.mutate()
              }}
              disabled={run.isPending}
            >
              {run.isPending ? 'Recording…' : 'Record opt-in'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

/** What actually happened, per person — the record of the send, not tracking. */
function Results({ campaignId }: { campaignId: string }) {
  const [failedOnly, setFailedOnly] = useState(false)
  const { data } = useQuery<{ recipients: Array<{ _id: string; name: string; channel: string; email: string; phoneNormalized: string; status: string; reason: string }> }>({
    queryKey: ['campaign-results', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}`).then((r) => r.data),
    refetchInterval: 8_000,
  })
  const rows = data?.recipients ?? []
  const shown = failedOnly ? rows.filter((r) => r.status === 'failed') : rows
  const failures = rows.filter((r) => r.status === 'failed').length

  if (!rows.length) return null

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(20,8,31,.08)' }}>
      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: '#FBF8F2' }}>
        <span className="text-[13px] font-semibold">{rows.length} recipients</span>
        {failures > 0 && (
          <button type="button" onClick={() => setFailedOnly((v) => !v)}
            className="text-[12px] font-semibold cursor-pointer"
            style={{ color: failedOnly ? PURPLE : '#B91C1C' }}>
            {failedOnly ? 'Show all' : `Show ${failures} failed`}
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {shown.map((r) => (
          <div key={r._id} className="flex items-center gap-2 px-3.5 py-2 text-[12.5px]"
            style={{ borderTop: '1px solid rgba(20,8,31,.05)' }}>
            <span className="flex-1 truncate">{r.name || r.email || r.phoneNormalized}</span>
            <span className="shrink-0" style={{ color: MUTED }}>{r.channel}</span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5"
              style={r.status === 'sent'
                ? { background: '#DCFCE7', color: '#047857', fontSize: 11, fontWeight: 700 }
                : r.status === 'failed'
                  ? { background: '#FEE2E2', color: '#B91C1C', fontSize: 11, fontWeight: 700 }
                  : { background: '#F3F0EA', color: MUTED, fontSize: 11, fontWeight: 700 }}
              title={r.reason || undefined}
            >
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Composer({ campaign, channels, onClose, onDelete }: {
  campaign: Campaign
  channels?: Channels
  onClose: () => void
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Campaign>(campaign)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [testTo, setTestTo] = useState('')
  const [tested, setTested] = useState(false)

  const readOnly = draft.status !== 'draft'
  const set = (patch: Partial<Campaign>) => setDraft({ ...draft, ...patch })
  const setAud = (patch: Partial<Audience>) => setDraft({ ...draft, audience: { ...draft.audience, ...patch } })

  // Live audience size. Debounced so dragging through checkboxes does not
  // fire a query per click.
  const [counts, setCounts] = useState<Counts | null>(null)
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      api.post('/campaigns/preview', { audience: draft.audience })
        .then((r) => { if (alive) setCounts(r.data.counts) })
        .catch(() => { if (alive) setCounts(null) })
    }, 350)
    return () => { alive = false; window.clearTimeout(t) }
  }, [draft.audience])

  const save = useMutation({
    mutationFn: () => api.put(`/campaigns/${draft._id}`, draft).then((r) => r.data),
    onSuccess: (c: Campaign) => { setDraft(c); setErr(''); setNote('Saved') },
    onError: (e) => { setErr(apiError(e)); setNote('') },
  })

  const test = useMutation({
    mutationFn: () => {
      const isEmail = testTo.includes('@')
      return api.post(`/campaigns/${draft._id}/test`, isEmail ? { email: testTo } : { phone: testTo }).then((r) => r.data)
    },
    onSuccess: (d: { sent: string[] }) => { setErr(''); setTested(true); setNote(`Test sent: ${d.sent.join(', ')}`) },
    onError: (e) => { setErr(apiError(e)); setNote('') },
  })

  const send = useMutation({
    mutationFn: () => api.post(`/campaigns/${draft._id}/send`).then((r) => r.data),
    onSuccess: (d: { targeted: number }) => {
      setErr(''); setNote(`Sending to ${d.targeted}…`)
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      onClose()
    },
    onError: (e) => setErr(apiError(e)),
  })

  const wantsEmail = draft.channel === 'email' || draft.channel === 'both'
  const wantsWa = draft.channel === 'whatsapp' || draft.channel === 'both'
  const approved = channels?.templates.approved ?? []
  const picked = approved.find((t) => t.name === draft.whatsapp?.templateName)

  const reach = useMemo(() => {
    if (!counts) return 0
    if (draft.channel === 'email') return counts.byEmail
    if (draft.channel === 'whatsapp') return counts.byWhatsApp
    return Math.max(counts.byEmail, counts.byWhatsApp)
  }, [counts, draft.channel])

  return (
    <Card>
      <CardHeader
        title={readOnly ? draft.name : 'Campaign'}
        subtitle={readOnly ? `${draft.status} · ${draft.stats.sent} sent of ${draft.stats.targeted}` : 'Nothing is sent until you press Send'}
        action={<Button variant="outline" onClick={onClose}>Back</Button>}
      />
      <CardBody className="space-y-4">
        {readOnly && <Results campaignId={draft._id} />}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <Field label="Campaign name">
            <Input value={draft.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Channel">
            <Select value={draft.channel} disabled={readOnly} onChange={(e) => set({ channel: e.target.value as Campaign['channel'] })}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="both">Both</option>
            </Select>
          </Field>
        </div>

        {/* Audience */}
        <div className="rounded-xl p-3.5 space-y-3" style={{ background: '#FBF8F2', border: '1px solid rgba(20,8,31,.06)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold"><Users size={15} /> Who receives this</div>

          <div className="flex flex-wrap gap-4 text-[13px]">
            {([
              ['tenants', 'Current tenants'],
              ['pastTenants', 'Past tenants'],
              ['leads', 'Leads'],
            ] as [keyof Audience, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={Boolean(draft.audience[key])}
                  onChange={(e) => setAud({ [key]: e.target.checked } as Partial<Audience>)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Only tenants whose renewal is">
              <Select value={draft.audience.renewalIntent} disabled={readOnly || !draft.audience.tenants}
                onChange={(e) => setAud({ renewalIntent: e.target.value })}>
                <option value="">Any</option>
                <option value="undecided">Undecided</option>
                <option value="renewing">Renewing</option>
                <option value="not_renewing">Not renewing</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 text-[13px] pb-2 cursor-pointer">
              <input type="checkbox" disabled={readOnly || !draft.audience.tenants}
                checked={draft.audience.owingOnly}
                onChange={(e) => setAud({ owingOnly: e.target.checked })} />
              Only those behind on payments
            </label>
          </div>

          {counts && (
            <div className="text-[12.5px] space-y-1" style={{ color: MUTED }}>
              <p>
                <strong style={{ color: PURPLE }}>{counts.total}</strong> people ·{' '}
                {counts.byEmail} reachable by email · {counts.byWhatsApp} by WhatsApp
                {counts.unreachable > 0 && ` · ${counts.unreachable} with neither`}
              </p>
              {/* A number that drops for a reason should say the reason. */}
              {(counts.noWhatsAppOptIn > 0 || counts.recentlyMessaged > 0) && (
                <p>
                  Held back:
                  {counts.noWhatsAppOptIn > 0 && ` ${counts.noWhatsAppOptIn} with no WhatsApp opt-in`}
                  {counts.noWhatsAppOptIn > 0 && counts.recentlyMessaged > 0 && ' ·'}
                  {counts.recentlyMessaged > 0 && ` ${counts.recentlyMessaged} messaged in the last 7 days`}
                </p>
              )}
              <p>
                People in more than one list are counted once. Anyone unsubscribed is excluded.
              </p>
            </div>
          )}
        </div>

        {wantsEmail && (
          <div className="space-y-3">
            <Field label="Email subject">
              <Input value={draft.emailSubject} disabled={readOnly} onChange={(e) => set({ emailSubject: e.target.value })} />
            </Field>
            <Field label="Email body (HTML)">
              <Textarea rows={9} className="font-mono text-[12.5px]" value={draft.emailHtml} disabled={readOnly}
                onChange={(e) => set({ emailHtml: e.target.value })}
                placeholder="<p>Hello,</p><p>We're offering 20% off storage this December…</p>" />
            </Field>
            {draft.emailHtml && (
              <div className="rounded-lg p-3.5" style={{ background: '#fff', border: '1px solid rgba(20,8,31,.08)' }}>
                <div className="text-[10.5px] font-bold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Preview</div>
                <div className="text-[13px] prose-sm" dangerouslySetInnerHTML={{ __html: draft.emailHtml }} />
              </div>
            )}
          </div>
        )}

        {wantsWa && (
          <div className="space-y-3">
            <Field label="WhatsApp template">
              <Select
                value={draft.whatsapp?.templateName || ''}
                disabled={readOnly || approved.length === 0}
                onChange={(e) => {
                  const t = approved.find((x) => x.name === e.target.value)
                  set({ whatsapp: { templateName: e.target.value, language: t?.language || 'en', variables: [] } })
                }}
              >
                <option value="">{approved.length ? 'Choose an approved template' : 'No approved templates available'}</option>
                {approved.map((t) => (
                  <option key={`${t.name}:${t.language}`} value={t.name}>{t.name} · {t.category} · {t.language}</option>
                ))}
              </Select>
            </Field>
            {picked && (
              <>
                <div className="rounded-lg p-3 text-[13px] whitespace-pre-wrap"
                  style={{ background: '#D9FDD3', color: '#111B21' }}>
                  {picked.bodyText}
                </div>
                {Array.from({ length: picked.variableCount }).map((_, i) => (
                  <Field key={i} label={`Value for {{${i + 1}}}`}>
                    <Input
                      disabled={readOnly}
                      value={draft.whatsapp.variables?.[i] ?? ''}
                      onChange={(e) => {
                        const next = [...(draft.whatsapp.variables || [])]
                        next[i] = e.target.value
                        set({ whatsapp: { ...draft.whatsapp, variables: next } })
                      }}
                    />
                  </Field>
                ))}
              </>
            )}
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
        {note && <p className="text-sm text-emerald-600 font-medium">{note}</p>}

        {!readOnly && (
          <>
            <div className="flex items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save draft'}
              </Button>
              <Button variant="destructive" onClick={() => { if (confirm(`Delete "${draft.name}"?`)) onDelete() }}>
                <Trash2 size={14} /> Delete
              </Button>
            </div>

            {/* A test send is required before the real one. Nobody should read
                this wording for the first time in a customer's inbox. */}
            <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF' }}>
              <div className="text-sm font-semibold">Send yourself a test first</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="max-w-xs" placeholder="your@email.com or 9715…" value={testTo}
                  onChange={(e) => setTestTo(e.target.value)} />
                <Button variant="outline" onClick={() => { save.mutate(); test.mutate() }}
                  disabled={!testTo.trim() || test.isPending}>
                  <Play size={14} /> {test.isPending ? 'Sending…' : 'Send test'}
                </Button>
              </div>

              <Button
                onClick={() => {
                  if (!confirm(`Send "${draft.name}" to ${reach} people? This cannot be undone.`)) return
                  send.mutate()
                }}
                disabled={!tested || send.isPending || reach === 0}
                title={!tested ? 'Send yourself a test first' : undefined}
              >
                <Send size={14} /> {send.isPending ? 'Starting…' : `Send to ${reach} people`}
              </Button>
              {!tested && <p className="text-[12px]" style={{ color: MUTED }}>Send a test before this campaign can go out.</p>}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
