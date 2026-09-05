import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { agentsApi, scheduleLabel, when, took, money, type Agent } from '../lib/agents'
import { PageHeader, Spinner } from '../components/ui'
import { apiError } from '../lib/api'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const OFF_TINT = '#F1EEF6'
const LINE = 'rgba(20,8,31,.10)'
const LINE_2 = 'rgba(20,8,31,.16)'
const ROW_LINE = 'rgba(20,8,31,.06)'
const CANVAS = '#FBF9FD'
const PURPLE_LINE = '#DDD0FF'

const GRID = 'minmax(280px,2.5fr) 140px 130px 130px 108px'

export default function Agents() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
    // A run started elsewhere should show up here without a reload, and a
    // running one should tick along.
    refetchInterval: 5_000,
  })
  const agents = data?.agents

  const start = useMutation({
    mutationFn: (key: string) => agentsApi.run(key),
    onSuccess: (out, key) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      navigate(`/agents/${key}/runs/${out.runId}`)
    },
  })

  if (isLoading) return <Spinner />

  const running = (a: Agent) => a.lastRun?.status === 'running'

  return (
    <div>
      <PageHeader title="Agents" subtitle="They read your data and recommend. They never send." />

      {/* Where the run is, from anywhere on the page. A sweep takes minutes
          and somebody who started one and wandered off needs a way back. */}
      {(agents ?? []).filter(running).map((a) => (
        <Link
          key={a.key}
          to={`/agents/${a.key}/runs/${a.lastRun!._id}`}
          className="inline-flex items-center gap-2.5 mb-4"
          style={{ background: TINT, border: `1px solid ${PURPLE_LINE}`, borderRadius: 10, padding: '8px 13px', color: PURPLE_INK, fontWeight: 600, fontSize: 12.5 }}
        >
          <span className="animate-pulse" style={{ width: 7, height: 7, borderRadius: 999, background: PURPLE, display: 'block' }} />
          {a.name} is running
          {a.lastRun?.counts?.judged ? ` · ${a.lastRun.counts.judged} read` : ''}
        </Link>
      ))}

      <div className="flex flex-wrap items-end gap-5 mb-5">
        <p style={{ color: MUTED, maxWidth: '62ch', margin: 0 }}>
          Agents read your own data — WhatsApp history, contracts, invoices — judge what they
          find, and hand back a ranked list with a recommended next step. They do not message anyone.
        </p>
        <Link
          to="/agents/new"
          className="ml-auto cursor-pointer"
          style={{ background: PURPLE, color: '#fff', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap' }}
        >
          New agent
        </Link>
      </div>

      {error && (
        <p className="mb-4 px-4 py-3" style={{ background: '#FEF2F2', border: '1px solid #FBD5D5', borderRadius: 10, fontSize: 13, color: '#8A1C1C' }}>
          {apiError(error)}
        </p>
      )}

      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '11px 20px',
            borderBottom: `1px solid ${LINE}`, background: CANVAS, fontSize: 11, fontWeight: 600,
            letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT, minWidth: 920,
          }}
        >
          <span>Agent</span><span>Last run</span><span>Findings waiting</span><span>Schedule</span><span />
        </div>

        {(agents ?? []).length === 0 && (
          <div className="px-5 py-8" style={{ minWidth: 920, color: FAINT, fontSize: 13.5 }}>
            No agents yet. <Link to="/agents/new" style={{ color: PURPLE_INK, fontWeight: 600 }}>Create one</Link> and
            it will read your own data and hand back a ranked list.
          </div>
        )}

        {(agents ?? []).map((a) => (
          <div
            key={a.key}
            style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '17px 20px',
              borderBottom: `1px solid ${ROW_LINE}`, alignItems: 'center', minWidth: 920,
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to={`/agents/${a.key}/findings`}
                  style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 15.5, color: INK }}
                >
                  {a.name}
                </Link>
                {/* Worth saying out loud: this one costs nothing to run. */}
                {!a.judges && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, background: OFF_TINT, borderRadius: 999, padding: '2px 8px' }}>
                    No AI · rules only
                  </span>
                )}
                {running(a) && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 999, padding: '2px 8px' }}>
                    Running
                  </span>
                )}
                {a.raisesTasks && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 999, padding: '2px 8px' }} title="Its top findings become tasks on the board, due today">
                    Raises tasks
                  </span>
                )}
                {!a.enabled && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, background: OFF_TINT, borderRadius: 999, padding: '2px 8px' }}>
                    Paused
                  </span>
                )}
              </div>
              <div style={{ color: MUTED, fontSize: 13, marginTop: 3 }}>{a.describe}</div>
              <div style={{ color: FAINT, fontSize: 12, marginTop: 5 }}>
                {[
                  a.typeLabel,
                  a.judges ? null : 'no AI',
                  a.extraInstructions ? 'your own instructions' : null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div style={{ fontSize: 13, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
              {running(a) ? 'Running now' : when(a.lastRunAt)}
              <div style={{ color: FAINT, fontSize: 11.5 }}>
                {running(a) ? `started ${when(a.lastRun?.startedAt)}` : took(a.lastRun)}
              </div>
            </div>

            <div>
              <span
                style={{
                  fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 20,
                  letterSpacing: '-.02em', color: a.openFindings ? INK : FAINT,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {a.lastRunAt ? a.openFindings : '—'}
              </span>
              <div style={{ color: FAINT, fontSize: 11.5 }}>
                {!a.lastRunAt
                  ? 'never run'
                  : a.openValueAed
                    ? `${money(a.openValueAed)} est.`
                    : a.windowClosed
                      ? `${a.windowClosed} need a template`
                      : 'waiting for a person'}
              </div>
              {/* What came of it. This line is the whole argument for the
                  agent: not what it found, but what happened next. */}
              {(a.outcomes.tasked || a.outcomes.replied || a.outcomes.renewed || a.outcomes.signed) > 0 && (
                <div style={{ marginTop: 6, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                  {[
                    a.outcomes.tasked && `${a.outcomes.tasked} tasked`,
                    a.outcomes.replied && `${a.outcomes.replied} replied`,
                    a.outcomes.renewed && `${a.outcomes.renewed} renewed`,
                    a.outcomes.signed && `${a.outcomes.signed} signed`,
                  ].filter(Boolean).join(' · ')}
                  {a.outcomes.keptAed > 0 && (
                    <span style={{ color: '#0F6E56', fontWeight: 600 }}> · {money(a.outcomes.keptAed)}/mo kept</span>
                  )}
                </div>
              )}
            </div>

            <div>
              <span
                style={{
                  fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
                  background: a.schedule?.mode === 'off' ? OFF_TINT : TINT,
                  color: a.schedule?.mode === 'off' ? MUTED : PURPLE_INK,
                }}
              >
                {scheduleLabel(a.schedule)}
              </span>
            </div>

            <div className="flex justify-end gap-2">
              {running(a) ? (
                <Link
                  to={`/agents/${a.key}/runs/${a.lastRun!._id}`}
                  style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
                >
                  View run
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => start.mutate(a.key)}
                  disabled={start.isPending}
                  className="cursor-pointer disabled:opacity-50"
                  style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
                >
                  {start.isPending && start.variables === a.key ? 'Starting…' : 'Run now'}
                </button>
              )}
            </div>
          </div>
        ))}

        {(agents ?? []).length > 0 && (
          <div className="flex flex-wrap gap-6 px-5 py-3.5" style={{ color: FAINT, fontSize: 12.5, minWidth: 920 }}>
            <span>
              {(agents ?? []).reduce((n, a) => n + a.openFindings, 0)} findings waiting across all agents
            </span>
            <span>Spend this month: ${(data?.spendThisMonthUsd ?? 0).toFixed(2)}</span>
            <span>Nothing here has messaged anybody</span>
          </div>
        )}
      </div>

      {start.error && (
        <p className="mt-3" style={{ fontSize: 12.5, color: '#8A1C1C' }}>{apiError(start.error)}</p>
      )}
    </div>
  )
}
