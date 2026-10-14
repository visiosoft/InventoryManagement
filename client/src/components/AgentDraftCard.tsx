import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { INK, MUTED, PURPLE, PURPLE_DEEP, HAIRLINE } from '../lib/followUpUi'

type Suggestion = { type: 'followup' | 'decisionMaker' | 'whyTheyWant'; date?: string; reason?: string; value?: string; quote: string }
type Pending = {
  id: string; kind: 'reply_drafted' | 'touch_proposed' | 'followup_proposed' | 'deal_check_suggested'; suggestion?: Suggestion | null; followUpDue: boolean; text: string
  template: { name: string; intent: string; bodyText: string } | null
  at: string; agentName: string; agentColor: string
}

/**
 * What the agents have prepared for this lead, ready to approve in one click.
 * The agent only drafts: nothing is sent until someone presses Send, and the
 * server re-checks the 24-hour window, the do-not-message list and the
 * one-a-day limit at that moment.
 */
export function AgentDraftCard({ leadId, onChanged, suggestionsOnly = false }: { leadId: string; onChanged?: () => void; suggestionsOnly?: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery<{ items: Pending[] }>({
    queryKey: ['agent-pending', leadId],
    queryFn: () => api.get(`/agents/leads/${leadId}/pending`).then((r) => r.data),
    refetchInterval: 60_000,
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [pickDate, setPickDate] = useState('')

  const resolve = useMutation({
    mutationFn: ({ id, resolution, body }: { id: string; resolution: 'approved' | 'edited' | 'dismissed'; body?: string }) =>
      api.post(`/agents/actions/${id}/resolve`, { resolution, text: body ?? '' }).then((r) => r.data),
    onSuccess: () => {
      setErr(''); setEditing(null)
      qc.invalidateQueries({ queryKey: ['agent-pending', leadId] })
      qc.invalidateQueries({ queryKey: ['follow-up-detail', leadId] })
      qc.invalidateQueries({ queryKey: ['deal-check', leadId] })
      qc.invalidateQueries({ queryKey: ['person'] })
      onChanged?.()
    },
    onError: (e) => setErr(apiError(e)),
  })

  const all = data?.items ?? []
  const items = suggestionsOnly ? all.filter((d) => d.suggestion) : all
  if (!items.length) return null
  const dayLabel = (d?: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')

  return (
    <div className="space-y-2">
      {items.map((d) => d.suggestion ? (
        <div key={d.id} className="rounded-xl p-3" style={{ border: `1px solid ${PURPLE}33`, background: '#FBF9FF' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase" style={{ letterSpacing: '.08em', color: PURPLE }}>
            <Sparkles size={12} /> {d.agentName || 'Agent'} read this from the chat
          </div>
          <p className="text-sm mt-1.5" style={{ color: INK }}>
            {d.suggestion.type === 'followup' && <>Follow up on <strong>{dayLabel(d.suggestion.date)}</strong>{d.suggestion.reason ? ` — ${d.suggestion.reason}` : ''}</>}
            {d.suggestion.type === 'decisionMaker' && <>Decision maker: <strong>{d.suggestion.value}</strong></>}
            {d.suggestion.type === 'whyTheyWant' && <>Why they want it: <strong>{d.suggestion.value}</strong></>}
          </p>
          <p className="text-xs mt-1" style={{ color: MUTED }}>They wrote: “{d.suggestion.quote}”</p>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: d.id, resolution: 'approved' })}
              className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-bold" style={{ background: PURPLE, color: '#fff' }}>
              {d.suggestion.type === 'followup' ? 'Set this follow-up' : 'Accept'}
            </button>
            {d.suggestion.type === 'followup' && (
              <>
                <input type="date" value={pickDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setPickDate(e.target.value)}
                  className="h-8 rounded-lg border px-2 text-xs" style={{ borderColor: HAIRLINE, color: INK }} />
                <button type="button" disabled={resolve.isPending || !pickDate} onClick={() => resolve.mutate({ id: d.id, resolution: 'edited', body: pickDate })}
                  className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-semibold border" style={{ borderColor: HAIRLINE, color: PURPLE_DEEP }}>Use this date</button>
              </>
            )}
            <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: d.id, resolution: 'dismissed' })}
              className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-semibold border" style={{ borderColor: HAIRLINE, color: MUTED }}>Dismiss</button>
          </div>
        </div>
      ) : (
        <div key={d.id} className="rounded-xl p-3" style={{ border: `1px solid ${PURPLE}33`, background: '#FBF9FF' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase" style={{ letterSpacing: '.08em', color: PURPLE }}>
            <Sparkles size={12} />
            {d.agentName || 'Agent'} {d.followUpDue ? 'drafted your follow-up' : d.kind === 'touch_proposed' ? 'suggests a follow-up' : 'drafted a reply'}
          </div>

          {d.kind === 'reply_drafted' ? (
            editing === d.id ? (
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
                className="w-full mt-2 rounded-lg border p-2 text-sm" style={{ borderColor: HAIRLINE, color: INK }} />
            ) : (
              <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: INK }}>{d.text}</p>
            )
          ) : (
            <div className="text-sm mt-1.5" style={{ color: INK }}>
              Template <strong>{d.template?.name}</strong>
              {d.template?.intent ? <span style={{ color: MUTED }}> — {d.template.intent}</span> : null}
              {d.template?.bodyText ? <p className="mt-1 text-[13px] whitespace-pre-wrap" style={{ color: MUTED }}>{d.template.bodyText}</p> : null}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2.5">
            {editing === d.id ? (
              <>
                <button type="button" disabled={resolve.isPending || !text.trim()} onClick={() => resolve.mutate({ id: d.id, resolution: 'edited', body: text })}
                  className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-bold" style={{ background: PURPLE, color: '#fff' }}>Send edited</button>
                <button type="button" onClick={() => setEditing(null)} className="cursor-pointer px-3 h-8 rounded-full text-xs font-semibold border" style={{ borderColor: HAIRLINE, color: MUTED }}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: d.id, resolution: 'approved' })}
                  className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-bold" style={{ background: PURPLE, color: '#fff' }}>{resolve.isPending ? 'Sending…' : 'Send'}</button>
                {d.kind === 'reply_drafted' && (
                  <button type="button" onClick={() => { setEditing(d.id); setText(d.text) }} className="cursor-pointer px-3 h-8 rounded-full text-xs font-semibold border" style={{ borderColor: HAIRLINE, color: PURPLE_DEEP }}>Edit</button>
                )}
                <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: d.id, resolution: 'dismissed' })}
                  className="cursor-pointer disabled:opacity-50 px-3 h-8 rounded-full text-xs font-semibold border" style={{ borderColor: HAIRLINE, color: MUTED }}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      ))}
      {err && <p className="text-xs" style={{ color: '#B91C1C' }}>{err}</p>}
    </div>
  )
}
