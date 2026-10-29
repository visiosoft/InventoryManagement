import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, apiError } from '../../lib/api'
import { PageHeader, Spinner } from '../../components/ui'
import { type Me, INK, MUTED, PURPLE, LINE, HEAD, panel, caps } from './theme'
import Review from './Review'
import Imports from './Imports'
import Knowledge from './Knowledge'
import Tests from './Tests'
import Settings from './Settings'

/* AI Training & Quality Control: import real conversations, find what
   customers keep asking, approve the answers the AI should give, publish
   them to the agents, and test that it got better. */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'review', label: 'Review' },
  { key: 'knowledge', label: 'Approved answers' },
  { key: 'imports', label: 'Imports' },
  { key: 'tests', label: 'Tests' },
  { key: 'settings', label: 'Team & API' },
] as const

type Overview = {
  questions: number; holdout: number; intents: number; review: Record<string, number>; knowledge: Record<string, number>
  edited: number; conflicts: number; activeSnapshot: number; snapshots: number; openFeedback: number
  evals: { label: string; createdAt: string; summary: { mean: number | null; checksPassed: number; completed: number } }[]
}

export default function Training() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'overview'
  const me = useQuery<Me>({ queryKey: ['training-me'], queryFn: () => api.get('/training/me').then((r) => r.data), retry: false })

  if (me.isLoading) return <Spinner />
  if (me.isError || !me.data) return <div style={{ ...panel, padding: 24, color: MUTED }}>{apiError(me.error)}</div>

  return (
    <div>
      <PageHeader title="AI Training" subtitle="Teach the AI agents from real conversations: approve what they should say, publish it, test it" />
      <div className="flex flex-wrap gap-1" style={{ borderBottom: `1px solid ${LINE}`, marginBottom: 16 }} role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key }, { replace: true })}
            style={{ padding: '9px 14px', fontSize: 13.5, fontWeight: 700, color: tab === t.key ? PURPLE : MUTED, borderBottom: `2px solid ${tab === t.key ? PURPLE : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab go={(k) => setParams({ tab: k }, { replace: true })} />}
      {tab === 'review' && <Review me={me.data} />}
      {tab === 'knowledge' && <Knowledge me={me.data} />}
      {tab === 'imports' && <Imports me={me.data} />}
      {tab === 'tests' && <Tests me={me.data} />}
      {tab === 'settings' && <Settings me={me.data} />}
    </div>
  )
}

function OverviewTab({ go }: { go: (tab: string) => void }) {
  const { data } = useQuery<Overview>({ queryKey: ['training-overview'], queryFn: () => api.get('/training/overview').then((r) => r.data) })
  if (!data) return <Spinner />
  const toReview = (data.review.new ?? 0) + (data.review.suggested ?? 0)
  const approved = (data.knowledge.approved ?? 0) + (data.knowledge.published ?? 0)
  const last = data.evals[0]
  const tiles: { label: string; value: string | number; sub: string; tab?: string; warn?: boolean }[] = [
    { label: 'Questions imported', value: data.questions, sub: `${data.holdout} kept aside for testing`, tab: 'imports' },
    { label: 'Common questions', value: data.intents, sub: 'grouped by the answer they need', tab: 'review' },
    { label: 'Waiting for review', value: toReview, sub: `${data.review.escalated ?? 0} sent to a person · ${data.review.rejected ?? 0} rejected`, tab: 'review', warn: toReview > 0 },
    { label: 'Approved answers', value: approved, sub: `${data.edited} edited by your team`, tab: 'knowledge' },
    { label: 'Live for the agents', value: data.activeSnapshot ? `v${data.activeSnapshot}` : '—', sub: `${data.knowledge.approved ?? 0} approved, not yet published`, tab: 'knowledge' },
    { label: 'Possible conflicts', value: data.conflicts, sub: 'answers that may contradict', tab: 'knowledge', warn: data.conflicts > 0 },
    { label: 'Last test grade', value: last?.summary?.mean != null ? `${last.summary.mean}/5` : '—', sub: last ? `${last.summary.checksPassed}/${last.summary.completed} passed code checks · AI-graded estimate` : 'no test yet', tab: 'tests' },
    { label: 'Feedback to read', value: data.openFeedback, sub: 'from connected agents', tab: 'settings' },
  ]
  const steps = [
    ['Import', 'Pull recent customer chats (or upload a file). Personal data is masked.', 'imports'],
    ['Review', 'Each common question comes with a suggested answer. Approve, edit, reject, or send it to a person.', 'review'],
    ['Publish', 'Approved answers go live for the agents as one version — and can be rolled back.', 'knowledge'],
    ['Test', 'The agent answers questions kept aside; compare the grade before and after.', 'tests'],
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => t.tab && go(t.tab)} className="text-left" style={{ ...panel, padding: '14px 16px' }}>
            <div style={caps}>{t.label}</div>
            <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 28, color: t.warn ? '#B45309' : INK, marginTop: 2 }}>{t.value}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{t.sub}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map(([title, body, tab], i) => (
          <button key={title} type="button" onClick={() => go(tab)} className="text-left" style={{ ...panel, padding: 16 }}>
            <div className="flex items-center gap-2"><span style={{ width: 24, height: 24, borderRadius: 99, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{i + 1}</span><b style={{ color: INK }}>{title}</b></div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{body}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>Approving an answer does not retrain the underlying model. It becomes a controlled, versioned answer the agents look up when a customer asks something similar, ranked below live data such as today's prices.</div>
    </div>
  )
}
