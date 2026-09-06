import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Check, MessageCircle } from 'lucide-react'
import { apiError, leadFollowUpApi, whatsappApi, type QuietLead } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Modal, Spinner } from '../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_DEEP = '#4A1FA0'
const PURPLE_TINT = '#F7F3FF'

function initialsOf(name: string) {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

/** "5h ago", "2d ago" — how long since a previous nudge, for the warning. */
function agoText(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const TEMP_TONE: Record<string, { bg: string; fg: string }> = {
  hot: { bg: '#FEE2E2', fg: '#B91C1C' },
  warm: { bg: '#FEF3C7', fg: '#92400E' },
  cold: { bg: '#EFF6FF', fg: '#1D4ED8' },
}

/**
 * Review and send a follow-up to leads that went quiet.
 *
 * Not a task list — 200+ of those already sit unactioned. This is a count
 * turned into one batch decision: here is who, here is why (the AI's read of
 * the conversation, not a generated message — WhatsApp only allows an
 * approved template once 24 hours have passed, so the model's job stops at
 * diagnosis), pick a template you already use, review, send.
 *
 * `scope` decides whose leads: 'mine' is a rep's own inbox, 'all' is admin's
 * rollup with an owner filter and the threshold setting available to change.
 */
export default function QuietLeadsModal({
  onClose,
  scope,
  ownerId,
}: {
  onClose: () => void
  scope: 'mine' | 'all'
  /** Admin drilling into one rep, from the by-owner breakdown. */
  ownerId?: string
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [days, setDays] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [templateName, setTemplateName] = useState('')
  // Any variable beyond {{1}} — filled once, sent identically to everyone in
  // the batch. {{1}} itself is never asked for here: it is always each
  // lead's own first name, filled per person by the server.
  const [extraVars, setExtraVars] = useState<string[]>([])
  const [result, setResult] = useState<{ sent: { leadId: string; name: string }[]; failed: { leadId: string; name: string; reason: string }[] } | null>(null)
  const [error, setError] = useState('')

  const { data: config } = useQuery({
    queryKey: ['lead-follow-up-config'],
    queryFn: () => leadFollowUpApi.config(),
    staleTime: 60_000,
  })
  const effectiveDays = days ?? config?.quietFollowUpDays ?? 3

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['lead-follow-up-quiet', scope, ownerId, effectiveDays],
    queryFn: () => leadFollowUpApi.quiet({ days: effectiveDays, owner: scope === 'all' ? ownerId : undefined }),
    enabled: Boolean(config),
  })
  const leads = data?.leads ?? []

  // Everyone selected by default, except anyone nudged in the last 12
  // hours — the point of the warning is to make double-sending a deliberate
  // choice, not the default one.
  useEffect(() => {
    if (!data) return
    const recent = (l: QuietLead) => l.lastNudgedAt && Date.now() - new Date(l.lastNudgedAt).getTime() < 12 * 3600_000
    setSelected(new Set(leads.filter((l) => !recent(l)).map((l) => l.leadId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Meta's own approved list — the same one the chat composer's Templates
  // tab reads, so this offers everything you can actually send, not a
  // smaller separately-maintained subset of it.
  const { data: waData, isLoading: templatesLoading } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => whatsappApi.approvedTemplates(),
    staleTime: 10 * 60_000,
  })
  const waTemplates = waData?.templates ?? []
  useEffect(() => { if (!templateName && waTemplates.length) setTemplateName(waTemplates[0].name) }, [waTemplates, templateName])
  const selectedTemplate = waTemplates.find((t) => t.name === templateName)
  const extraCount = Math.max(0, (selectedTemplate?.variableCount ?? 1) - 1)
  useEffect(() => { setExtraVars(Array(extraCount).fill('')) }, [templateName, extraCount])

  const saveThreshold = useMutation({
    mutationFn: (n: number) => leadFollowUpApi.setConfig(n),
    onSuccess: () => refetch(),
  })

  const send = useMutation({
    mutationFn: () => leadFollowUpApi.send({
      leadIds: [...selected],
      templateName,
      extraVars,
      reasons: leads.filter((l) => selected.has(l.leadId)).map((l) => ({ leadId: l.leadId, reason: l.reason || '', daysQuiet: l.daysQuiet })),
    }),
    onSuccess: (r) => { setError(''); setResult(r) },
    onError: (e) => setError(apiError(e)),
  })

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected((s) => (s.size === leads.length ? new Set() : new Set(leads.map((l) => l.leadId))))
  }

  const extraFilled = extraVars.every((v) => v.trim().length > 0)
  const sendDisabled = selected.size === 0 || !templateName || !extraFilled || send.isPending

  // One real example, not a generic mock-up: whichever selected lead is
  // shown first, so what you read here is exactly what that person gets —
  // never invented copy standing in for the actual approved wording.
  const previewLead = leads.find((l) => selected.has(l.leadId)) ?? leads[0]
  const previewText = selectedTemplate && previewLead
    ? [previewLead.name.split(/\s+/)[0] || 'there', ...extraVars.map((v) => v || `{{?}}`)]
      .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), selectedTemplate.bodyText)
    : ''

  return (
    <Modal open onClose={onClose} title={scope === 'mine' ? 'Leads that went quiet' : 'Quiet leads — all reps'} wide>
      {result ? (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center rounded-full" style={{ width: 32, height: 32, background: '#DCFCE7', color: '#047857' }}>
              <Check size={17} />
            </span>
            <p className="text-sm font-semibold" style={{ color: INK }}>
              Sent to {result.sent.length} of {result.sent.length + result.failed.length}
            </p>
          </div>
          {result.failed.length > 0 && (
            <div className="rounded-lg border" style={{ borderColor: 'rgba(20,8,31,.1)' }}>
              <div className="px-3 py-2 text-xs font-semibold border-b" style={{ color: '#B45309', borderColor: 'rgba(20,8,31,.1)' }}>
                Not sent — {result.failed.length}
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.06)' }}>
                {result.failed.map((f) => (
                  <div key={f.leadId} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: INK }}>{f.name}</span>
                    <span style={{ color: '#B91C1C' }}>{f.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: PURPLE, color: '#fff' }}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: MUTED }}>Quiet for at least</label>
              <div className="flex items-center gap-1.5">
                {[3, 5, 7].map((d) => (
                  <button
                    key={d} type="button" onClick={() => setDays(d)}
                    className="cursor-pointer text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      background: effectiveDays === d ? PURPLE : '#fff', color: effectiveDays === d ? '#fff' : INK,
                      border: `1px solid ${effectiveDays === d ? PURPLE : 'rgba(20,8,31,.16)'}`,
                    }}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {isAdmin && (
              <div className="text-right">
                <label className="block text-xs font-semibold mb-1" style={{ color: MUTED }}>
                  Default for everyone (currently {config?.quietFollowUpDays ?? 3}d)
                </label>
                <button
                  type="button"
                  disabled={saveThreshold.isPending || effectiveDays === config?.quietFollowUpDays}
                  onClick={() => saveThreshold.mutate(effectiveDays)}
                  className="cursor-pointer text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: PURPLE_DEEP }}
                >
                  Set default to {effectiveDays}d
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: MUTED }}>Template</label>
            {templatesLoading ? (
              <Spinner />
            ) : waTemplates.length === 0 ? (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#FFF7E6', color: '#8A5A00' }}>
                {waData?.error || 'No approved WhatsApp templates found.'}
              </p>
            ) : (
              <select
                value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'rgba(20,8,31,.14)' }}
              >
                {waTemplates.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
              </select>
            )}
            {selectedTemplate && (
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                {'{{1}}'} is always filled with each person&rsquo;s own first name. Pick whichever of your templates
                fits — the reason below each name is there to help you choose.
              </p>
            )}
            {extraCount > 0 && (
              <div className="mt-2 space-y-2 rounded-lg border p-3" style={{ borderColor: 'rgba(20,8,31,.12)', background: '#FAFAFA' }}>
                <p className="text-xs" style={{ color: MUTED }}>
                  This template needs {extraCount} more detail{extraCount === 1 ? '' : 's'}, sent the same to everyone
                  selected below — for something that should differ per person, pick a template with only one blank.
                </p>
                {extraVars.map((v, i) => (
                  <input
                    key={i}
                    value={v}
                    onChange={(e) => setExtraVars((prev) => prev.map((x, n) => (n === i ? e.target.value : x)))}
                    placeholder={`{{${i + 2}}}`}
                    className="w-full rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: 'rgba(20,8,31,.14)' }}
                  />
                ))}
              </div>
            )}
            {selectedTemplate && previewLead && (
              <div className="mt-2 rounded-lg p-3" style={{ background: PURPLE_TINT, border: '1px solid rgba(91,43,201,.16)' }}>
                <p className="text-[11px] font-semibold mb-1" style={{ color: PURPLE_DEEP }}>
                  Message preview — as {previewLead.name.split(/\s+/)[0]} will read it
                </p>
                <p className="text-sm whitespace-pre-wrap" style={{ color: INK }}>{previewText}</p>
                {selected.size > 1 && (
                  <p className="text-[11px] mt-1.5" style={{ color: MUTED }}>
                    Everyone else selected gets the same wording, with their own name in place of &ldquo;{previewLead.name.split(/\s+/)[0]}&rdquo;.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold" style={{ color: MUTED }}>
                {isLoading ? 'Loading…' : `${selected.size} of ${leads.length} selected`}
              </label>
              {leads.length > 0 && (
                <button type="button" onClick={toggleAll} className="cursor-pointer text-xs font-semibold" style={{ color: PURPLE_DEEP }}>
                  {selected.size === leads.length ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            {isLoading ? (
              <Spinner />
            ) : leads.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: MUTED }}>
                Nobody&rsquo;s been quiet {effectiveDays}+ days{scope === 'mine' ? ' on your leads' : ''}. Good sign.
              </p>
            ) : (
              <div className="rounded-lg border max-h-72 overflow-y-auto" style={{ borderColor: 'rgba(20,8,31,.14)' }}>
                {leads.map((l) => {
                  const on = selected.has(l.leadId)
                  const tone = l.temperature ? TEMP_TONE[l.temperature] : null
                  const recent = l.lastNudgedAt && Date.now() - new Date(l.lastNudgedAt).getTime() < 24 * 3600_000
                  return (
                    <label
                      key={l.leadId}
                      className="flex items-start gap-3 px-3 py-2.5 border-b last:border-b-0 cursor-pointer"
                      style={{ borderColor: 'rgba(20,8,31,.06)', background: on ? PURPLE_TINT : 'transparent' }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleOne(l.leadId)} className="mt-1" />
                      <span className="grid place-items-center rounded-full shrink-0 text-xs font-bold" style={{ width: 28, height: 28, background: '#EDE5FF', color: PURPLE_DEEP }}>
                        {initialsOf(l.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate" style={{ color: INK }}>{l.name}</span>
                          <span className="text-xs" style={{ color: MUTED }}>· {l.daysQuiet}d quiet</span>
                          {scope === 'all' && <span className="text-xs" style={{ color: MUTED }}>· {l.ownerName}</span>}
                          {tone && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: tone.bg, color: tone.fg }}>
                              {l.temperature}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs mt-0.5" style={{ color: '#4A4357' }}>
                          {l.reason || 'No summary available for this conversation yet.'}
                        </span>
                        {l.recentMessages.length > 0 && (
                          <span className="block mt-1 pl-2" style={{ borderLeft: '2px solid rgba(20,8,31,.10)' }}>
                            {l.recentMessages.map((m, i) => (
                              <span key={i} className="flex items-baseline gap-1.5 text-xs" style={{ color: MUTED }}>
                                <span className="truncate" style={{ maxWidth: 280 }}>&ldquo;{m.text}&rdquo;</span>
                                <span className="shrink-0" style={{ opacity: 0.75 }}>{agoText(m.at)}</span>
                              </span>
                            ))}
                          </span>
                        )}
                        {l.lastNudgedAt && (
                          <span
                            className="inline-block text-xs mt-1 px-1.5 py-0.5 rounded"
                            style={{ background: recent ? '#FFF1CC' : 'transparent', color: recent ? '#8A5A00' : MUTED }}
                          >
                            {recent ? '⚠ ' : ''}Already messaged {agoText(l.lastNudgedAt)}{l.lastNudgedBy ? ` by ${l.lastNudgedBy}` : ''}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {error && <p className="text-xs" style={{ color: '#B91C1C' }}>{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: MUTED }}>
              Cancel
            </button>
            <button
              type="button" onClick={() => send.mutate()} disabled={sendDisabled}
              className="cursor-pointer inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: PURPLE, color: '#fff' }}
            >
              <MessageCircle size={15} />
              {send.isPending ? 'Sending…' : `Send to ${selected.size}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
