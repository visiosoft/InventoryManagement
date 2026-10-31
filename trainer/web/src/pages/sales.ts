/* The sales playbook, scenarios, sandbox and test suite — shared types. */

export type Item = { key: string; label: string }
export type Playbook = {
  template: string; name: string; goal: string; contract: string
  states: (Item & { objective: string })[]
  actions: (Item & { when: string; outcome?: string })[]
  fields: (Item & { hint: string })[]
  rubric: (Item & { weight: number; expect: string })[]
  autoFails: Item[]
  media: (Item & { tags: string[]; url?: string })[]
  groups: (Item & { min: number })[]
  gates: Record<'corePass' | 'factual' | 'autoFails' | 'avgScore' | 'blind' | 'completion' | 'escalation' | 'maxDrop' | 'blindSample', number>
  codeRules?: (Item & { pattern: string })[]
  passMark: number; shareContract: boolean
}
export type Stage = { key: string; label: string; body: string }
export type PlaybookResp = {
  playbook: Playbook; custom: boolean; promptVersion: string
  templates: { key: string; name: string; goal: string; starters: number }[]
  stages: Stage[]; rollout: { stage: string; intents: string[]; note: string; changedBy?: { name: string }; at?: string }
}
export type Msg = { from: 'customer' | 'agent'; text: string }
export type Lead = Record<string, { value: string; confidence: number }>
export type Turn = {
  state: string; nba: string; lead: Lead; reply: string; media: string[]; actions: { type: string; detail: string }[]
  needsHuman: boolean; reason: string; latencyMs: number; agent: string; model: string; promptVersion: string; knowledgeVersion: number
  trace: { answers: { id: string; question: string; answer: string; score: number }[]; examples?: { id: string; question: string; reply: string; score: number }[]; facts: string[]; tools: string[]; media: { key: string; label: string }[] }
}
export type Grade = {
  scores: Record<string, number>; score: number | null; autoFails: string[]; nbaOk: boolean; escalationOk: boolean; factualOk: boolean
  completed: boolean | null; pass: boolean; note: string; unsupportedFigures: string[]
}
export type Scenario = {
  _id: string; group: string; title: string; context: Msg[]; message: string; leadBefore: Record<string, string>
  intent: string; nba: string[]; idealResponse: string; media: string[]; badResponse: string; critique: string
  outcome: string; commercial: string; mustEscalate: boolean; factual: boolean; core: boolean; source: string; status: 'draft' | 'approved' | 'archived'
  approvedBy?: { name: string }; approvedAt?: string
}
export type Gate = { key: string; label: string; target: string; actual: number | null; status: 'pass' | 'fail' | 'pending'; note?: string }
export type RunSummary = {
  cases: number; completed: number; errors: number; passed: number; passPct: number | null; corePct: number | null; factualPct: number | null
  escalationPct: number | null; completionPct: number | null; autoFails: number; avgScore: number | null; nbaPct: number | null; blindRated: number; blindOkPct: number | null
}
export type RunCase = {
  scenario: string; title: string; group: string; message: string; context: Msg[]; expected: string[]; ideal: string; error?: string
  out?: { reply: string; nba: string; state: string; media: string[]; needsHuman: boolean; reason: string }
  grade?: Grade; blind?: { rating: string }
}
export type Run = {
  _id: string; label: string; scope: string; agent: string; model: string; promptVersion: string; knowledgeVersion: number
  status: string; progress: { done: number; total: number }; summary?: RunSummary; gates: Gate[]; regressions: string[]; passedAll: boolean
  createdAt: string; startedBy?: { name: string }; error?: string; cases?: RunCase[]
}

export const labelOf = (list: Item[] | undefined, key: string) => list?.find((x) => x.key === key)?.label ?? key
export const scoreTone = (n: number | null | undefined, mark = 80) => (n == null ? 'new' : n >= mark ? 'approved' : n >= mark - 20 ? 'suggested' : 'rejected')
