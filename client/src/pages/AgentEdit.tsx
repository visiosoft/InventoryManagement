import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { agentsApi, CATEGORY_LABEL, type AgentSchedule } from '../lib/agents'
import { Spinner } from '../components/ui'
import { api, apiError } from '../lib/api'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const PURPLE_LINE = '#DDD0FF'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const LINE = 'rgba(20,8,31,.10)'
const LINE_2 = 'rgba(20,8,31,.16)'
const HEAD = "'Bricolage Grotesque', serif"

const field = { width: '100%', border: `1px solid ${LINE_2}`, borderRadius: 9, padding: '9px 11px', fontSize: 13.5, background: '#fff', color: INK }
const label = { display: 'block', fontSize: 12.5, fontWeight: 600, color: MUTED, marginBottom: 5 }
const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }
const step = { fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase' as const, color: FAINT, marginBottom: 14 }

const LOOKBACK = [
  { label: 'All history', days: 0 },
  { label: 'Last 12 months', days: 365 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 30 days', days: 30 },
]

const MIN_VALUE = [
  { label: 'Any size', aed: 0 },
  { label: 'AED 900 — 50 sq ft and up', aed: 900 },
  { label: 'AED 1,600 — 100 sq ft and up', aed: 1600 },
]

export default function AgentEdit() {
  const { key } = useParams()
  const editing = Boolean(key)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: types, isLoading } = useQuery({ queryKey: ['agent-types'], queryFn: agentsApi.types })
  const { data: list } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.list, enabled: editing })
  const agents = list?.agents
  const { data: horizon } = useQuery({ queryKey: ['agent-horizon'], queryFn: agentsApi.horizon })

  const existing = editing ? agents?.find((a) => a.key === key) : undefined

  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [lookback, setLookback] = useState(0)
  const [quietDays, setQuietDays] = useState(3)
  const [minValue, setMinValue] = useState(0)
  const [categories, setCategories] = useState<string[]>(Object.keys(CATEGORY_LABEL))
  const [extra, setExtra] = useState('')
  const [schedule, setSchedule] = useState<AgentSchedule>({ mode: 'off', hour: 7, weekday: 1 })
  const [raiseTasks, setRaiseTasks] = useState(true)
  const [tasksPerRun, setTasksPerRun] = useState(5)
  const [assignTo, setAssignTo] = useState('')

  const { data: assignable } = useQuery<{ _id: string; name: string; role: string }[]>({
    queryKey: ['users', 'assignable'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
  })

  // Seed from the chosen type, or from the agent being edited.
  useEffect(() => {
    if (existing) {
      const cfg = existing.config || {}
      setType(existing.type)
      setName(existing.name)
      setQuietDays(Number(cfg.quietDays ?? 3))
      setMinValue(Number(cfg.minValueAed ?? 0))
      setCategories((cfg.categories as string[]) ?? Object.keys(CATEGORY_LABEL))
      setExtra(existing.extraInstructions || '')
      setSchedule(existing.schedule || { mode: 'off' })
      setRaiseTasks(cfg.raiseTasks !== false)
      setTasksPerRun(Number(cfg.tasksPerRun ?? 5))
      setAssignTo(String(cfg.assignTo || ''))
    } else if (types?.length && !type) {
      setType(types[0].key)
      setName(types[0].label)
    }
  }, [existing, types])

  const chosen = types?.find((t) => t.key === type)
  const isMissedLeads = type === 'missed_leads'

  const from = lookback ? new Date(Date.now() - lookback * 864e5).toISOString() : undefined

  const { data: estimate } = useQuery({
    queryKey: ['agent-estimate', type, lookback],
    queryFn: () => agentsApi.estimate(type, from ? { from } : {}),
    enabled: Boolean(type),
  })

  const config = () => ({
    ...(from ? { from } : {}),
    ...(isMissedLeads ? { quietDays, minValueAed: minValue, categories } : {}),
    ...(chosen?.raisesTasks ? { raiseTasks, tasksPerRun, assignTo } : {}),
  })

  const save = useMutation({
    mutationFn: async ({ run }: { run: boolean }) => {
      const body = { name, type, config: config(), extraInstructions: extra, schedule }
      const agent = editing ? await agentsApi.update(key!, body) : await agentsApi.create(body)
      if (!run) return { agent, runId: '' }
      const out = await agentsApi.run(agent.key)
      return { agent, runId: out.runId }
    },
    onSuccess: ({ agent, runId }) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      navigate(runId ? `/agents/${agent.key}/runs/${runId}` : '/agents')
    },
  })

  if (isLoading) return <Spinner />

  const toggle = (id: string) =>
    setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  const earliest = horizon?.earliestMessageAt
    ? new Date(horizon.earliestMessageAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : null

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ fontSize: 11.5, color: FAINT, fontWeight: 500 }}>
        <Link to="/agents" style={{ color: FAINT }}>Agents</Link>
      </div>
      <h1 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 23, letterSpacing: '-.02em', margin: '2px 0 18px' }}>
        {editing ? name || 'Edit agent' : 'New agent'}
      </h1>

      <div className="flex flex-wrap gap-6 items-start">
        <div style={{ flex: '1 1 300px', maxWidth: 360, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={step}>1 · Choose a type</div>
          <div className="flex flex-col gap-2">
            {(types ?? []).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setType(t.key); if (!editing) setName(t.label) }}
                disabled={editing}
                className="text-left cursor-pointer w-full disabled:cursor-default"
                style={{
                  borderRadius: 10, padding: '13px 14px',
                  border: `1px solid ${t.key === type ? PURPLE : LINE}`,
                  background: t.key === type ? TINT : '#fff',
                }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ fontWeight: 700, fontFamily: HEAD, fontSize: 14.5 }}>{t.label}</span>
                  {!t.judges && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, background: '#F1EEF6', borderRadius: 999, padding: '2px 8px' }}>
                      No AI
                    </span>
                  )}
                  {t.key === type && (
                    <span className="ml-auto" style={{ fontSize: 10.5, fontWeight: 600, color: '#fff', background: PURPLE, borderRadius: 999, padding: '2px 8px' }}>
                      Selected
                    </span>
                  )}
                </div>
                <div style={{ color: MUTED, fontSize: 12.5, marginTop: 4 }}>{t.describe}</div>
              </button>
            ))}
          </div>
          {editing && (
            <p style={{ color: FAINT, fontSize: 11.5, marginTop: 10 }}>
              An agent's type cannot change — its findings would mean something different. Make a new one instead.
            </p>
          )}
        </div>

        <div style={{ flex: '3 1 460px', minWidth: 0 }} className="flex flex-col gap-4">
          <div style={card}>
            <div style={step}>2 · Name and scope</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
              <label style={{ display: 'block' }}>
                <span style={label}>Agent name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
              </label>
              <label style={{ display: 'block' }}>
                <span style={label}>Look back over</span>
                <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))} style={field}>
                  {LOOKBACK.map((l) => <option key={l.days} value={l.days}>{l.label}</option>)}
                </select>
                {earliest && (
                  /* Said plainly, because a range before the data starts comes
                     back near-empty and looks like a broken agent. */
                  <span style={{ display: 'block', color: FAINT, fontSize: 11.5, marginTop: 4 }}>
                    Conversations go back to {earliest}
                  </span>
                )}
              </label>
              {isMissedLeads && (
                <>
                  <label style={{ display: 'block' }}>
                    <span style={label}>Silent for at least</span>
                    <select value={quietDays} onChange={(e) => setQuietDays(Number(e.target.value))} style={field}>
                      {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={label}>Minimum estimated value</span>
                    <select value={minValue} onChange={(e) => setMinValue(Number(e.target.value))} style={field}>
                      {MIN_VALUE.map((m) => <option key={m.aed} value={m.aed}>{m.label}</option>)}
                    </select>
                    <span style={{ display: 'block', color: FAINT, fontSize: 11.5, marginTop: 4 }}>
                      People who never said what size they need are always kept
                    </span>
                  </label>
                </>
              )}
            </div>

            {isMissedLeads && (
              <div style={{ marginTop: 16 }}>
                <span style={label}>Include categories</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(CATEGORY_LABEL).map(([id, text]) => {
                    const on = categories.includes(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggle(id)}
                        className="cursor-pointer"
                        style={{
                          fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '6px 13px',
                          border: `1px solid ${on ? PURPLE : LINE_2}`,
                          background: on ? BADGE : '#fff',
                          color: on ? PURPLE_INK : MUTED,
                        }}
                      >
                        {text}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {chosen?.judges && (
              <label style={{ display: 'block', marginTop: 16 }}>
                <span style={label}>
                  Extra instructions <span style={{ fontWeight: 400, color: FAINT }}>— read on every chat, in your words</span>
                </span>
                <textarea
                  rows={3}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="Ignore anyone asking about parking or office space — we don't sell it. Treat movers and freight companies as low value."
                  style={{ ...field, resize: 'vertical', lineHeight: 1.5 }}
                />
              </label>
            )}
          </div>

          <div style={card}>
            <div style={step}>
              3 · Pipeline <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— fixed for this agent type</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(chosen?.stages ?? []).map((s, i) => (
                <span key={s.key} className="flex items-center gap-2">
                  <span style={{ fontSize: 12.5, fontWeight: 600, background: TINT, border: `1px solid ${PURPLE_LINE}`, color: PURPLE_INK, borderRadius: 8, padding: '6px 11px' }}>
                    {s.label}
                  </span>
                  {i < (chosen?.stages.length ?? 0) - 1 && <span style={{ color: FAINT }}>→</span>}
                </span>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={step}>4 · Schedule</div>
            <div className="flex gap-2 flex-wrap">
              {([
                { mode: 'off' as const, label: 'Off', note: 'Run it by hand' },
                { mode: 'daily' as const, label: 'Daily · 07:00', note: 'Before the team starts' },
                { mode: 'weekly' as const, label: 'Weekly · Mon 07:00', note: 'One run a week' },
              ]).map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => setSchedule({ mode: o.mode, hour: 7, weekday: 1 })}
                  className="cursor-pointer text-left"
                  style={{
                    borderRadius: 10, padding: '11px 15px', minWidth: 150,
                    border: `1px solid ${schedule.mode === o.mode ? PURPLE : LINE_2}`,
                    background: schedule.mode === o.mode ? TINT : '#fff',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.label}</div>
                  <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>{o.note}</div>
                </button>
              ))}
            </div>
          </div>

          {chosen?.raisesTasks && (
            <div style={card}>
              <div style={step}>
                5 · Tasks <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— the loop that makes it worth running</span>
              </div>
              <p style={{ color: MUTED, fontSize: 12.5, margin: '0 0 14px', maxWidth: '70ch' }}>
                After each run the top few findings become tasks on the board, due today, in the
                assignee's My Day. Whether the person then renews is recorded against the agent
                automatically — so it can show what it actually kept.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
                <label style={{ display: 'block' }}>
                  <span style={label}>Raise tasks</span>
                  <select value={raiseTasks ? 'yes' : 'no'} onChange={(e) => setRaiseTasks(e.target.value === 'yes')} style={field}>
                    <option value="yes">Yes — top findings become tasks</option>
                    <option value="no">No — findings only</option>
                  </select>
                </label>
                <label style={{ display: 'block' }}>
                  <span style={label}>Tasks per run</span>
                  <select value={tasksPerRun} onChange={(e) => setTasksPerRun(Number(e.target.value))} style={field} disabled={!raiseTasks}>
                    {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} — {n <= 5 ? 'gets done' : 'a full morning'}</option>)}
                  </select>
                </label>
                <label style={{ display: 'block' }}>
                  <span style={label}>Assign to</span>
                  <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={field} disabled={!raiseTasks}>
                    <option value="">Whoever the assistant escalates to</option>
                    {(assignable ?? []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          <div style={{ background: TINT, border: `1px solid ${PURPLE_LINE}`, borderRadius: 12, padding: '18px 22px' }} className="flex items-center gap-5 flex-wrap">
            <div>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16 }}>
                {estimate?.free
                  ? 'This agent costs nothing to run'
                  : `This will read about ${(estimate?.items ?? 0).toLocaleString('en-GB')} chats · about $${(estimate?.usd ?? 0).toFixed(2)}`}
              </div>
              <div style={{ color: MUTED, fontSize: 12.5, marginTop: 3 }}>
                {estimate?.free
                  ? 'It works entirely from your own records — no AI, no API calls.'
                  : 'Conversations that have not changed since the last run are reused and cost nothing.'}
              </div>
            </div>
            <div className="ml-auto flex gap-2.5">
              <button
                type="button"
                onClick={() => save.mutate({ run: false })}
                disabled={save.isPending || !name}
                className="cursor-pointer disabled:opacity-50"
                style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 10, padding: '11px 16px', fontWeight: 600, fontSize: 13.5, color: INK, whiteSpace: 'nowrap' }}
              >
                Save, don't run
              </button>
              <button
                type="button"
                onClick={() => save.mutate({ run: true })}
                disabled={save.isPending || !name}
                className="cursor-pointer disabled:opacity-50"
                style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap' }}
              >
                {save.isPending ? 'Saving…' : 'Save and run now'}
              </button>
            </div>
          </div>

          {save.error && (
            <p style={{ fontSize: 12.5, color: '#8A1C1C' }}>{apiError(save.error)}</p>
          )}
        </div>
      </div>
    </div>
  )
}
