import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { formatDateTime } from '../lib/utils'

const INK = '#14081F'
const FAINT = '#756E80'
const LINE = 'rgba(20,8,31,.10)'
const GREEN = '#15803D'
const RED = '#B91C1C'

type Check = {
  open: boolean
  decisionMaker: string; decisionMakerSpoken: boolean; whyTheyWant: string
  nextStep: { at: string; label: string; note: string } | null
  lastFollowUp: { at: string; channel: string; note: string } | null
  attempts: number
  missing: string[]
}

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** The four questions a deal should be able to answer before it is closed. */
export function DealCheck({ leadId }: { leadId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery<Check>({
    queryKey: ['deal-check', leadId],
    queryFn: () => api.get(`/leads/${leadId}/deal-check`).then((r) => r.data),
  })
  const [who, setWho] = useState('')
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (data) { setWho(data.decisionMaker); setWhy(data.whyTheyWant) } }, [data?.decisionMaker, data?.whyTheyWant]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/leads/${leadId}/deal-check`, body),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['deal-check', leadId] }) },
    onError: (e) => setErr(apiError(e)),
  })

  if (!data || !data.open) return null
  const ready = data.missing.length === 0

  const row = (n: number, q: string, ok: boolean, body: React.ReactNode) => (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${LINE}` }}>
      <div className="flex items-center" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: FAINT }}>
        {ok ? <CheckCircle2 size={13} color={GREEN} /> : <AlertTriangle size={13} color={RED} />}
        {n}. {q}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: INK }}>{body}</div>
    </div>
  )

  const field = { width: '100%', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px', background: '#fff', color: INK } as const

  return (
    <div style={{ border: `1px solid ${ready ? 'rgba(21,128,61,.35)' : 'rgba(185,28,28,.30)'}`, borderRadius: 14, padding: '12px 14px', background: ready ? '#F3FBF6' : '#FFF8F7' }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>Ready to close?</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: ready ? GREEN : RED }}>
          {ready ? 'All four answered' : `Missing: ${data.missing.join(', ')}`}
        </span>
      </div>

      {row(1, 'Where is this deal, and what happens next?', Boolean(data.nextStep),
        data.nextStep
          ? <><strong>{data.nextStep.label}</strong> · {formatDateTime(data.nextStep.at)}{data.nextStep.note ? ` · ${data.nextStep.note}` : ''}</>
          : <span style={{ color: RED }}>No next step is booked — this deal is drifting. Set a follow-up date, site visit or task.</span>)}

      {row(2, 'Who makes the decision, and have you spoken to them?', Boolean(data.decisionMaker.trim()) && data.decisionMakerSpoken,
        <div className="flex flex-col" style={{ gap: 6 }}>
          <input
            style={field}
            value={who}
            placeholder="e.g. Her husband Ahmed / the company's finance manager"
            onChange={(e) => setWho(e.target.value)}
            onBlur={() => { if (who.trim() !== data.decisionMaker) save.mutate({ decisionMaker: who }) }}
          />
          <label className="flex items-center" style={{ gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={data.decisionMakerSpoken} onChange={(e) => save.mutate({ decisionMakerSpoken: e.target.checked })} />
            I have spoken to them directly
          </label>
        </div>)}

      {row(3, 'Why do they want this, in their own words?', Boolean(data.whyTheyWant.trim()),
        <textarea
          rows={2}
          style={{ ...field, resize: 'vertical' }}
          value={why}
          placeholder={'"We\'re moving out in two weeks and need somewhere for the furniture."'}
          onChange={(e) => setWhy(e.target.value)}
          onBlur={() => { if (why.trim() !== data.whyTheyWant) save.mutate({ whyTheyWant: why }) }}
        />)}

      {row(4, 'When did you last follow up, and what did you say?', Boolean(data.lastFollowUp),
        data.lastFollowUp
          ? <>
              {ago(data.lastFollowUp.at)} · {data.lastFollowUp.channel}
              <div style={{ color: FAINT, marginTop: 2 }}>“{data.lastFollowUp.note.slice(0, 160)}{data.lastFollowUp.note.length > 160 ? '…' : ''}”</div>
              <div style={{ color: FAINT, fontSize: 12, marginTop: 2 }}>{data.attempts} logged attempt{data.attempts === 1 ? '' : 's'} — most sales take 5 to 8 contacts.</div>
            </>
          : <span style={{ color: RED }}>Nobody has followed up yet.</span>)}

      {err && <p style={{ color: RED, fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  )
}
