import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, MessageCircle, Phone } from 'lucide-react'
import { api, apiError, followUpQueueApi, whatsappApi, type FollowUpTimelineEntry } from '../lib/api'
import { SlideOver, Skeleton } from './ui'
import {
  INK, MUTED, PURPLE, PURPLE_DEEP, PURPLE_TINT, HAIRLINE, CREAM, DISPLAY,
  REASON_UI, PRIORITY_UI, TEMP_UI, whyFor, agoText, firstNameOf, initialsOf,
} from '../lib/followUpUi'

const SNOOZES = [['tomorrow', 'Tomorrow'], ['three_days', 'In 3 days'], ['next_week', 'Next week']] as const

/**
 * One lead, ready to act on: why it is in the queue, what has already been
 * said and sent, and the one thing to do next.
 *
 * Inside Meta's 24-hour window a customer who is waiting on us gets a plain
 * reply — the drawer sends the rep to the chat. Outside it, only an approved
 * template can go, and the drawer says so rather than letting a free-text
 * send fail at Meta's end. The send is refused server-side if this person
 * was messaged in the last 12 hours or has since replied; the drawer shows
 * that reason and asks before trying again.
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
  const [extraVars, setExtraVars] = useState<string[]>([])
  const [confirmResend, setConfirmResend] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => { setError(''); setSentTo(''); setConfirmResend(false); setShowTemplate(false) }, [leadId])

  const { data: waData, isLoading: templatesLoading } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => whatsappApi.approvedTemplates(),
    staleTime: 10 * 60_000,
  })
  const templates = waData?.templates ?? []
  useEffect(() => { if (!templateName && templates.length) setTemplateName(templates[0].name) }, [templates, templateName])
  const template = templates.find((t) => t.name === templateName)
  const extraCount = Math.max(0, (template?.variableCount ?? 1) - 1)
  useEffect(() => { setExtraVars(Array(extraCount).fill('')) }, [templateName, extraCount])
  const extraFilled = extraVars.every((v) => v.trim().length > 0)

  const canReplyInChat = Boolean(item && item.reason === 'sales_response_overdue' && data?.windowOpen)
  const recentSend = Boolean(item?.lastNudgedAt && Date.now() - new Date(item.lastNudgedAt).getTime() < 12 * 3600_000)
  // Not due yet per the cadence, or the cadence is spent: the server refuses
  // unless the person explicitly overrides, and the drawer says why first.
  const notDue = Boolean(item && item.window !== 'now' && item.window !== 'today')
  const needsOverride = recentSend || notDue
  const overrideText = !item ? '' : recentSend
    ? `⚠ Already messaged ${agoText(item.lastNudgedAt)}${item.lastNudgedBy ? ` by ${item.lastNudgedBy}` : ''}. Send again anyway.`
    : item.window === 'exhausted'
      ? '⚠ Every follow-up in the cadence has gone out with no reply. Send one more anyway.'
      : `⚠ Not due until ${item.nextContactAt ? new Date(item.nextContactAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'later'} — messaging sooner risks annoying them. Send now anyway.`

  const send = useMutation({
    mutationFn: () => followUpQueueApi.send(leadId, {
      templateName, extraVars, snapshotAt, confirmResend,
      reason: item?.aiSummary || (item ? REASON_UI[item.reason].label : ''),
      daysWaiting: item?.daysWaiting ?? 0,
    }),
    onSuccess: (d) => { setError(''); setSentTo(d.sent[0]?.to || lead?.phone || ''); onChanged(); refetch() },
    onError: (e: unknown) => {
      const reason = (e as { response?: { data?: { reason?: string } } })?.response?.data?.reason
      const overridable = reason === 'sent_recently' || reason === 'not_due_yet' || reason === 'exhausted'
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

  const preview = template && lead
    ? [firstNameOf(lead.name), ...extraVars.map((v) => v || '{{?}}')]
      .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), template.bodyText)
    : ''

  return (
    <SlideOver open onClose={onClose} title={lead?.name || 'Follow-up'} subtitle={lead ? `${lead.phone} · ${lead.ownerName}${lead.source ? ` · ${lead.source}` : ''}` : ''} width="max-w-2xl">
      {isLoading || !lead ? (
        <div className="p-5 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[90px]" />)}</div>
      ) : (
        <div className="p-5 space-y-4" style={{ color: INK }}>

          {/* ── Who & why ────────────────────────────────────────────────── */}
          <div className="flex items-start gap-3">
            <span className="grid place-items-center rounded-full shrink-0 text-xs font-bold" style={{ width: 40, height: 40, background: '#EDE5FF', color: PURPLE_DEEP }}>{initialsOf(lead.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: REASON_UI[item.reason].bg, color: REASON_UI[item.reason].fg }}>{REASON_UI[item.reason].label}</span>}
                {item && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: PRIORITY_UI[item.priority].bg, color: PRIORITY_UI[item.priority].fg, letterSpacing: '.06em' }}>{PRIORITY_UI[item.priority].label}</span>}
                {lead.temperature && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: TEMP_UI[lead.temperature].bg, color: TEMP_UI[lead.temperature].fg }}>{lead.temperature}</span>}
                {!item && <span className="text-xs" style={{ color: MUTED }}>Not in the queue right now</span>}
              </div>
              {item && (
                <div className="rounded-xl mt-2 p-3" style={{ background: PURPLE_TINT }}>
                  <div className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '.08em', color: PURPLE }}>Why now</div>
                  <p className="text-sm mt-1">{whyFor(item)}</p>
                  {item.aiReason && item.aiReason !== item.aiSummary && <p className="text-xs mt-1" style={{ color: '#4A4357' }}>{item.aiReason}</p>}
                  {item.nextAction && <p className="text-xs mt-1.5 font-semibold" style={{ color: PURPLE_DEEP }}>Suggested next step: {item.nextAction}</p>}
                  {item.openQuestions.length > 0 && (
                    <p className="text-xs mt-1" style={{ color: MUTED }}>Unanswered: {item.openQuestions.slice(0, 2).join(' · ')}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Stage ────────────────────────────────────────────────────── */}
          {item && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Last from them', item.lastInboundAt ? agoText(item.lastInboundAt) : 'never'],
                ['Last from us', item.lastOutboundAt ? agoText(item.lastOutboundAt) : 'never'],
                ['Next contact', item.window === 'now' ? 'Now' : item.window === 'exhausted' ? 'Decide' : item.nextContactAt ? new Date(item.nextContactAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Today'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border px-2 py-2" style={{ borderColor: HAIRLINE }}>
                  <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '.06em', color: MUTED }}>{k}</div>
                  <div className="text-sm font-semibold mt-0.5 truncate">{v}</div>
                </div>
              ))}
            </div>
          )}
          {item && item.reason === 'customer_quiet' && (
            <div className="flex items-center gap-2 flex-wrap">
              {Array.from({ length: item.quietStage.total }).map((_, i) => {
                const n = i + 1
                const done = item.quietStage.exhausted || n < item.quietStage.next
                const current = !item.quietStage.exhausted && n === item.quietStage.next
                return (
                  <div key={n} className="flex items-center gap-2">
                    <span className="grid place-items-center rounded-full text-[10px] font-bold" style={{ width: 22, height: 22, background: done ? '#DCFCE7' : current ? PURPLE : '#EEE9F6', color: done ? '#047857' : current ? '#fff' : MUTED }}>{done ? <Check size={12} /> : n}</span>
                    <span className="text-xs" style={{ color: current ? INK : MUTED, fontWeight: current ? 600 : 400 }}>Follow-up {n}</span>
                    {n < item.quietStage.total && <span style={{ width: 16, height: 1, background: HAIRLINE }} />}
                  </div>
                )
              })}
              {item.quietStage.exhausted && <span className="text-xs font-semibold" style={{ color: '#8A5A00' }}>· all sent, no reply — decide</span>}
            </div>
          )}

          {/* ── Message ──────────────────────────────────────────────────── */}
          {sentTo ? (
            <div className="rounded-2xl border p-4" style={{ borderColor: '#A7F3D0', background: '#ECFDF5' }}>
              <div className="flex items-center gap-2">
                <span className="grid place-items-center rounded-full" style={{ width: 28, height: 28, background: '#DCFCE7', color: '#047857' }}><Check size={15} /></span>
                <p className="text-sm font-semibold">Sent to {sentTo}</p>
              </div>
              <p className="text-xs mt-1" style={{ color: MUTED }}>Logged. If they reply, this drops out of the queue on its own; if not, the next follow-up is due in a few days.</p>
              <div className="flex gap-2 mt-3">
                {nextLeadId
                  ? <button type="button" onClick={() => onAdvance(nextLeadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-bold cursor-pointer" style={{ background: PURPLE, color: '#fff' }}>Next lead <ArrowRight size={14} /></button>
                  : <button type="button" onClick={onClose} className="h-9 px-4 rounded-full text-sm font-bold cursor-pointer" style={{ background: PURPLE, color: '#fff' }}>Done</button>}
              </div>
            </div>
          ) : item ? (
            <div className="rounded-2xl border" style={{ borderColor: HAIRLINE, background: '#fff' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: HAIRLINE }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: '-.02em' }}>WhatsApp message</div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: data?.windowOpen ? '#DCFCE7' : '#FEF3C7', color: data?.windowOpen ? '#047857' : '#92400E' }}>
                  {data?.windowOpen ? '24-hour window open' : 'Outside the 24-hour window — approved template required'}
                </span>
              </div>

              {canReplyInChat && !showTemplate ? (
                <div className="p-4">
                  <p className="text-sm">They wrote {agoText(item.since)} and are still inside the 24-hour window — the right move is a plain reply in the chat.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Link to={`/whatsapp?phone=${lead.phoneNormalized}`} className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full text-sm font-bold" style={{ background: '#25D366', color: '#fff' }}>
                      <MessageCircle size={15} /> Reply in chat
                    </Link>
                    <button type="button" onClick={() => setShowTemplate(true)} className="h-10 px-4 rounded-full border text-sm font-semibold cursor-pointer" style={{ borderColor: HAIRLINE }}>Send a template instead</button>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {templatesLoading ? <Skeleton className="h-[40px]" /> : templates.length === 0 ? (
                    <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#FFF7E6', color: '#8A5A00' }}>{waData?.error || 'No approved WhatsApp templates found.'}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((t) => (
                        <button key={t.name} type="button" onClick={() => setTemplateName(t.name)}
                          className="cursor-pointer text-xs font-semibold px-3 py-1.5 rounded-full"
                          style={{ background: templateName === t.name ? PURPLE : PURPLE_TINT, color: templateName === t.name ? '#fff' : PURPLE_DEEP, border: `1px solid ${templateName === t.name ? PURPLE : 'rgba(91,43,201,.18)'}` }}>
                          {t.label}
                        </button>
                      ))}
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
                    <div style={{ background: '#0B141A', borderRadius: 16, padding: 10 }}>
                      <div style={{ background: '#ECE5DD', borderRadius: 10, padding: '12px 10px' }}>
                        <div className="ml-auto" style={{ maxWidth: '92%', background: '#DCF8C6', borderRadius: '10px 10px 2px 10px', padding: '9px 11px' }}>
                          <p className="text-[13px] whitespace-pre-wrap" style={{ color: INK, lineHeight: 1.5 }}>{preview}</p>
                          <div className="text-right text-[10px] mt-1" style={{ color: '#6B7B60' }}>✓✓</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {needsOverride && (
                    <label className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer select-none" style={{ background: '#FFF1CC', color: '#8A5A00' }}>
                      <input type="checkbox" checked={confirmResend} onChange={(e) => setConfirmResend(e.target.checked)} className="mt-0.5" style={{ accentColor: PURPLE }} />
                      <span>{overrideText}</span>
                    </label>
                  )}
                  {error && <p className="text-xs" style={{ color: '#B91C1C' }}>{error}</p>}
                  <button type="button" disabled={!templateName || !extraFilled || send.isPending || (needsOverride && !confirmResend)} onClick={() => send.mutate()}
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

          {/* ── Timeline ─────────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] font-semibold uppercase mb-2" style={{ letterSpacing: '.08em', color: MUTED }}>History</div>
            {data?.timeline.length === 0 ? (
              <p className="text-xs" style={{ color: MUTED }}>No messages, attempts or follow-ups on record yet.</p>
            ) : (
              <ol className="space-y-2">
                {data?.timeline.slice(0, 25).map((t, i) => <TimelineRow key={i} t={t} />)}
              </ol>
            )}
          </div>
        </div>
      )}
    </SlideOver>
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
        {!inbound && t.status && <span className="ml-1.5" style={{ color: MUTED }}>· {t.status}</span>}
      </span>
    </li>
  )
}
