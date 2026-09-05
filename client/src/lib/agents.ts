import { api, apiUrl } from './api'

/**
 * The Agents feature's data layer.
 *
 * Agents read the business's own data, judge what they find, and hand back
 * ranked findings. **Nothing here sends anything** — there is deliberately no
 * call in this file that puts a message in front of a customer. Acting on a
 * finding means opening the chat inbox, where the opt-in and 24-hour checks
 * already live.
 */

export type AgentStage = { key: string; label: string; total: number; done: number }

export type AgentType = {
  key: string
  label: string
  describe: string
  /** false for a rules-only agent: no model calls, and so no cost. */
  judges: boolean
  /** Whether its findings can be turned into tasks on the board. */
  raisesTasks: boolean
  stages: { key: string; label: string }[]
  defaults: Record<string, unknown>
}

export type AgentSchedule = { mode: 'off' | 'daily' | 'weekly'; hour?: number; weekday?: number }

export type AgentRunSummary = {
  _id: string
  status: 'queued' | 'running' | 'done' | 'stopped' | 'failed'
  startedAt: string
  finishedAt: string | null
  counts?: { collected?: number; judged?: number; cached?: number; skipped?: number; failed?: number }
  estimateUsd?: number
  startedByName?: string
  trigger?: 'manual' | 'schedule'
}

export type Agent = {
  _id: string
  key: string
  name: string
  type: string
  typeLabel: string
  description: string
  enabled: boolean
  config: Record<string, unknown>
  extraInstructions: string
  schedule: AgentSchedule
  lastRunAt: string | null
  lastRun: AgentRunSummary | null
  /** What it does, from the type — so a row never repeats its own name. */
  describe: string
  judges: boolean
  openFindings: number
  openValueAed: number
  windowClosed: number
  raisesTasks: boolean
  /** The scoreboard — what came of the people it pointed at. */
  outcomes: Outcomes
}

export type Outcomes = { tasked: number; replied: number; renewed: number; signed: number; paid: number; keptAed: number }

export type Outcome = { kind: 'tasked' | 'replied' | 'renewed' | 'signed' | 'paid'; at: string; detail: string; taskId: string | null }

export type AgentEvent = { at: string; text: string; level: 'info' | 'skip' | 'warn' | 'error' }

export type AgentRun = AgentRunSummary & {
  definition: string
  agentType: string
  stages: AgentStage[]
  events: AgentEvent[]
  model: string
  error: string
  stopRequested: boolean
}

export type Recommendation = {
  channel?: string
  blocker?: string
  angle?: string
  template?: string
  variables?: { index: number; source: string }[]
  confidence?: 'high' | 'medium' | 'low'
  /** Filled in when the findings are read, from the live approved templates. */
  text?: string
  templateBody?: string
}

export type Finding = {
  _id: string
  key: string
  phoneNormalized: string
  title: string
  detail: string
  score: number
  factors: string[]
  subjectKind: 'lead' | 'customer' | 'contract' | 'unit' | 'user'
  subjectId: string | null
  campaignable: boolean
  state: 'open' | 'snoozed' | 'dismissed' | 'done'
  snoozeUntil: string | null
  recommendation: Recommendation | null
  taskId?: string | null
  data: {
    category?: string
    categoryLabel?: string
    daysSince?: number
    waitedDays?: number
    inbound?: number
    outbound?: number
    windowOpen?: boolean
    valueAed?: number | null
    valueBasis?: string
    leadStatus?: string
    ownerName?: string
    quoteNo?: string
    whatsappOptIn?: boolean
    renting?: boolean
    lastInboundAt?: string
  }
}

export type FindingsResponse = {
  findings: (Finding & { agent: { key: string; name: string } | null; outcomes: Outcome[] })[]
  agents: { key: string; name: string }[]
  counts: { total: number; byCategory: Record<string, number>; byAgent?: Record<string, number> }
}

export const agentsApi = {
  types: () => api.get<{ types: AgentType[] }>('/agents/types').then((r) => r.data.types),

  list: () =>
    api.get<{ agents: Agent[]; spendThisMonthUsd: number }>('/agents').then((r) => r.data),

  horizon: () =>
    api.get<{ earliestMessageAt: string | null; earliestLeadAt: string | null }>('/agents/horizon')
      .then((r) => r.data),

  /** What a run would cost before starting one. Free agents answer 0. */
  estimate: (type: string, params: { from?: string; to?: string } = {}) =>
    api.get<{ items: number; usd: number; free: boolean }>('/agents/estimate', { params: { type, ...params } })
      .then((r) => r.data),

  create: (body: Partial<Agent>) => api.post<Agent>('/agents', body).then((r) => r.data),
  update: (key: string, body: Partial<Agent>) => api.put<Agent>(`/agents/${key}`, body).then((r) => r.data),
  remove: (key: string) => api.delete(`/agents/${key}`).then((r) => r.data),

  run: (key: string, config?: Record<string, unknown>) =>
    api.post<{ runId: string; pending?: boolean }>(`/agents/${key}/run`, config ? { config } : {})
      .then((r) => r.data),

  getRun: (id: string) =>
    api.get<{ run: AgentRun; findings: Finding[] }>(`/agents/runs/${id}`).then((r) => r.data),

  stopRun: (id: string) => api.post(`/agents/runs/${id}/stop`).then((r) => r.data),

  runs: (key: string) =>
    api.get<{ runs: AgentRunSummary[] }>('/agents/runs', { params: { agent: key } }).then((r) => r.data.runs),

  /**
   * The worklist. Without an agent key this is every agent's findings in one
   * list, which is how the work is actually done — somebody deals with what is
   * waiting, whichever agent noticed it.
   */
  findings: (key?: string, params: { category?: string; state?: string } = {}) =>
    api.get<FindingsResponse>('/agents/findings', { params: { ...params, ...(key ? { agent: key } : {}) } })
      .then((r) => r.data),

  act: (id: string, action: 'dismiss' | 'done' | 'snooze' | 'reopen', body: { days?: number; reason?: string } = {}) =>
    api.post(`/agents/findings/${id}/${action}`, body).then((r) => r.data),

  exportUrl: (key: string) => apiUrl(`/agents/${key}/export.csv`),

  /** Check now for replies and renewals, rather than waiting for the next run. */
  recordOutcomes: (key: string) =>
    api.post<{ recorded: number; byKind: Record<string, number> }>(`/agents/${key}/outcomes`).then((r) => r.data),
}

/* ── shared presentation helpers ──────────────────────────────────────────── */

export const money = (aed?: number | null) =>
  aed == null ? '—' : `AED ${aed.toLocaleString('en-GB')}`

export const days = (n?: number | null) =>
  n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`

/** Ordered as the findings tabs show them. */
export const CATEGORY_LABEL: Record<string, string> = {
  never_answered: 'Never answered',
  quoted_unsigned: 'Quoted, never signed',
  never_quoted: 'Asked, never quoted',
  went_quiet: 'Went quiet',
  former_customer: 'Moved out',
}

export const scheduleLabel = (s?: AgentSchedule) => {
  if (!s || s.mode === 'off') return 'Off'
  const hour = String(s.hour ?? 7).padStart(2, '0')
  if (s.mode === 'daily') return `Daily · ${hour}:00`
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.weekday ?? 1]
  return `Weekly · ${day} ${hour}:00`
}

/** Dubai time, the only clock this business runs on. */
export const clock = (at?: string | null) =>
  at ? new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }) : ''

export const when = (at?: string | null) => {
  if (!at) return 'Never run'
  const then = new Date(at)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const sameDay = new Date().toDateString() === then.toDateString()
  if (sameDay) return `Today ${clock(at).slice(0, 5)}`
  return then.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' })
}

export const took = (run?: AgentRunSummary | null) => {
  if (!run?.finishedAt) return ''
  const secs = Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
  if (secs < 60) return `took ${secs}s`
  return `took ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}
