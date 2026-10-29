import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, PURPLE, LINE, HEAD, btn, panel, caps, field, when } from './theme'
import { Pill } from './shared'

/* The testing lab: the agent answers questions kept aside at import (never
   used to write answers), each reply is checked by code and graded against
   the approved answer. Grades come from a model and are shown as estimates. */

type Summary = { cases: number; completed: number; errors: number; checksPassed: number; unsupportedFigures: number; escalationMisses: number; handedOver: number; judged: number; mean: number | null; accuracy: number | null; relevance: number | null; tone: number | null; completeness: number | null; avgLatencyMs: number | null }
type Run = { _id: string; label: string; agent: string; status: string; createdAt: string; snapshotVersion: number; progress: { done: number; total: number }; summary?: Summary; error?: string }
type Case = { question: string; intent: string; expected: string; reply?: string; needsHuman?: boolean; error?: string; latencyMs?: number; checks?: { pass: boolean; unsupportedFigures: string[]; escalationOk: boolean; prohibited: string[]; tooLong: boolean }; judgement?: { accuracy: number; relevance: number; tone: number; completeness: number; mean: number; note: string } }
type Cmp = { measure: string; before: number | null; after: number | null; change: number | null }

const LABEL: Record<string, string> = { mean: 'Overall (AI-graded, 1–5)', accuracy: 'Accuracy', relevance: 'Relevance', tone: 'Tone', completeness: 'Completeness', checksPassedPct: 'Passed code checks (%)' }

export default function Tests({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [limit, setLimit] = useState(30)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const agent = useQuery<{ name: string; connected: boolean }>({ queryKey: ['training-agent'], queryFn: () => api.get('/training/agent').then((r) => r.data) })
  const runs = useQuery<{ evals: Run[]; comparison: Cmp[] | null }>({
    queryKey: ['training-evals'], queryFn: () => api.get('/training/evals').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.evals.some((e) => e.status === 'running') ? 4000 : false),
  })
  const start = useMutation({
    mutationFn: () => api.post('/training/evals', { limit }),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['training-evals'] }) }, onError: (e) => setErr(apiError(e)),
  })
  const detail = useQuery<{ eval: Run & { cases: Case[] } }>({ queryKey: ['training-eval', open], queryFn: () => api.get(`/training/evals/${open}`).then((r) => r.data), enabled: Boolean(open) })
  const running = runs.data?.evals.some((e) => e.status === 'running')

  return (
    <div className="space-y-4">
      {me.permissions.includes('evaluate') && (
        <div style={{ ...panel, padding: 18 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}><FlaskConical size={16} style={{ color: PURPLE }} /> Test the agent</div>
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>Questions kept aside at import are put to the agent as real customers asked them. Nothing is sent to customers. Run it before and after publishing to see the difference.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div style={{ fontSize: 13, color: INK }}>Testing: <b>{agent.data?.name ?? '…'}</b><div style={{ fontSize: 12, color: MUTED }}>{agent.data?.connected ? 'Your own AI, through your connected system' : 'The hosted agent, answering from your published answers'}</div></div>
            <label style={{ fontSize: 12, color: MUTED }}>Questions<input type="number" min={5} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...field, marginTop: 4, width: 100 }} /></label>
            <button type="button" style={btn(true)} disabled={running || start.isPending} onClick={() => start.mutate()}>Run test</button>
          </div>
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        </div>
      )}

      {runs.data?.comparison && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={caps}>Last test against the one before</div>
          <table className="w-full" style={{ fontSize: 13, marginTop: 6 }}>
            <thead><tr style={{ color: MUTED, fontSize: 12 }}><th className="text-left font-medium">Measure</th><th className="text-right font-medium">Before</th><th className="text-right font-medium">After</th><th className="text-right font-medium">Change</th></tr></thead>
            <tbody>{runs.data.comparison.map((r) => (
              <tr key={r.measure} style={{ borderTop: `1px solid ${LINE}` }}><td style={{ padding: '6px 0' }}>{LABEL[r.measure] ?? r.measure}</td><td className="text-right">{r.before ?? '—'}</td><td className="text-right">{r.after ?? '—'}</td>
                <td className="text-right" style={{ fontWeight: 700, color: r.change == null ? MUTED : r.change > 0 ? '#166534' : r.change < 0 ? '#B91C1C' : MUTED }}>{r.change == null ? '—' : `${r.change > 0 ? '+' : ''}${r.change}`}</td></tr>
            ))}</tbody>
          </table>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>Grades are a model's estimate, useful for comparing runs — not a verdict. Code checks (invented figures, missed hand-overs, banned phrases) are exact.</div>
        </div>
      )}

      <div style={panel}>
        <div style={{ ...caps, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>Test runs</div>
        {!runs.data?.evals.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>No tests yet. Approve a few answers, then run one.</div>}
        {runs.data?.evals.map((r) => (
          <button key={r._id} type="button" onClick={() => setOpen(open === r._id ? null : r._id)} className="block w-full text-left" style={{ padding: '12px 18px', borderBottom: `1px solid ${LINE}`, background: open === r._id ? '#FBFAFD' : '#fff' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ fontWeight: 700, color: INK }}>{r.label}</span><Pill status={r.status} />
              <span style={{ fontSize: 12, color: MUTED }}>{r.agent} · knowledge v{r.snapshotVersion || 0} · {when(r.createdAt)}</span>
              {r.status === 'running' && <span style={{ fontSize: 12, color: MUTED }}>{r.progress.done} of {r.progress.total}</span>}
            </div>
            {r.summary && (
              <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>
                <span>Grade <b style={{ color: INK, fontFamily: HEAD, fontSize: 15 }}>{r.summary.mean ?? '—'}</b>/5</span>
                <span><b style={{ color: INK }}>{r.summary.checksPassed}</b>/{r.summary.completed} passed code checks</span>
                <span><b style={{ color: r.summary.unsupportedFigures ? '#B91C1C' : INK }}>{r.summary.unsupportedFigures}</b> with unsupported figures</span>
                <span><b style={{ color: r.summary.escalationMisses ? '#B91C1C' : INK }}>{r.summary.escalationMisses}</b> missed hand-overs</span>
                {r.summary.avgLatencyMs != null && <span>{(r.summary.avgLatencyMs / 1000).toFixed(1)}s per reply</span>}
              </div>
            )}
          </button>
        ))}
      </div>

      {open && detail.data?.eval && (
        <div style={panel}>
          <div style={{ ...caps, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>Replies · {detail.data.eval.label}</div>
          {detail.data.eval.cases.map((c, i) => (
            <div key={i} className="grid gap-3 md:grid-cols-3" style={{ padding: '12px 18px', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
              <div><div style={caps}>Customer</div><div style={{ color: INK }} dir="auto">{c.question}</div><div style={{ color: MUTED, marginTop: 2 }}>{c.intent}</div></div>
              <div><div style={caps}>Agent replied</div><div style={{ color: INK, whiteSpace: 'pre-wrap' }}>{c.error ? <span style={{ color: '#B91C1C' }}>{c.error}</span> : c.needsHuman && !c.reply ? 'Handed to a person' : c.reply}</div></div>
              <div><div style={caps}>Approved answer</div><div style={{ color: MUTED, whiteSpace: 'pre-wrap' }}>{c.expected}</div>
                <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
                  {c.judgement && <Pill status={c.judgement.mean >= 4 ? 'approved' : c.judgement.mean >= 3 ? 'suggested' : 'rejected'}>{c.judgement.mean}/5</Pill>}
                  {c.checks && !c.checks.pass && <Pill status="rejected">{[c.checks.unsupportedFigures.length ? `unsupported ${c.checks.unsupportedFigures.join(', ')}` : '', !c.checks.escalationOk ? 'should hand over' : '', c.checks.prohibited.length ? 'banned phrase' : '', c.checks.tooLong ? 'too long' : ''].filter(Boolean).join(' · ')}</Pill>}
                </div>
                {c.judgement?.note && <div style={{ color: MUTED, marginTop: 4 }}>{c.judgement.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
