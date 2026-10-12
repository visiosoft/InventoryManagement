import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Megaphone, Send, RefreshCw, Repeat, ArrowLeft, Check, CheckCheck, Eye, MessageCircle, AlertTriangle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Spinner, Table, Th, Td } from '../components/ui'
import { statusLabel } from '../components/ui'
import CampaignTemplates from './CampaignTemplates'
import { OptInPanel } from '../components/OptInPanel'

const PURPLE = '#5B2BC9'
const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.10)'

type Person = {
  id: string; name: string; phone: string; email: string; stage: string; source: string; leadDate: string; optIn: boolean
  lastCampaign: { name: string; at: string; read: boolean; replied: boolean } | null
}
type People = { total: number; page: number; pages: number; rows: Person[] }

type WaTemplate = {
  name: string; language: string; status: string; category: string; bodyText: string; variableCount: number; headerFormat?: string
}
type Channels = { whatsapp: boolean; templates: { configured: boolean; error: string; approved: WaTemplate[]; all: WaTemplate[] } }

type Funnel = { targeted: number; sent: number; delivered: number; read: number; replied: number; failed: number }
type ReportRow = {
  _id: string; name: string; status: string; createdAt: string; startedAt: string | null; createdByName: string
  template: string; headerImageUrl: string; funnel: Funnel
}
type Recipient = {
  id: string; refId: string; name: string; phone: string; status: string; reason: string
  sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null
}
type Report = {
  campaign: { _id: string; name: string; status: string; startedAt: string | null; finishedAt: string | null; createdByName: string; whatsapp: { templateName: string; headerImageUrl?: string } }
  funnel: Funnel
  failureReasons: { reason: string; count: number }[]
  segments: Record<string, string>
  recipients: Recipient[]
}

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : ''
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—')

const STAGES = [
  ['lost', 'Dead Lead / Lost'], ['new', 'New Lead'], ['contact_attempted', 'Contact Attempted'], ['contacted', 'Contacted'],
  ['site_visit_scheduled', 'Site Visit Scheduled'], ['follow_up_scheduled', 'Follow-Up Scheduled'], ['quotation_sent', 'Quotation Sent'],
] as const

/** The second half of the page: who got what, and what they did with it. */
function Reports({ onRetarget }: { onRetarget: (campaignId: string) => void }) {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)

  const { data: list, isLoading } = useQuery<ReportRow[]>({
    queryKey: ['campaign-reports'],
    queryFn: () => api.get('/campaigns/reports').then((r) => r.data),
    refetchInterval: 20_000,
  })

  if (openId) return <ReportDetail id={openId} onBack={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ['campaign-reports'] }) }} onRetarget={onRetarget} />

  return (
    <Card>
      <CardHeader title="Campaign reports" subtitle="Sent, delivered, read and replied — from Meta's delivery receipts and your inbox" />
      <CardBody>
        {isLoading ? <Spinner /> : !list?.length ? (
          <p className="text-sm" style={{ color: MUTED }}>No campaigns yet. Send your first one from "New campaign".</p>
        ) : (
          <Table>
            <thead>
              <tr><Th>Campaign</Th><Th>Sent</Th><Th>Delivered</Th><Th>Read</Th><Th>Replied</Th><Th>Failed</Th><Th>When</Th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(c._id)}>
                  <Td>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs" style={{ color: MUTED }}>{c.template || 'no template yet'} · {c.status}</div>
                  </Td>
                  <Td>{c.funnel.sent}<span className="text-xs" style={{ color: MUTED }}> of {c.funnel.targeted}</span></Td>
                  <Td>{c.funnel.delivered}<span className="text-xs" style={{ color: MUTED }}> {pct(c.funnel.delivered, c.funnel.sent)}</span></Td>
                  <Td>{c.funnel.read}<span className="text-xs" style={{ color: MUTED }}> {pct(c.funnel.read, c.funnel.sent)}</span></Td>
                  <Td>{c.funnel.replied}<span className="text-xs" style={{ color: MUTED }}> {pct(c.funnel.replied, c.funnel.sent)}</span></Td>
                  <Td>{c.funnel.failed || '—'}</Td>
                  <Td className="text-xs whitespace-nowrap">{fmt(c.startedAt || c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}

function ReportDetail({ id, onBack, onRetarget }: { id: string; onBack: () => void; onRetarget: (campaignId: string) => void }) {
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')
  const { data, isLoading } = useQuery<Report>({
    queryKey: ['campaign-report', id],
    queryFn: () => api.get(`/campaigns/${id}/report`).then((r) => r.data),
    refetchInterval: 15_000,
  })
  const retarget = useMutation({
    mutationFn: (segment: string) => api.post(`/campaigns/${id}/retarget`, { segment }).then((r) => r.data as { _id: string }),
    onSuccess: (d) => onRetarget(d._id),
    onError: (e) => setErr(apiError(e)),
  })

  const counts = useMemo(() => {
    const r = data?.recipients ?? []
    return {
      not_read: r.filter((x) => x.status === 'sent' && !x.readAt).length,
      not_delivered: r.filter((x) => x.status === 'sent' && !x.deliveredAt && !x.readAt).length,
      read_no_reply: r.filter((x) => x.status === 'sent' && x.readAt && !x.repliedAt).length,
      delivered_no_reply: r.filter((x) => x.status === 'sent' && (x.deliveredAt || x.readAt) && !x.repliedAt).length,
      replied: r.filter((x) => x.status === 'sent' && x.repliedAt).length,
      failed: r.filter((x) => x.status === 'failed').length,
    } as Record<string, number>
  }, [data])

  if (isLoading || !data) return <Spinner />
  const f = data.funnel
  const shown = data.recipients.filter((x) => {
    if (!filter) return true
    if (filter === 'failed') return x.status === 'failed'
    if (filter === 'replied') return Boolean(x.repliedAt)
    if (filter === 'read') return Boolean(x.readAt)
    if (filter === 'not_read') return x.status === 'sent' && !x.readAt
    return true
  })

  const bar = (label: string, n: number, of: number, color: string) => (
    <div className="space-y-1" key={label}>
      <div className="flex justify-between text-[13px]"><span>{label}</span><span><strong>{n}</strong> <span style={{ color: MUTED }}>{pct(n, of)}</span></span></div>
      <div style={{ height: 8, borderRadius: 999, background: '#F1ECE2' }}>
        <div style={{ width: of > 0 ? `${Math.min(100, (n / of) * 100)}%` : 0, height: 8, borderRadius: 999, background: color }} />
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold cursor-pointer" style={{ color: PURPLE }}>
        <ArrowLeft size={14} /> All campaigns
      </button>

      <Card>
        <CardHeader
          title={data.campaign.name}
          subtitle={`${data.campaign.whatsapp?.templateName || ''} · started ${fmt(data.campaign.startedAt)} by ${data.campaign.createdByName || '—'}`}
        />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              {bar('Sent', f.sent, f.targeted, '#5B2BC9')}
              {bar('Delivered', f.delivered, f.sent, '#2563EB')}
              {bar('Read', f.read, f.sent, '#16A34A')}
              {bar('Replied', f.replied, f.sent, '#D97706')}
              {f.failed > 0 && bar('Failed', f.failed, f.targeted, '#DC2626')}
              <p className="text-xs" style={{ color: MUTED }}>
                "Read" only counts people who have read receipts switched on in WhatsApp, so it is a minimum. Replies are people who wrote back within 14 days.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold flex items-center gap-1.5"><Repeat size={14} /> Follow up with…</div>
              <p className="text-xs" style={{ color: MUTED }}>Pick a group and choose a new approved template for them. It opens as a draft, nothing is sent yet.</p>
              <div className="flex flex-wrap gap-2">
                {(['not_read', 'read_no_reply', 'delivered_no_reply', 'replied', 'not_delivered', 'failed'] as const).map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    disabled={!counts[seg] || retarget.isPending}
                    onClick={() => { setErr(''); retarget.mutate(seg) }}
                    className="rounded-full px-3 h-8 text-[12.5px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ border: `1px solid ${LINE}`, background: '#fff' }}
                  >
                    {data.segments[seg]} · {counts[seg]}
                  </button>
                ))}
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              {data.failureReasons.length > 0 && (
                <div className="text-xs space-y-0.5" style={{ color: MUTED }}>
                  <div className="font-semibold" style={{ color: '#B91C1C' }}>Why messages failed</div>
                  {data.failureReasons.map((r) => <div key={r.reason}>{r.count} × {r.reason}</div>)}
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who got it"
          action={
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Everybody ({data.recipients.length})</option>
              <option value="read">Read it</option>
              <option value="replied">Replied</option>
              <option value="not_read">Did not read</option>
              <option value="failed">Failed</option>
            </Select>
          }
        />
        <CardBody>
          <Table>
            <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th>Sent</Th><Th>Read</Th><Th>Replied</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name || <span style={{ color: MUTED }}>(no name)</span>}</Td>
                  <Td className="whitespace-nowrap">{r.phone}</Td>
                  <Td>
                    {r.status === 'failed' ? <Badge tone="red">Failed</Badge>
                      : r.repliedAt ? <Badge tone="amber">Replied</Badge>
                        : r.readAt ? <Badge tone="green"><Eye size={11} /> Read</Badge>
                          : r.deliveredAt ? <Badge tone="blue"><CheckCheck size={11} /> Delivered</Badge>
                            : <Badge tone="default"><Check size={11} /> Sent</Badge>}
                    {r.status === 'failed' && r.reason && <div className="text-xs" style={{ color: MUTED }}>{r.reason}</div>}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{fmt(r.sentAt)}</Td>
                  <Td className="text-xs whitespace-nowrap">{fmt(r.readAt)}</Td>
                  <Td className="text-xs whitespace-nowrap">{fmt(r.repliedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  )
}

export default function CampaignStudio() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'new' | 'reports' | 'templates'>('new')

  // 1 · people
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('lost')
  const [from, setFrom] = useState('2026-08-15')
  const [to, setTo] = useState('')
  const [excludeCustomers, setExcludeCustomers] = useState(true)
  const [hasEmail, setHasEmail] = useState(false)
  const [optInOnly, setOptInOnly] = useState(false)
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draftId, setDraftId] = useState<string | null>(null)

  // 2 · message
  const [templateName, setTemplateName] = useState('')
  const [headerImageUrl, setHeaderImageUrl] = useState('')
  const [variables, setVariables] = useState<string[]>([])
  const [testPhone, setTestPhone] = useState('')

  // 3 · send
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { setPage(1) }, [search, stage, from, to, excludeCustomers, hasEmail, optInOnly, sort])

  const params = { search: search || undefined, stage: stage || undefined, from: from || undefined, to: to || undefined, excludeCustomers: excludeCustomers ? '1' : '0', hasEmail: hasEmail ? '1' : '0', optIn: optInOnly ? '1' : '0', sort }
  const { data: people, isFetching } = useQuery<People>({
    queryKey: ['studio-people', params, page],
    queryFn: () => api.get('/campaigns/people', { params: { ...params, page, limit: 50 } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const { data: channels, refetch: refetchChannels, isFetching: refreshing } = useQuery<Channels>({
    queryKey: ['studio-channels'],
    queryFn: () => api.get('/campaigns/channels').then((r) => r.data),
  })
  const templates = channels?.templates.all ?? []
  const picked = templates.find((t) => t.name === templateName && t.status === 'APPROVED')

  const audience = { tenants: false, pastTenants: false, leads: true, leadIds: [...selected], excludeCustomers: false, minDaysBetween: 3 }
  const { data: counts } = useQuery<{ counts: { total: number; byWhatsApp: number; noWhatsAppOptIn: number; recentlyMessaged: number } }>({
    queryKey: ['studio-preview', [...selected].sort().join(',')],
    queryFn: () => api.post('/campaigns/preview', { audience }).then((r) => r.data),
    enabled: selected.size > 0,
  })

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pageIds = people?.rows.map((p) => p.id) ?? []
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  async function selectAllMatching() {
    try {
      const { data } = await api.get<{ ids: string[] }>('/campaigns/people/ids', { params })
      setSelected(new Set(data.ids))
    } catch (e) { setErr(apiError(e)) }
  }

  /** Create (or update) the draft with what is on screen. */
  async function saveDraft(): Promise<string> {
    const body = {
      name: name.trim() || 'WhatsApp campaign',
      channel: 'whatsapp',
      audience,
      whatsapp: { templateName, language: picked?.language || 'en', variables, headerImageUrl },
    }
    if (draftId) { await api.put(`/campaigns/${draftId}`, body); return draftId }
    const { data } = await api.post<{ _id: string }>('/campaigns', body)
    setDraftId(data._id)
    return data._id
  }

  const test = useMutation({
    mutationFn: async () => { const id = await saveDraft(); return api.post(`/campaigns/${id}/test`, { phone: testPhone }).then((r) => r.data) },
    onSuccess: () => { setErr(''); setNote('Test sent. Check that phone.') },
    onError: (e) => { setNote(''); setErr(apiError(e)) },
  })
  const send = useMutation({
    mutationFn: async () => {
      const id = await saveDraft()
      return api.post(`/campaigns/${id}/send`).then((r) => r.data as { targeted: number })
    },
    onSuccess: (d) => {
      setErr(''); setNote(`Sending to ${d.targeted} people. Follow it in Reports.`)
      setSelected(new Set()); setDraftId(null); setName('')
      qc.invalidateQueries({ queryKey: ['campaign-reports'] })
      setTab('reports')
    },
    onError: (e) => { setNote(''); setErr(apiError(e)) },
  })

  /** A retargeting draft arrives with its people already chosen. */
  async function openDraft(id: string) {
    try {
      const { data } = await api.get<{ campaign: { _id: string; name: string; audience: { leadIds?: string[] } } }>(`/campaigns/${id}`)
      setDraftId(id)
      setName(data.campaign.name)
      setSelected(new Set((data.campaign.audience.leadIds ?? []).map(String)))
      setTemplateName(''); setHeaderImageUrl(''); setVariables([])
      setTab('new')
      setNote('Follow-up draft: choose a new template below, then send.')
    } catch (e) { setErr(apiError(e)) }
  }

  const needsImage = picked?.headerFormat === 'IMAGE'
  const imageOk = !needsImage || /^https:\/\//i.test(headerImageUrl)
  const canSend = selected.size > 0 && Boolean(picked) && imageOk && (counts?.counts.byWhatsApp ?? 1) > 0 && !send.isPending

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Campaign Studio"
        subtitle="Pick people, send them a Meta-approved WhatsApp template, then follow what they do."
      />

      <div className="flex flex-wrap gap-2">
        {([['new', 'New campaign'], ['templates', 'My templates'], ['reports', 'Reports & retargeting']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="rounded-full px-4 h-9 text-sm font-semibold cursor-pointer whitespace-nowrap"
            style={{ background: tab === k ? PURPLE : '#fff', color: tab === k ? '#fff' : '#14081F', border: `1px solid ${tab === k ? PURPLE : LINE}` }}
          >
            {label}
          </button>
        ))}
        <Link to="/marketing" className="sm:ml-auto basis-full sm:basis-auto self-center text-xs font-semibold" style={{ color: MUTED }}>Email & tenant campaigns →</Link>
      </div>

      {tab === 'templates' && <CampaignTemplates />}
      {tab === 'reports' && <Reports onRetarget={openDraft} />}

      {tab === 'new' && (
        <>
          {/* 1 · People */}
          <Card>
            <CardHeader title="1 · Who gets it" subtitle={`${selected.size} selected${people ? ` · ${people.total} match the filters` : ''}`} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="w-52"><Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, number or email" /></Field></div>
                <div className="w-48">
                  <Field label="Stage">
                    <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                      <option value="">Every stage</option>
                      {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="w-40"><Field label="Came in from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
                <div className="w-40"><Field label="Up to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
                <div className="w-40">
                  <Field label="Sort">
                    <Select value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="name">Name A–Z</option>
                    </Select>
                  </Field>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={excludeCustomers} onChange={(e) => setExcludeCustomers(e.target.checked)} /> Leave out customers</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Only with an email</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={optInOnly} onChange={(e) => setOptInOnly(e.target.checked)} /> Only with a WhatsApp opt-in</label>
                {isFetching && <span style={{ color: MUTED }}>Loading…</span>}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Button variant="outline" onClick={() => setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id))); return n })}>
                  {allOnPage ? 'Unselect this page' : 'Select this page'}
                </Button>
                <Button variant="outline" onClick={selectAllMatching}>Select all {people?.total ?? ''} matching</Button>
                {selected.size > 0 && <Button variant="outline" onClick={() => setSelected(new Set())}>Clear selection</Button>}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr><Th className="w-8"></Th><Th>Name</Th><Th>Phone</Th><Th>Email</Th><Th>Stage</Th><Th>Came in</Th><Th>Opt-in</Th><Th>Last campaign</Th></tr>
                  </thead>
                  <tbody>
                    {(people?.rows ?? []).map((p) => (
                      <tr key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(p.id)}>
                        <Td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} /></Td>
                        <Td>{p.name || <span style={{ color: MUTED }}>(no name)</span>}</Td>
                        <Td className="whitespace-nowrap">{p.phone}</Td>
                        <Td className="max-w-48 truncate">{p.email}</Td>
                        <Td>{statusLabel(p.stage)}</Td>
                        <Td className="text-xs whitespace-nowrap">{fmt(p.leadDate)}</Td>
                        <Td>{p.optIn ? <Badge tone="green">Yes</Badge> : <Badge tone="default">No</Badge>}</Td>
                        <Td className="text-xs">
                          {p.lastCampaign ? <>{p.lastCampaign.name}<div style={{ color: MUTED }}>{fmt(p.lastCampaign.at)}{p.lastCampaign.replied ? ' · replied' : p.lastCampaign.read ? ' · read' : ''}</div></> : '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {people && people.pages > 1 && (
                <div className="flex items-center gap-3 text-sm">
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span>Page {page} of {people.pages}</span>
                  <Button variant="outline" disabled={page >= people.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* 2 · Message */}
          <Card>
            <CardHeader
              title="2 · The message"
              subtitle="WhatsApp only lets a business start a conversation with a template Meta has approved."
              action={<Button variant="outline" onClick={() => refetchChannels()} disabled={refreshing}><RefreshCw size={13} /> Refresh from Meta</Button>}
            />
            <CardBody className="space-y-3">
              {channels && !channels.whatsapp && <p className="text-sm text-destructive">WhatsApp is not connected.</p>}
              {channels?.templates.error && <p className="text-sm text-destructive">{channels.templates.error}</p>}

              <div className="grid gap-2 md:grid-cols-2">
                {templates.map((t) => {
                  const ok = t.status === 'APPROVED'
                  const on = ok && templateName === t.name
                  return (
                    <button
                      key={`${t.name}:${t.language}`}
                      type="button"
                      disabled={!ok}
                      onClick={() => { setTemplateName(t.name); setVariables(Array.from({ length: t.variableCount }, (_, i) => (i === 0 ? '{first_name}' : ''))) }}
                      className="text-left rounded-xl p-3 cursor-pointer disabled:cursor-not-allowed"
                      style={{ border: `1px solid ${on ? PURPLE : LINE}`, background: on ? '#F7F3FF' : ok ? '#fff' : '#FAF7F2', opacity: ok ? 1 : 0.7 }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{t.name}</span>
                        <Badge tone={ok ? 'green' : t.status === 'PENDING' ? 'amber' : 'red'}>{ok ? 'Approved' : t.status === 'PENDING' ? 'Waiting for Meta' : statusLabel(t.status.toLowerCase())}</Badge>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: MUTED }}>{t.category} · {t.language}{t.headerFormat ? ` · ${t.headerFormat.toLowerCase()} header` : ''}</div>
                      <div className="text-[12.5px] mt-1.5 line-clamp-3 whitespace-pre-wrap">{t.bodyText}</div>
                    </button>
                  )
                })}
              </div>
              {templates.length === 0 && (
                <p className="text-sm" style={{ color: MUTED }}>
                  No approved templates yet. Write one in the "My templates" tab and send it to Meta. It becomes usable here the moment Meta approves it.
                </p>
              )}

              {picked && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    {needsImage && (
                      <>
                        <Field label="Image above the text (public https link)">
                          <Input value={headerImageUrl} onChange={(e) => setHeaderImageUrl(e.target.value.trim())} placeholder="https://purplebox.ae/images/offer.jpg" />
                        </Field>
                        {!imageOk && <p className="text-xs text-destructive">This template needs an image link starting with https://</p>}
                      </>
                    )}
                    {picked.variableCount > 0 && Array.from({ length: picked.variableCount }).map((_, i) => (
                      <Field key={i} label={`Value for {{${i + 1}}}`}>
                        <Input value={variables[i] ?? ''} onChange={(e) => setVariables((v) => { const n = [...v]; n[i] = e.target.value; return n })} />
                      </Field>
                    ))}
                    {picked.variableCount > 0 && <p className="text-xs" style={{ color: MUTED }}>Use <code>{'{first_name}'}</code> or <code>{'{name}'}</code> for each person's own name.</p>}
                    <div className="flex gap-2 items-end pt-1">
                      <div className="flex-1"><Field label="Send a test to"><Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="971…" /></Field></div>
                      <Button variant="outline" disabled={!testPhone || !imageOk || test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send test'}</Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Preview</div>
                    <div className="rounded-xl overflow-hidden" style={{ background: '#D9FDD3', color: '#111B21', maxWidth: 320 }}>
                      {needsImage && /^https:\/\//i.test(headerImageUrl) && <img src={headerImageUrl} alt="" className="w-full max-h-56 object-cover" />}
                      <div className="p-3 text-[13px] whitespace-pre-wrap">
                        {picked.bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => (variables[Number(n) - 1] || `{{${n}}}`).replace(/\{first_name\}/gi, 'Sara').replace(/\{name\}/gi, 'Sara Khan'))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* 3 · Send */}
          <Card>
            <CardHeader title="3 · Review and send" />
            <CardBody className="space-y-3">
              <div className="max-w-md"><Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Winback — lost leads Aug–Oct" /></Field></div>
              <div className="rounded-lg p-3 text-[13px] space-y-1" style={{ background: '#FBF8F3', border: `1px solid ${LINE}` }}>
                <p><strong>{selected.size}</strong> people selected{picked ? <> · template <strong>{picked.name}</strong></> : ' · no template chosen yet'}</p>
                {counts && (
                  <p style={{ color: MUTED }}>
                    <strong style={{ color: PURPLE }}>{counts.counts.byWhatsApp}</strong> will actually be sent to
                    {counts.counts.noWhatsAppOptIn > 0 && ` · ${counts.counts.noWhatsAppOptIn} held back: no WhatsApp opt-in`}
                    {counts.counts.recentlyMessaged > 0 && ` · ${counts.counts.recentlyMessaged} messaged in the last 3 days`}
                  </p>
                )}
                {counts && counts.counts.noWhatsAppOptIn > 0 && (
                  <p className="flex items-start gap-1.5 text-amber-700"><AlertTriangle size={13} className="mt-0.5" /> Meta requires an opt-in before a marketing message. People who wrote to you first can be opted in with the box below.</p>
                )}
              </div>
              {counts && counts.counts.noWhatsAppOptIn > 0 && <OptInPanel />}
              {err && <p className="text-sm text-destructive">{err}</p>}
              {note && <p className="text-sm font-medium text-emerald-600">{note}</p>}
              <Button
                disabled={!canSend}
                onClick={() => {
                  if (confirm(`Send "${picked?.name}" to ${counts?.counts.byWhatsApp ?? selected.size} people on WhatsApp now?`)) send.mutate()
                }}
              >
                <Send size={14} /> {send.isPending ? 'Starting…' : 'Send campaign'}
              </Button>
              <p className="text-xs flex items-center gap-1.5" style={{ color: MUTED }}><MessageCircle size={12} /> Messages go out in small batches. Delivered, read and replies appear in Reports as Meta reports them.</p>
            </CardBody>
          </Card>
        </>
      )}
      <div style={{ display: 'none' }}><Megaphone /></div>
    </div>
  )
}
