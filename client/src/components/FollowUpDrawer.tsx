import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, ChevronUp, MessageCircle, Phone } from 'lucide-react'
import { api, apiError, followUpQueueApi, whatsappApi, type FollowUpTimelineEntry } from '../lib/api'
import { SlideOver, Skeleton } from './ui'
import {
  INK, MUTED, PURPLE, PURPLE_DEEP, PURPLE_TINT, HAIRLINE, CREAM, DISPLAY,
  REASON_UI, PRIORITY_UI, TEMP_UI, whyFor, agoText, firstNameOf, initialsOf, defaultTemplate, rememberTemplate, customerBadge,
} from '../lib/followUpUi'

const SNOOZES = [['tomorrow', 'Tomorrow'], ['three_days', 'In 3 days'], ['next_week', 'Next week']] as const
const THREAD_LENGTH = 10

/**
 * One lead, ready to act on: why it is in the queue, the last few things
 * said either way, and the one thing to do next.
 *
 * Inside Meta's 24-hour window a customer who is waiting on us gets a plain
 * reply — the drawer sends the rep to the chat. Outside it, only an approved
 * template can go. The send is refused server-side if this person was
 * messaged in the last 12 hours, is not yet due in the cadence, or has
 * since replied; the drawer shows that reason and asks before trying again.
 */
export default function FollowUpDrawer({ leadId, nextLeadId, snapshotAt, onClose, onAdvance, onChanged }: {
  leadId: string
  nextLeadId: string | null
  snapshotAt?: string
  onClose: () => void
  onAdvance: (id: string) => void
  onChanged: () => void
}) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['follow-up-detail', leadId],
    queryFn: () => followUpQueueApi.detail(leadId),
  })
  const item = data?.item ?? null
  const lead = data?.lead

  const [templateName, setTemplateName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [extraVars, setExtraVars] = useState<string[]>([])
  const [confirmResend, setConfirmResend] = useState(false)
  const [allowCustomers, setAllowCustomers] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => { setError(''); setSentTo(''); setConfirmResend(false); setAllowCustomers(false); setShowTemplate(false); setPickerOpen(false); setHistoryOpen(false) }, [leadId])

  const tenant = lead?.customer?.status === 'active' ? lead.customer : null
  const badge = customerBadge(lead?.customer)

  const { data: waData, isLoading: templatesLoading } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => whatsappApi.approvedTemplates(),
    staleTime: 10 * 60_000,
  })
  const templates = waData?.templates ?? []
  useEffect(() => { if (!templateName && templates.length) setTemplateName(defaultTemplate(templates)?.name || '') }, [templates, templateName])
  const template = templates.find((t) => t.name === templateName)
  const extraCount = Math.max(0, (template?.variableCount ?? 1) - 1)
  useEffect(() => { setExtraVars(Array(extraCount).fill('')) }, [templateName, extraCount])
  const extraFilled = extraVars.every((v) => v.trim().length > 0)

  const canReplyInChat = Boolean(item && item.reason === 'sales_response_overdue' && data?.windowOpen)
  const recentSend = Boolean(item?.lastNudgedAt && Date.now() - new Date(item.lastNudgedAt).getTime() < 12 * 3600_000)
  const notDue = Boolean(item && item.window !== 'now' && item.window !== 'today')
  const needsOverride = recentSend || notDue
  const overrideText = !item ? '' : recentSend
    ? `⚠ Already messaged ${agoText(item.lastNudgedAt)}${item.lastNudgedBy ? ` by ${item.lastNudgedBy}` : ''}. Send again anyway.`
    : item.window === 'exhausted'
      ? '⚠ Every follow-up in the cadence has gone out with no reply. Send one more anyway.'
      : `⚠ Not due until ${item.nextContactAt ? new Date(item.nextContactAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'later'} — messaging sooner risks annoying them. Send now anyway.`

  // The conversation, oldest first, last THREAD_LENGTH turns — with our
  // template sends dropped in as system lines so "what did we last send"
  // is answered in the same place.
  const thread = useMemo(() => {
    const entries = (data?.timeline ?? []).filter((t) => t.kind === 'message' || t.kind === 'send')
    return entries.slice(0, THREAD_LENGTH).reverse()
  }, [data])
  const attempts = (data?.timeline ?? []).filter((t) => t.kind === 'attempt')

  const send = useMutation({
    mutationFn: () => followUpQueueApi.send(leadId, {
      templateName, extraVars, snapshotAt, confirmResend, allowCustomers,
      reason: item?.aiSummary || (item ? REASON_UI[item.reason].label : ''),
      daysWaiting: item?.daysWaiting ?? 0,
    }),
    onSuccess: (d) => { setError(''); rememberTemplate(templateName); setSentTo(d.sent[0]?.to || lead?.phone || ''); onChanged(); refetch() },
    onError: (e: unknown) => {
      const reason = (e as { response?: { data?: { reason?: string } } })?.response?.data?.reason
      const overridable = reason === 'sent_recently' || reason === 'not_due_yet' || reason === 'exhausted' || reason === 'active_customer'
      setError(overridable ? `${apiError(e)} — tick the override to send anyway.` : apiError(e))
    },
  })
  const snooze = useMutation({
    mutationFn: (when: string) => api.post(`/whatsapp/${lead?.phoneNormalized}/remind`, { when }),
    onSuccess: () => { onChanged(); nextLeadId ? onAdvance(nextLeadId) : onClose() },
    onError: (e) => setError(apiError(e)),
  })
  const markLost = useMutation({
    mutationFn: () => api.patch(`/leads/${leadId}/status`, { status: 'lost' }),
    onSuccess: () => { onChanged(); nextLeadId ? onAdvance(nextLeadId) : onClose() },
    onError: (e) => setError(apiError(e)),
  })
  // The existing closed status for exactly this case — takes the lead out
  // of every queue without pretending it was won or lost.
  const markCustomer = useMutation({
    mutationFn: () => api.patch(`/leads/${leadId}/status`, { status: 'already_customer' }),
    onSuccess: () => { onChanged(); nextLeadId ? onAdvance(nextLeadId) : onClose() },
    onError: (e) => setError(apiError(e)),
  })

  const preview = template && lead
    ? [firstNameOf(lead.name), ...extraVars.map((v) => v || '{{?}}')]
      .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), template.bodyText)
    : ''
  const nextContactText = !item ? '—'
    : item.window === 'now' ? 'Now'
      : item.window === 'today' ? 'Today'
        : item.window === 'exhausted' ? 'Decide'
          : item.nextContactAt ? new Date(item.nextContactAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Today'

  return (
    <SlideOver open onClose={onClose} title={lead?.name || 'Follow-up'} subtitle={lead ? `${lead.phone} · ${lead.ownerName}${lead.source ? ` · ${lead.source}` : ''}` : ''} width="max-w-2xl">
      {isLoading || !lead ? (
        <div className="p-5 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[90px]" />)}</div>
      ) : (
        <div className="p-5 space-y-4" style={{ color: INK }}>

          {/* ── Why now ──────────────────────────────────────────────────── */}
          <div className="flex items-start gap-3">
            <span className="grid place-items-center rounded-full shrink-0 text-xs font-bold" style={{ width: 40, height: 40, background: '#EDE5FF', color: PURPLE_DEEP }}>{initialsOf(lead.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: REASON_UI[item.reason].bg, color: REASON_UI[item.reason].fg }}>{REASON_UI[item.reason].label}</span>}
                {item && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: PRIORITY_UI[item.priority].bg, color: PRIORITY_UI[item.priority].fg, letterSpacing: '.06em' }}>{PRIORITY_UI[item.priority].label}</span>}
                {lead.temperature && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: TEMP_UI[lead.temperature].bg, color: TEMP_UI[lead.temperature].fg }}>{lead.temperature}</span>}
                {badge && <span title={badge.title} className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>}
                {!item && <span className="text-xs" style={{ color: MUTED }}>Not in the queue right now</span>}
              </div>
              {tenant && (
                <div className="rounded-xl mt-2 p-3 text-xs" style={{ background: '#DCFCE7', color: '#14532D' }}>
                  <div className="font-bold text-[13px]">Already a tenant — {tenant.name || lead.name}</div>
                  {tenant.contracts.map((k) => (
                    <div key={k.contractNo} className="mt-0.5">
                      <Link to={`/contracts`} className="font-semibold underline">{k.contractNo}</Link>{k.unit ? ` · unit ${k.unit}` : ''}{k.endDate ? ` · ends ${new Date(k.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    </div>
                  ))}
                  <div className="mt-1.5" style={{ color: '#166534' }}>A new-enquiry or promo template would be wrong here. Reply in the chat, or if this lead record is just a duplicate of the tenant, close it:</div>
                  <button type="button" disabled={markCustomer.isPending} onClick={() => { if (confirm(`Mark ${lead.name} as already a customer? It leaves the lead queue for good.`)) markCustomer.mutate() }}
                    className="mt-2 cursor-pointer font-semibold px-3 py-1.5 rounded-lg" style={{ background: '#15803D', color: '#fff' }}>Mark as already customer</button>
                </div>
              )}
              {item && (
                <div className="rounded-xl mt-2 p-3" style={{ background: PURPLE_TINT }}>
                  <div className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '.08em', color: PURPLE }}>Why now</div>
                  <p className="text-sm mt-1">{whyFor(item)}</p>
                  {item.nextAction && <p className="text-xs mt-1.5 font-semibold" style={{ color: PURPLE_DEEP }}>Suggested next step: {item.nextAction}</p>}
                </div>
              )}
            </div>
          </div>

          {item && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Last from them', item.lastInboundAt ? agoText(item.lastInboundAt) : 'never'],
                ['Last from us', item.lastOutboundAt || item.lastSentAt ? agoText([item.lastOutboundAt, item.lastSentAt].filter(Boolean).sort().pop()!) : 'never'],
                ['Next contact', nextContactText],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border px-2 py-2" style={{ borderColor: HAIRLINE }}>
                  <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '.06em', color: MUTED }}>{k}</div>
                  <div className="text-sm font-semibold mt-0.5 truncate">{v}</div>
                </div>
              ))}
            </div>
          )}
          {item && item.reason === 'customer_quiet' && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {Array.from({ length: item.quietStage.total }).map((_, i) => {
                const n = i + 1
                const done = item.quietStage.exhausted || n < item.quietStage.next
                const current = !item.quietStage.exhausted && n === item.quietStage.next
                return (
                  <div key={n} className="flex items-center gap-1.5">
                    <span className="grid place-items-center rounded-full text-[10px] font-bold" style={{ width: 20, height: 20, background: done ? '#DCFCE7' : current ? PURPLE : '#EEE9F6', color: done ? '#047857' : current ? '#fff' : MUTED }}>{done ? <Check size={11} /> : n}</span>
                    <span style={{ color: current ? INK : MUTED, fontWeight: current ? 600 : 400 }}>Follow-up {n}</span>
                    {n < item.quietStage.total && <span style={{ width: 12, height: 1, background: HAIRLINE }} />}
                  </div>
                )
              })}
              {item.quietStage.exhausted && <span className="font-semibold" style={{ color: '#8A5A00' }}>· all sent, no reply — decide</span>}
            </div>
          )}

          {/* ── The conversation ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '.08em', color: MUTED }}>Last {Math.min(thread.length, THREAD_LENGTH) || ''} messages</div>
              <Link to={`/whatsapp?phone=${lead.phoneNormalized}`} className="text-xs font-semibold" style={{ color: PURPLE_DEEP }}>Open full chat →</Link>
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: '#ECE5DD' }}>
              {thread.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: MUTED }}>No messages on record yet.</p>
              ) : thread.map((t, i) => <ThreadRow key={i} t={t} />)}
            </div>
          </div>

          {/* ── Message ──────────────────────────────────────────────────── */}
          {sentTo ? (
            <div className="rounded-2xl border p-4" style={{ borderColor: '#A7F3D0', background: '#ECFDF5' }}>
              <div className="flex items-center gap-2">
                <span className="grid place-items-center rounded-full" style={{ width: 28, height: 28, background: '#DCFCE7', color: '#047857' }}><Check size={15} /></span>
                <p className="text-sm font-semibold">Sent to {sentTo}</p>
              </div>
              <p className="text-xs mt-1" style={{ color: MUTED }}>Logged. They move to their next day in the cadence; if they reply, they come straight back under Needs reply.</p>
              <div className="flex gap-2 mt-3">
                {nextLeadId
                  ? <button type="button" onClick={() => onAdvance(nextLeadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-bold cursor-pointer" style={{ background: PURPLE, color: '#fff' }}>Next lead <ArrowRight size={14} /></button>
                  : <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-bold cursor-pointer" style={{ background: PURPLE, color: '#fff' }}>Done</button>}
              </div>
            </div>
          ) : item ? (
            <div className="rounded-2xl border" style={{ borderColor: HAIRLINE, background: '#fff' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: HAIRLINE }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: '-.02em' }}>Send a WhatsApp message</div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: data?.windowOpen ? '#DCFCE7' : '#FEF3C7', color: data?.windowOpen ? '#047857' : '#92400E' }}>
                  {data?.windowOpen ? '24-hour window open' : 'Outside 24-hour window — template only'}
                </span>
              </div>

              {canReplyInChat && !showTemplate ? (
                <div className="p-4">
                  <p className="text-sm">They wrote {agoText(item.since)} and are still inside the 24-hour window — the right move is a plain reply in the chat.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Link to={`/whatsapp?phone=${lead.phoneNormalized}`} className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-bold" style={{ background: '#25D366', color: '#fff' }}>
                      <MessageCircle size={15} /> Reply in chat
                    </Link>
                    <button type="button" onClick={() => setShowTemplate(true)} className="h-10 px-4 rounded-lg border text-sm font-semibold cursor-pointer" style={{ borderColor: HAIRLINE }}>Send a template instead</button>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {/* Template: one row, expandable */}
                  {templatesLoading ? <Skeleton className="h-[40px]" /> : templates.length === 0 ? (
                    <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#FFF7E6', color: '#8A5A00' }}>{waData?.error || 'No approved WhatsApp templates found.'}</p>
                  ) : (
                    <div className="rounded-xl border" style={{ borderColor: HAIRLINE }}>
                      <button type="button" onClick={() => setPickerOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer text-left">
                        <span className="text-xs" style={{ color: MUTED }}>Template</span>
                        <span className="flex-1 text-sm font-semibold truncate">{template?.label || 'Choose a template'}</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold shrink-0" style={{ color: PURPLE_DEEP }}>
                          Change {pickerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                      </button>
                      {pickerOpen && (
                        <div className="px-3 pb-3 flex flex-wrap gap-1.5 border-t pt-3" style={{ borderColor: HAIRLINE }}>
                          {templates.map((t) => (
                            <button key={t.name} type="button" onClick={() => { setTemplateName(t.name); setPickerOpen(false) }}
                              className="cursor-pointer text-xs font-semibold px-3 py-1.5 rounded-full"
                              style={{ background: templateName === t.name ? PURPLE : PURPLE_TINT, color: templateName === t.name ? '#fff' : PURPLE_DEEP, border: `1px solid ${templateName === t.name ? PURPLE : 'rgba(91,43,201,.18)'}` }}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {extraCount > 0 && (
                    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'rgba(20,8,31,.12)', background: CREAM }}>
                      <p className="text-xs" style={{ color: MUTED }}>This template needs {extraCount} more detail{extraCount === 1 ? '' : 's'}.</p>
                      {extraVars.map((v, i) => (
                        <input key={i} value={v} placeholder={`{{${i + 2}}}`}
                          onChange={(e) => setExtraVars((prev) => prev.map((x, n) => (n === i ? e.target.value : x)))}
                          className="w-full rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: 'rgba(20,8,31,.14)' }} />
                      ))}
                    </div>
                  )}
                  {template && (
                    <div className="rounded-xl p-3" style={{ background: '#ECE5DD' }}>
                      <div className="ml-auto" style={{ maxWidth: '92%', background: '#DCF8C6', borderRadius: '10px 10px 2px 10px', padding: '9px 11px' }}>
                        <p className="text-[13px] whitespace-pre-wrap" style={{ color: INK, lineHeight: 1.5 }}>{preview}</p>
                        <div className="text-right text-[10px] mt-1" style={{ color: '#6B7B60' }}>preview ✓✓</div>
                      </div>
                    </div>
                  )}
                  {needsOverride && (
                    <label className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer select-none" style={{ background: '#FFF1CC', color: '#8A5A00' }}>
                      <input type="checkbox" checked={confirmResend} onChange={(e) => setConfirmResend(e.target.checked)} className="mt-0.5" style={{ accentColor: PURPLE }} />
                      <span>{overrideText}</span>
                    </label>
                  )}
                  {tenant && (
                    <label className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer select-none" style={{ background: '#DCFCE7', color: '#166534' }}>
                      <input type="checkbox" checked={allowCustomers} onChange={(e) => setAllowCustomers(e.target.checked)} className="mt-0.5" style={{ accentColor: '#15803D' }} />
                      <span>This is an active tenant. I&rsquo;ve checked that <b>{template?.label || 'this template'}</b> is right for an existing customer — send it.</span>
                    </label>
                  )}
                  {error && <p className="text-xs" style={{ color: '#B91C1C' }}>{error}</p>}
                  <button type="button" disabled={!templateName || !extraFilled || send.isPending || (needsOverride && !confirmResend) || (Boolean(tenant) && !allowCustomers)} onClick={() => send.mutate()}
                    className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-bold cursor-pointer disabled:opacity-40"
                    style={{ background: '#16A34A', color: '#fff' }}>
                    <MessageCircle size={15} /> {send.isPending ? 'Sending…' : 'Send via WhatsApp'}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Other actions ────────────────────────────────────────────── */}
          {item && !sentTo && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span style={{ color: MUTED }}>Snooze:</span>
              {SNOOZES.map(([when, label]) => (
                <button key={when} type="button" disabled={snooze.isPending} onClick={() => snooze.mutate(when)}
                  className="cursor-pointer font-semibold px-3 py-1.5 rounded-full" style={{ background: PURPLE_TINT, color: PURPLE_DEEP }}>{label}</button>
              ))}
              <a href={`tel:${lead.phone}`} className="ml-auto inline-flex items-center gap-1 font-semibold px-3 py-1.5 rounded-full border" style={{ borderColor: HAIRLINE, color: INK }}><Phone size={12} /> Call</a>
              <button type="button" disabled={markLost.isPending} onClick={() => { if (confirm(`Mark ${lead.name} as lost? Pending follow-ups stop.`)) markLost.mutate() }}
                className="cursor-pointer font-semibold px-3 py-1.5 rounded-full" style={{ background: '#FEE2E2', color: '#B91C1C' }}>Mark lost</button>
            </div>
          )}

          {/* ── Attempts / full history, collapsed ───────────────────────── */}
          {(attempts.length > 0 || (data?.timeline.length ?? 0) > thread.length) && (
            <div>
              <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold cursor-pointer" style={{ color: MUTED }}>
                {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Full history ({data?.timeline.length}{attempts.length ? `, ${attempts.length} call attempt${attempts.length === 1 ? '' : 's'}` : ''})
              </button>
              {historyOpen && (
                <ol className="space-y-2 mt-2">
                  {data?.timeline.map((t, i) => <TimelineRow key={i} t={t} />)}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </SlideOver>
  )
}

function ThreadRow({ t }: { t: FollowUpTimelineEntry }) {
  const when = new Date(t.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (t.kind === 'send') {
    return (
      <div className="text-center">
        <span className="inline-block text-[11px] px-2.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,.75)', color: t.status === 'sent' ? '#4A4357' : '#B91C1C' }}>
          Follow-up {t.status === 'sent' ? 'sent' : 'failed'}: {t.label}{t.by ? ` · ${t.by}` : ''} · {when}
        </span>
      </div>
    )
  }
  if (t.kind !== 'message') return null
  const inbound = t.direction === 'inbound'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div style={{ maxWidth: '85%', background: inbound ? '#fff' : '#DCF8C6', borderRadius: inbound ? '10px 10px 10px 2px' : '10px 10px 2px 10px', padding: '7px 10px', boxShadow: '0 1px 1px rgba(0,0,0,.06)' }}>
        <p className="text-[13px] whitespace-pre-wrap" style={{ color: INK, lineHeight: 1.45 }}>{t.text || '—'}</p>
        <div className="text-[10px] mt-0.5 text-right" style={{ color: '#6B7B60' }}>{when}{!inbound && t.status ? ` · ${t.status}` : ''}</div>
      </div>
    </div>
  )
}

function TimelineRow({ t }: { t: FollowUpTimelineEntry }) {
  const when = new Date(t.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (t.kind === 'send') {
    const ok = t.status === 'sent'
    return (
      <li className="flex gap-3 text-xs">
        <span className="shrink-0 w-[92px]" style={{ color: MUTED }}>{when}</span>
        <span className="min-w-0">
          <span className="font-semibold" style={{ color: ok ? PURPLE_DEEP : '#B91C1C' }}>Follow-up {ok ? 'sent' : 'failed'}: {t.label}</span>
          {t.by && <span style={{ color: MUTED }}> · by {t.by}</span>}
          {t.repliedAt && <span style={{ color: '#047857' }}> · replied {agoText(t.repliedAt)}</span>}
          {!ok && t.error && <span className="block" style={{ color: '#B91C1C' }}>{t.error}</span>}
        </span>
      </li>
    )
  }
  if (t.kind === 'attempt') {
    return (
      <li className="flex gap-3 text-xs">
        <span className="shrink-0 w-[92px]" style={{ color: MUTED }}>{when}</span>
        <span className="min-w-0">
          <span className="font-semibold">Attempt {t.no} · {t.channel.replace('_', ' ')} · {t.outcome.replace('_', ' ')}</span>
          {t.note && <span className="block" style={{ color: '#4A4357' }}>{t.note}</span>}
        </span>
      </li>
    )
  }
  const inbound = t.direction === 'inbound'
  return (
    <li className="flex gap-3 text-xs">
      <span className="shrink-0 w-[92px]" style={{ color: MUTED }}>{when}</span>
      <span className="min-w-0 flex-1">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5" style={{ background: inbound ? '#DCFCE7' : PURPLE_TINT, color: inbound ? '#047857' : PURPLE_DEEP }}>{inbound ? 'THEM' : 'US'}</span>
        <span style={{ color: '#4A4357' }}>{t.text || '—'}</span>
      </span>
    </li>
  )
}
