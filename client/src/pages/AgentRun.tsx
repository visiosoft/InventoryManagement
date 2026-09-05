import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { agentsApi, clock, type AgentEvent, type AgentStage } from '../lib/agents'
import { Spinner } from '../components/ui'
import { apiError } from '../lib/api'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const PURPLE_LINE = '#DDD0FF'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const TRACK = '#F1EEF6'
const LINE = 'rgba(20,8,31,.10)'
const LINE_2 = 'rgba(20,8,31,.16)'
const FEED_LINE = 'rgba(20,8,31,.05)'
const CANVAS = '#FBF9FD'
const WARN_BG = '#FFF7E6'
const WARN_LINE = '#E9D9B4'
const WARN_INK = '#6B4500'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const HEAD = "'Bricolage Grotesque', serif"

/**
 * A run, while it is running.
 *
 * The design's one hard rule, kept: **the stages are not paced to look busy.**
 * On this agent three of them finish in about a second and only the reading
 * stage takes real time, so that is what the bar tracks — chats read, never
 * stage count. Fake progress is noticed, and once it is, the findings are not
 * trusted either.
 */
export default function AgentRun() {
  const { key = '', runId = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [stopped, setStopped] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-run', runId],
    queryFn: () => agentsApi.getRun(runId),
    /* Polling, not a stream. nginx fronts this API and every other live view
       in the app already polls; a second is well inside human patience and
       the run only writes its progress about that often anyway. */
    refetchInterval: (q) => (q.state.data?.run?.status === 'running' ? 1000 : false),
  })

  const stop = useMutation({
    mutationFn: () => agentsApi.stopRun(runId),
    onSuccess: () => { setStopped(true); qc.invalidateQueries({ queryKey: ['agent-run', runId] }) },
  })

  const run = data?.run
  const done = run && run.status !== 'running'

  // When it finishes, the findings are the point — not this page.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (run?.status === 'running') wasRunning.current = true
    else if (wasRunning.current && run?.status === 'done') {
      wasRunning.current = false
      qc.invalidateQueries({ queryKey: ['agent-findings', key] })
    }
  }, [run?.status, key, qc])

  if (isLoading) return <Spinner />
  if (error) return <p style={{ color: '#8A1C1C' }}>{apiError(error)}</p>
  if (!run) return null

  const judgeStage: AgentStage | undefined = run.stages[run.stages.length - 1]
  const total = judgeStage?.total || 0
  const doneCount = judgeStage?.done || 0
  const pct = total ? Math.min(100, (doneCount / total) * 100) : 0

  const startedMs = new Date(run.startedAt).getTime()
  const endMs = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()
  const elapsedSec = Math.max(0, Math.round((endMs - startedMs) / 1000))
  const rate = elapsedSec > 3 ? doneCount / (elapsedSec / 60) : 0
  const leftMin = rate > 0 && total > doneCount ? Math.max(1, Math.round((total - doneCount) / rate)) : 0

  const counts = run.counts || {}
  const status = stopped || run.stopRequested ? 'stopping' : run.status

  const statusLine = {
    running: `Reading and judging · stage ${run.stages.length} of ${run.stages.length}`,
    stopping: 'Stopping after the current batch',
    done: 'Finished',
    stopped: 'Run stopped',
    failed: 'Run failed',
    queued: 'Starting',
  }[status] || run.status

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ fontSize: 11.5, color: FAINT, fontWeight: 500 }}>
        <Link to="/agents" style={{ color: FAINT }}>Agents</Link> · {key}
      </div>
      <h1 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 23, letterSpacing: '-.02em', margin: '2px 0 18px' }}>
        {done ? 'Run finished' : 'Run in progress'}
      </h1>

      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            {!done && (
              <span
                style={{ width: 8, height: 8, borderRadius: 999, background: PURPLE, display: 'block' }}
                className="animate-pulse"
              />
            )}
            <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16 }}>{statusLine}</span>
          </div>
          <span style={{ color: FAINT, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            Started {clock(run.startedAt)} · elapsed {Math.floor(elapsedSec / 60)}m {String(elapsedSec % 60).padStart(2, '0')}s
            {!done && leftMin ? ` · about ${leftMin} min left` : ''}
          </span>
          <div className="ml-auto flex gap-2.5">
            <Link
              to={`/agents/${key}/findings`}
              style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '9px 14px', fontWeight: 600, fontSize: 12.5, color: INK }}
            >
              {done ? 'See findings' : 'Findings so far'}
            </Link>
            {!done && (
              <button
                type="button"
                onClick={() => stop.mutate()}
                disabled={stop.isPending || run.stopRequested}
                className="cursor-pointer disabled:opacity-50"
                style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '9px 14px', fontWeight: 600, fontSize: 12.5, color: INK }}
              >
                Stop run
              </button>
            )}
          </div>
        </div>

        {/* The stages, as they really are: the first ones are database work and
            are already finished when this page opens. */}
        <div
          className="mt-4.5"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginTop: 18 }}
        >
          {run.stages.map((st, i) => {
            const complete = st.total > 0 && st.done >= st.total
            const active = !done && !complete && (i === 0 || run.stages[i - 1].done >= run.stages[i - 1].total)
            const pending = !complete && !active
            return (
              <div
                key={st.key}
                style={{
                  border: `1px solid ${active ? PURPLE : LINE}`,
                  background: active ? TINT : pending ? CANVAS : '#fff',
                  borderRadius: 10, padding: '13px 14px',
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    style={{
                      width: 18, height: 18, borderRadius: 999, flex: 'none', display: 'grid',
                      placeItems: 'center', fontSize: 10.5, fontWeight: 700,
                      background: complete ? BADGE : active ? PURPLE : TRACK,
                      color: active ? '#fff' : complete ? PURPLE_INK : FAINT,
                    }}
                  >
                    {complete ? '✓' : active ? String(i + 1) : ''}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: pending ? FAINT : INK }}>{st.label}</span>
                </div>
                <div
                  style={{
                    fontFamily: HEAD, fontWeight: 700, fontSize: 17, letterSpacing: '-.02em',
                    marginTop: 9, color: pending ? FAINT : INK, fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {st.total ? (i === run.stages.length - 1 ? `${st.done} / ${st.total}` : st.total.toLocaleString('en-GB')) : '—'}
                </div>
                <div style={{ fontSize: 11.5, color: FAINT, marginTop: 2 }}>
                  {complete ? 'done' : active ? 'running' : 'waiting'}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {judgeStage?.label} — {doneCount.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}
            </span>
            <span style={{ color: FAINT, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
              {rate ? `${Math.round(rate)} a minute · ` : ''}
              the earlier stages are database work and finish in about a second
            </span>
            <span className="ml-auto" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13, color: PURPLE_INK }}>
              {pct.toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: TRACK, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: PURPLE, borderRadius: 999, width: `${pct.toFixed(1)}%`, transition: 'width .4s linear' }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 296px', gap: 16, marginTop: 16, alignItems: 'start' }}
        className="max-lg:!grid-cols-1"
      >
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          <div className="flex items-center gap-3 px-4.5 py-3" style={{ padding: '13px 18px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Activity</span>
            <span style={{ color: FAINT, fontSize: 12 }}>one line per conversation, newest first</span>
            <span className="ml-auto" style={{ color: FAINT, fontSize: 12 }}>Skipped and cached lines shown</span>
          </div>
          <div style={{ maxHeight: 430, overflow: 'auto' }}>
            {run.events.length === 0 && (
              <p className="px-4.5 py-4" style={{ padding: '16px 18px', color: FAINT, fontSize: 12.5 }}>
                Nothing yet — the first stage is still collecting.
              </p>
            )}
            {run.events.map((e: AgentEvent, i) => (
              <div
                key={`${e.at}-${i}`}
                style={{
                  display: 'grid', gridTemplateColumns: '74px minmax(0,1fr)', gap: 12,
                  padding: '8px 18px', borderBottom: `1px solid ${FEED_LINE}`, fontSize: 12.5,
                }}
              >
                <span style={{ color: FAINT, fontVariantNumeric: 'tabular-nums', fontFamily: MONO }}>
                  {clock(e.at)}
                </span>
                {/* The dull lines are required, not noise: cached and skipped
                    are what prove the interesting lines above them are real. */}
                <span
                  style={{
                    minWidth: 0,
                    color: e.level === 'error' ? '#8A1C1C' : e.level === 'warn' ? WARN_INK : e.level === 'skip' ? FAINT : MUTED,
                  }}
                >
                  {e.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT }}>
              This run
            </div>
            <div className="flex flex-col gap-2.5" style={{ marginTop: 12 }}>
              {[
                ['In scope', counts.collected],
                ['Read and judged', counts.judged],
                ['Cached, unchanged', counts.cached],
                ['Skipped', counts.skipped],
                ['Errors', counts.failed],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-baseline gap-2.5">
                  <span style={{ color: MUTED, fontSize: 13 }}>{label}</span>
                  <span className="ml-auto" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>
                    {(Number(value) || 0).toLocaleString('en-GB')}
                  </span>
                </div>
              ))}
              <div className="flex items-baseline gap-2.5">
                <span style={{ color: MUTED, fontSize: 13 }}>Cost</span>
                <span className="ml-auto" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>
                  {run.model ? `$${(run.estimateUsd || 0).toFixed(2)}` : 'free · rules only'}
                </span>
              </div>
              {run.model && (
                <div className="flex items-baseline gap-2.5">
                  <span style={{ color: MUTED, fontSize: 13 }}>Model</span>
                  <span className="ml-auto" style={{ fontWeight: 600, fontSize: 12.5 }}>{run.model}</span>
                </div>
              )}
            </div>
          </div>

          {!done && (
            <div style={{ background: WARN_BG, border: `1px solid ${WARN_LINE}`, borderRadius: 12, padding: '14px 16px', color: WARN_INK, fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Leaving this page is fine</div>
              The run carries on. Come back to it from the Agents list, or just open the findings when it is done.
            </div>
          )}

          {run.error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FBD5D5', borderRadius: 12, padding: '14px 16px', color: '#8A1C1C', fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>It stopped early</div>
              {run.error}
            </div>
          )}

          {done && (
            <button
              type="button"
              onClick={() => navigate(`/agents/${key}/findings`)}
              className="cursor-pointer"
              style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13.5 }}
            >
              See the findings
            </button>
          )}

          <div style={{ background: '#fff', border: `1px solid ${PURPLE_LINE}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT, marginBottom: 6 }}>
              Agents never send
            </div>
            <div style={{ color: MUTED, fontSize: 12.5 }}>
              Everything here is a recommendation. Messages are only ever sent by a person, from the chat inbox.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
