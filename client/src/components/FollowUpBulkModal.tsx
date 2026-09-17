import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { apiError, followUpQueueApi, whatsappApi, type FollowUpEligibilityRow, type FollowUpQueueItem } from '../lib/api'
import { Modal, Spinner } from './ui'
import { INK, MUTED, PURPLE, PURPLE_DEEP, PURPLE_TINT, HAIRLINE, CREAM, DISPLAY, REASON_UI, firstNameOf, defaultTemplate, rememberTemplate } from '../lib/followUpUi'

/**
 * Bulk follow-up: one approved template to a hand-picked batch, with every
 * person checked before anything goes out.
 *
 * The review table is the safeguard, not decoration: each row is either
 * Ready or Excluded with the reason in words — replied since the list was
 * drawn, messaged in the last 12 hours, lead closed, no number. The server
 * runs the exact same check again at the moment of sending, so an excluded
 * row can never be sent by accident, and "Send 4 messages" means four.
 */
export default function FollowUpBulkModal({ items, snapshotAt, onClose, onDone }: {
  items: FollowUpQueueItem[]
  snapshotAt?: string
  onClose: () => void
  onDone: () => void
}) {
  const [templateName, setTemplateName] = useState('')
  const [extraVars, setExtraVars] = useState<string[]>([])
  const [confirmResend, setConfirmResend] = useState(false)
  const [allowCustomers, setAllowCustomers] = useState(false)
  const tenants = items.filter((it) => it.customer?.status === 'active').length
  const [rows, setRows] = useState<FollowUpEligibilityRow[] | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof followUpQueueApi.bulkSend>> | null>(null)

  const { data: waData, isLoading: templatesLoading } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => whatsappApi.approvedTemplates(),
    staleTime: 10 * 60_000,
  })
  const templates = waData?.templates ?? []
  useEffect(() => { if (!templateName && templates.length) setTemplateName(defaultTemplate(templates)?.name || '') }, [templates, templateName])
  const template = templates.find((t) => t.name === templateName)
  const extraCount = Math.max(0, (template?.variableCount ?? 1) - 1)
  useEffect(() => { setExtraVars(Array(extraCount).fill('')); setRows(null) }, [templateName, extraCount])
  const extraFilled = extraVars.every((v) => v.trim().length > 0)

  const validate = useMutation({
    mutationFn: () => followUpQueueApi.bulkValidate({
      leadIds: items.map((it) => it.leadId), templateName, extraVars, snapshotAt, confirmResend, allowCustomers,
    }),
    onSuccess: (d) => { setError(''); setRows(d.rows) },
    onError: (e) => setError(apiError(e)),
  })

  const send = useMutation({
    mutationFn: () => followUpQueueApi.bulkSend({
      leadIds: (rows ?? []).filter((r) => r.ok).map((r) => r.leadId),
      templateName, extraVars, snapshotAt, confirmResend, allowCustomers,
      reasons: items.map((it) => ({ leadId: it.leadId, reason: it.aiSummary || REASON_UI[it.reason].label, daysWaiting: it.daysWaiting })),
    }),
    onSuccess: (d) => { setError(''); rememberTemplate(templateName); setResult(d) },
    onError: (e) => setError(apiError(e)),
  })

  const ready = useMemo(() => (rows ?? []).filter((r) => r.ok), [rows])
  const excluded = useMemo(() => (rows ?? []).filter((r) => !r.ok), [rows])
  const byId = useMemo(() => new Map(items.map((it) => [it.leadId, it])), [items])

  const preview = template && items[0]
    ? [firstNameOf(items[0].name), ...extraVars.map((v) => v || '{{?}}')]
      .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), template.bodyText)
    : ''

  return (
    <Modal open onClose={onClose} title={`Send follow-up to ${items.length} lead${items.length === 1 ? '' : 's'}`} wide className="w-full sm:max-w-4xl">
      <div style={{ background: CREAM, margin: -20, padding: 24 }}>
        {result ? (
          <div>
            <div className="flex items-center gap-3">
              <span className="grid place-items-center rounded-full shrink-0" style={{ width: 40, height: 40, background: '#DCFCE7', color: '#047857' }}><Check size={20} /></span>
              <div>
                <p style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, letterSpacing: '-.02em', color: INK }}>Sent {result.sent.length} of {ready.length}</p>
                <p className="text-xs" style={{ color: MUTED }}>{result.excluded.length} excluded before sending{result.failed.length ? `, ${result.failed.length} failed` : ''}.</p>
              </div>
            </div>
            {(result.failed.length > 0 || result.excluded.length > 0) && (
              <div className="rounded-2xl border mt-4 divide-y" style={{ borderColor: HAIRLINE, background: '#fff' }}>
                {result.failed.map((f) => (
                  <div key={f.leadId} className="px-4 py-2.5 text-xs flex justify-between gap-3"><span>{f.name}</span><span style={{ color: '#B91C1C' }}>Failed — {f.reason}</span></div>
                ))}
                {result.excluded.map((x) => (
                  <div key={x.leadId} className="px-4 py-2.5 text-xs flex justify-between gap-3"><span>{x.name}</span><span style={{ color: '#8A5A00' }}>Excluded — {x.explanation}</span></div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-5">
              <button type="button" onClick={onDone} className="cursor-pointer text-sm font-semibold px-5 py-2.5 rounded-full" style={{ background: PURPLE, color: '#fff' }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border p-4" style={{ borderColor: HAIRLINE, background: '#fff' }}>
                <label className="block text-xs font-semibold mb-2" style={{ color: MUTED }}>Template — one for the whole batch</label>
                {templatesLoading ? <Spinner /> : templates.length === 0 ? (
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
                <p className="text-xs mt-2" style={{ color: MUTED }}>{'{{1}}'} is always each person&rsquo;s own first name.</p>
                {extraCount > 0 && (
                  <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: 'rgba(20,8,31,.12)', background: CREAM }}>
                    <p className="text-xs" style={{ color: MUTED }}>This template needs {extraCount} more detail{extraCount === 1 ? '' : 's'}, sent the same to everyone.</p>
                    {extraVars.map((v, i) => (
                      <input key={i} value={v} placeholder={`{{${i + 2}}}`}
                        onChange={(e) => { setExtraVars((prev) => prev.map((x, n) => (n === i ? e.target.value : x))); setRows(null) }}
                        className="w-full rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: 'rgba(20,8,31,.14)' }} />
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs mt-3 cursor-pointer select-none" style={{ color: INK }}>
                  <input type="checkbox" checked={confirmResend} onChange={(e) => { setConfirmResend(e.target.checked); setRows(null) }} style={{ accentColor: PURPLE }} />
                  Override the cadence — include people messaged in the last 12 hours or not due yet
                </label>
                {tenants > 0 && (
                  <label className="flex items-start gap-2 text-xs mt-2 cursor-pointer select-none rounded-lg px-3 py-2" style={{ background: '#DCFCE7', color: '#15803D' }}>
                    <input type="checkbox" checked={allowCustomers} onChange={(e) => { setAllowCustomers(e.target.checked); setRows(null) }} className="mt-0.5" style={{ accentColor: '#15803D' }} />
                    <span><b>{tenants} active tenant{tenants === 1 ? '' : 's'}</b> in this selection are left out by default — a lead template would be wrong for them. Tick to include only if this template suits a tenant.</span>
                  </label>
                )}
              </div>

              <div style={{ background: '#0B141A', borderRadius: 18, padding: 12 }}>
                <div style={{ background: '#ECE5DD', borderRadius: 12, overflow: 'hidden', minHeight: 160 }}>
                  <div className="text-xs font-semibold" style={{ background: '#075E54', color: '#fff', padding: '10px 12px' }}>Preview — as {items[0] ? firstNameOf(items[0].name) : 'the first person'} will read it</div>
                  <div style={{ padding: '14px 10px' }}>
                    <div className="ml-auto" style={{ maxWidth: '90%', background: '#DCF8C6', borderRadius: '10px 10px 2px 10px', padding: '9px 11px' }}>
                      <p className="text-[13px] whitespace-pre-wrap" style={{ color: INK, lineHeight: 1.5 }}>{preview || 'Pick a template.'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {rows && (
              <div className="rounded-2xl border mt-4 overflow-hidden" style={{ borderColor: HAIRLINE, background: '#fff' }}>
                <div className="grid grid-cols-[1.2fr_1fr_2fr_1.4fr] gap-3 px-4 py-2 text-[11px] font-bold uppercase" style={{ letterSpacing: '.06em', color: MUTED, background: CREAM }}>
                  <div>Customer</div><div>Reason</div><div>Message</div><div>Status</div>
                </div>
                <div className="divide-y max-h-[320px] overflow-y-auto" style={{ borderColor: 'rgba(20,8,31,.06)' }}>
                  {rows.map((r) => {
                    const it = byId.get(r.leadId)
                    const ru = it ? REASON_UI[it.reason] : null
                    return (
                      <div key={r.leadId} className="grid grid-cols-[1.2fr_1fr_2fr_1.4fr] gap-3 px-4 py-2.5 text-xs items-start" style={{ opacity: r.ok ? 1 : 0.7 }}>
                        <div><div className="font-semibold text-sm" style={{ color: INK }}>{r.name}</div><div style={{ color: MUTED }}>{r.phone}</div></div>
                        <div>{ru && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: ru.bg, color: ru.fg }}>{ru.label}</span>}</div>
                        <div className="truncate" style={{ color: '#4A4357' }} title={r.preview}>{r.preview || '—'}</div>
                        <div>
                          {r.ok
                            ? <span className="font-bold" style={{ color: '#047857' }}>Ready</span>
                            : <span className="font-semibold" style={{ color: '#8A5A00' }}>Excluded — {r.explanation}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="px-4 py-2.5 text-xs" style={{ background: CREAM, color: MUTED }}>
                  {items.length} selected · {ready.length} ready · {excluded.length} excluded. Excluded people are never sent to.
                </div>
              </div>
            )}

            {error && <p className="text-xs mt-3" style={{ color: '#B91C1C' }}>{error}</p>}

            <div className="flex items-center justify-between gap-3 flex-wrap mt-5 pt-4" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <span className="text-xs" style={{ color: MUTED }}>
                {!rows ? 'Review first — every person is checked before anything is sent.' : ready.length ? `Sending to ${ready.length}.` : 'Nobody is eligible right now.'}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold px-4 py-2.5 rounded-full" style={{ color: MUTED }}>Cancel</button>
                {!rows ? (
                  <button type="button" disabled={!templateName || !extraFilled || validate.isPending} onClick={() => validate.mutate()}
                    className="cursor-pointer text-sm font-semibold px-5 py-2.5 rounded-full disabled:opacity-40" style={{ background: PURPLE, color: '#fff' }}>
                    {validate.isPending ? 'Checking…' : 'Review messages'}
                  </button>
                ) : (
                  <button type="button" disabled={!ready.length || send.isPending} onClick={() => send.mutate()}
                    className="cursor-pointer text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40" style={{ background: '#16A34A', color: '#fff' }}>
                    {send.isPending ? 'Sending…' : `Send ${ready.length} message${ready.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
