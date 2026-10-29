import { useQuery } from '@tanstack/react-query'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../lib/api'
import { type Me, INK, MUTED, PURPLE, HEAD, panel, caps } from './theme'
import { PageTitle } from './shared'

type OverviewData = {
  questions: number; holdout: number; intents: number; review: Record<string, number>; knowledge: Record<string, number>
  edited: number; conflicts: number; activeSnapshot: number; snapshots: number; openFeedback: number
  evals: { label: string; createdAt: string; summary: { mean: number | null; checksPassed: number; completed: number } }[]
}

export default function Overview() {
  const { me } = useOutletContext<{ me: Me }>()
  const go = useNavigate()
  const { data } = useQuery<OverviewData>({ queryKey: ['overview', me.org.id], queryFn: () => api.get('/training/overview').then((r) => r.data) })
  if (!data) return <div style={{ color: MUTED }}>Loading…</div>
  const toReview = (data.review.new ?? 0) + (data.review.suggested ?? 0)
  const approved = (data.knowledge.approved ?? 0) + (data.knowledge.published ?? 0)
  const last = data.evals[0]
  const tiles: { label: string; value: string | number; sub: string; to: string; warn?: boolean }[] = [
    { label: 'Questions imported', value: data.questions, sub: `${data.holdout} kept aside for testing`, to: '/imports' },
    { label: 'Common questions', value: data.intents, sub: 'grouped by the answer they need', to: '/review' },
    { label: 'Waiting for review', value: toReview, sub: `${data.review.escalated ?? 0} sent to a person · ${data.review.rejected ?? 0} rejected`, to: '/review', warn: toReview > 0 },
    { label: 'Approved answers', value: approved, sub: `${data.edited} edited by your team`, to: '/answers' },
    { label: 'Live for the agents', value: data.activeSnapshot ? `v${data.activeSnapshot}` : '—', sub: `${data.knowledge.approved ?? 0} approved, not yet published`, to: '/answers' },
    { label: 'Possible conflicts', value: data.conflicts, sub: 'answers that may contradict', to: '/answers', warn: data.conflicts > 0 },
    { label: 'Last test grade', value: last?.summary?.mean != null ? `${last.summary.mean}/5` : '—', sub: last ? `${last.summary.checksPassed}/${last.summary.completed} passed code checks · AI-graded estimate` : 'no test yet', to: '/tests' },
    { label: 'Feedback to read', value: data.openFeedback, sub: 'from connected agents', to: '/settings?tab=feedback' },
  ]
  const steps: [string, string, string][] = [
    ['Bring conversations', 'Connect your system or WhatsApp, send them by API, or upload a file. Personal data is masked.', '/imports'],
    ['Review', 'Each common question comes with a suggested answer. Approve, edit, reject, or send it to a person.', '/review'],
    ['Publish', 'Approved answers go live for your agents as one version — and can be rolled back.', '/answers'],
    ['Test', 'Your agent answers questions kept aside; compare the grade before and after.', '/tests'],
  ]
  return (
    <div className="space-y-5">
      <PageTitle title={me.org.name} sub={me.org.business || 'Teach your AI agents from real conversations: approve what they should say, publish it, test it.'} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => go(t.to)} className="text-left" style={{ ...panel, padding: '14px 16px' }}>
            <div style={caps}>{t.label}</div>
            <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 28, color: t.warn ? '#B45309' : INK, marginTop: 2 }}>{t.value}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{t.sub}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map(([title, body, to], i) => (
          <button key={title} type="button" onClick={() => go(to)} className="text-left" style={{ ...panel, padding: 16 }}>
            <div className="flex items-center gap-2"><span style={{ width: 24, height: 24, borderRadius: 99, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{i + 1}</span><b style={{ color: INK }}>{title}</b></div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{body}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>Approving an answer does not retrain the underlying model. It becomes a controlled, versioned answer your agents look up when a customer asks something similar, ranked below your live data such as today's prices.</div>
    </div>
  )
}
