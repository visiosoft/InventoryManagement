import { api } from './api'

export type Bucket =
  | 'new' | 'engaged' | 'quoted' | 'booking' | 'quiet' | 'dormant'
  | 'with_person' | 'won' | 'lost' | 'do_not_contact'

export type OwnableBucket = Bucket | 'tenant'

export interface LeadNeed { sizeSqf: number | null; moveIn: string; durationWeeks: number | null; budget: number | null; storing: string }
export interface Offer { unitNumber: string; monthlyPrice: number | null; from: string; to: string; at: string }
export interface LeadRef { _id: string; fullName: string; phone: string; temperature?: string; status?: string; createdAt?: string }
export interface AgentRef { _id: string; name: string; role?: string; avatarColor?: string; promptVersion?: number }

export interface AgentProfile {
  _id: string
  name: string
  role: string
  systemPrompt: string
  promptVersion: number
  model: string
  mode: 'off' | 'shadow'
  enabledTools: string[]
  ownsBuckets: OwnableBucket[]
  languages: string[]
  whatsappNumbers: string[]
  cadence: { quoted: number[]; booking: number[]; quiet: number[]; dormant: number[] }
  escalateTo: { _id: string; name: string; email: string } | string | null
  maxToolRounds: number
  syncLeadStatus: boolean
  isDefault: boolean
  dailyBudgetAed: number
  avatarColor: string
  isActive: boolean
}

export interface ProfilesResponse {
  profiles: AgentProfile[]
  users: { _id: string; name: string; email: string; role: string }[]
  tools: string[]
  modes: string[]
  buckets: OwnableBucket[]
  defaultCadence: AgentProfile['cadence']
}

export interface TeamAgent {
  _id: string; name: string; role: string; mode: 'off' | 'shadow'; promptVersion: number; model: string
  ownsBuckets: OwnableBucket[]; languages: string[]; escalateTo: { _id: string; name: string } | string | null
  isDefault: boolean; dailyBudgetAed: number; avatarColor: string; isActive: boolean; leads: number
  today: { drafts: number; proposed: number; approved: number; edited: number; dismissed: number; handed: number; approvedRate: number | null }
}
export interface TeamResponse { agents: TeamAgent[]; buckets: { key: Bucket; label: string }[] }

export interface InboxDraft {
  actionId: string; at: string; lead: LeadRef; agent: AgentRef; bucket: Bucket; bucketLabel: string; stage: string
  need: LeadNeed; frozen: boolean; needsHuman: boolean; trace: string[]
  customerText: string; reply: string; grounded: { ok: boolean; loose: string[] } | null; summary: string
}
export interface InboxTouch {
  actionId: string; at: string; lead: LeadRef; agent: AgentRef; bucket: Bucket; bucketLabel: string; stage: string
  need: LeadNeed; frozen: boolean; needsHuman: boolean; trace: string[]
  template: { name: string; intent: string; bodyText?: string; language?: string } | null; summary: string
}
export interface InboxHanded {
  leadFileId: string; lead: LeadRef; agent: AgentRef; previousBucket: Bucket | null; need: LeadNeed; offers: Offer[]
  openQuestions: string[]; lastSummary: string; why: string; at: string
}
export interface InboxResponse { drafts: InboxDraft[]; touches: InboxTouch[]; handed: InboxHanded[] }

export interface PipelineRow {
  leadFileId: string; leadId: string; name: string; phone: string; temperature: string
  bucket: Bucket; bucketLabel: string; stage: string; nextTouchAt: string | null; frozen: boolean
  agent: { name: string; avatarColor?: string } | null; need: LeadNeed; offers: Offer[]; lastSummary: string
  lastAction: { summary: string; kind: string; at: string } | null
}
export interface PipelineResponse {
  counts: Record<Bucket, number>
  conversion: { new_engaged: number | null; engaged_quoted: number | null; quoted_booking: number | null; booking_won: number | null; quiet_engaged: number | null; dormant_engaged: number | null }
  dueThisWeek: number
  days: number
  buckets: { key: Bucket; label: string; count: number }[]
  rows: PipelineRow[]
}

export interface AgentAction {
  _id: string; kind: string; summary: string; detail: Record<string, unknown> | null
  bucketBefore: Bucket | null; bucketAfter: Bucket | null; revertible: boolean; revertedAt: string | null
  actor: 'agent' | 'person' | 'system'; user?: { name?: string } | null; agent?: { name?: string } | null; at: string
  resolution?: string | null; sentText?: string
}
export interface Message { direction: 'inbound' | 'outbound'; text: string; type: string; at: string; byAi: boolean }
export interface LeadDetail {
  file: {
    _id: string; lead: LeadRef; agent: AgentRef; bucket: Bucket; bucketLabel: string; stage: string; previousBucket: Bucket | null
    need: LeadNeed; offers: Offer[]; openQuestions: string[]; lastSummary: string; nextTouchAt: string | null; frozenAt: string | null
  }
  actions: AgentAction[]
  messages: Message[]
}

export interface ToolCall { name: string; args: Record<string, unknown>; result: unknown }
export interface Decision {
  mode: string; trigger: 'inbound' | 'touch'; reply: string; needsHuman: boolean; reason: string; summary: string
  template: { name: string; intent: string; bodyText?: string } | null; bucketBefore: Bucket; bucketAfter: Bucket
  toolCalls: ToolCall[]; grounded: { ok: boolean; loose: string[] }; model: string; promptVersion: number
  usage: { total_tokens?: number } | null
}
export interface SimulateResponse { lead: LeadRef; agent: { _id: string; name: string }; decision: Decision; file: { bucket: Bucket; need: LeadNeed; offers: Offer[]; openQuestions: string[] } }

export type Resolution = 'approved' | 'edited' | 'dismissed' | 'skipped'

export interface AgentStats {
  days: number
  leadsInCare: number; peopleApproached: number; peopleApproachedAllTime: number
  drafts: number; touchesProposed: number; approved: number; edited: number; dismissed: number; judged: number; approvedRate: number | null
  handedOver: number; handedIn: number; reverted: number
  handovers: { key: string; label: string; n: number }[]
  cameBack: number; toQuoted: number; toBooking: number; won: number
  buckets: Partial<Record<Bucket, number>>
  series: { day: string; drafted: number; approved: number; edited: number; dismissed: number }[]
}
export interface RehearsalTurn {
  lead: string; leadName: string; at: string; customerText: string; agentReply: string; needsHuman: boolean; reason: string
  groundedOk: boolean; loose: string[]; tools: string[]; humanReply: string; error: string
}
export interface Rehearsal {
  _id: string; promptVersion: number; model: string; status: 'running' | 'done' | 'failed'
  params: { conversations: number; turns: number }; progress: { done: number; total: number }; turns: RehearsalTurn[]
  summary: { turns: number; grounded: number; handedOver: number; withHumanReply: number; conversations: number }
  error: string; startedAt: string; finishedAt: string | null
}
export type JobSection = 'who' | 'talk' | 'sell' | 'hand'
export interface Review {
  _id: string; promptVersion: number; model: string; periodDays: number; at: string
  review: { summary: string; grade: string; strengths: string[]; weaknesses: string[]; suggestions: { section: JobSection; change: string; why: string; text: string }[] }
}
export interface AgentInsights { stats: AgentStats; rehearsals: Rehearsal[]; reviews: Review[] }

/** The instructions are four sections; the onboarding form edits them one at a time. */
export const JOB_SECTIONS: { key: JobSection; label: string; hint: string }[] = [
  { key: 'who', label: 'Who you are', hint: 'Name, company, the channel. One or two lines.' },
  { key: 'talk', label: 'How you talk', hint: 'Tone, length, one question at a time.' },
  { key: 'sell', label: 'What you sell', hint: 'Units, billing, the rule to always check with tools before quoting.' },
  { key: 'hand', label: 'When you hand over', hint: 'Contracts, invoices, payments, discounts, complaints, "can I speak to someone".' },
]
export type JobParts = Record<JobSection, string>
export const composeJob = (p: JobParts) => JOB_SECTIONS.map((j) => `## ${j.label}\n${p[j.key].trim()}`).join('\n\n')
export const parseJob = (prompt: string): JobParts => {
  const out: JobParts = { who: '', talk: '', sell: '', hand: '' }
  const parts = prompt.split(/^## (.+)$/m)
  if (parts.length < 3) return { ...out, who: prompt }
  for (let i = 1; i < parts.length; i += 2) {
    const j = JOB_SECTIONS.find((x) => x.label === parts[i].trim())
    if (j) out[j.key] = (parts[i + 1] || '').trim()
  }
  return out
}

export const agentsApi = {
  team: () => api.get<TeamResponse>('/agents/team').then((r) => r.data),
  inbox: (agent?: string) => api.get<InboxResponse>('/agents/inbox', { params: agent ? { agent } : {} }).then((r) => r.data),
  resolve: (actionId: string, resolution: Resolution, text = '') => api.post<{ ok: boolean; sent: boolean }>(`/agents/actions/${actionId}/resolve`, { resolution, text }).then((r) => r.data),
  pipeline: (bucket?: string, days = 30) => api.get<PipelineResponse>('/agents/pipeline', { params: { ...(bucket ? { bucket } : {}), days } }).then((r) => r.data),
  lead: (leadId: string) => api.get<LeadDetail>(`/agents/leads/${leadId}`).then((r) => r.data),
  profiles: () => api.get<ProfilesResponse>('/agents/profiles').then((r) => r.data),
  createProfile: (body: Partial<AgentProfile>) => api.post<AgentProfile>('/agents/profiles', body).then((r) => r.data),
  updateProfile: (id: string, body: Partial<AgentProfile>) => api.put<AgentProfile>(`/agents/profiles/${id}`, body).then((r) => r.data),
  adopt: (leadId: string) => api.post(`/agents/leads/${leadId}/adopt`).then((r) => r.data),
  adoptOpen: (limit = 25) => api.post<{ created: number }>('/agents/adopt-open', { limit }).then((r) => r.data),
  handBack: (leadId: string, note = '') => api.post(`/agents/leads/${leadId}/hand-back`, { note }).then((r) => r.data),
  freeze: (leadId: string, resume = false, note = '') => api.post(`/agents/leads/${leadId}/freeze`, { resume, note }).then((r) => r.data),
  revert: (actionId: string) => api.post(`/agents/actions/${actionId}/revert`).then((r) => r.data),
  simulate: (body: { leadId?: string; phone?: string; text?: string; trigger: 'inbound' | 'touch'; persist?: boolean; agentId?: string }) =>
    api.post<SimulateResponse>('/agents/simulate', body).then((r) => r.data),
  tick: () => api.post<{ proposed: number; exhausted: number; silenced: number; failed: number }>('/agents/tick').then((r) => r.data),
  seedTeam: () => api.post<{ team: { name: string; result: string; escalateTo: boolean }[] }>('/agents/seed-team').then((r) => r.data),
  insights: (agentId: string, days = 30) => api.get<AgentInsights>(`/agents/${agentId}/stats`, { params: { days } }).then((r) => r.data),
  rehearse: (agentId: string, params: { conversations?: number; turns?: number } = {}) => api.post<{ rehearsal: Rehearsal; alreadyRunning?: boolean }>(`/agents/${agentId}/rehearse`, params).then((r) => r.data),
  rehearsal: (agentId: string, rid: string) => api.get<Rehearsal>(`/agents/${agentId}/rehearsals/${rid}`).then((r) => r.data),
  review: (agentId: string, days = 30) => api.post<Review>(`/agents/${agentId}/review`, { days }).then((r) => r.data),
  templates: () => api.get<{ configured: boolean; error: string; templates: { name: string; language: string; bodyText: string }[] }>('/agents/templates').then((r) => r.data),
}

export const BUCKET_TONE: Record<Bucket, { bg: string; fg: string }> = {
  new: { bg: '#EFE7FB', fg: '#5B2BC9' },
  engaged: { bg: '#E4D8FA', fg: '#4A1FA0' },
  quoted: { bg: '#DBEAFE', fg: '#1D4ED8' },
  booking: { bg: '#FFEDD5', fg: '#C2410C' },
  quiet: { bg: '#FEF3C7', fg: '#B45309' },
  dormant: { bg: '#F3F4F6', fg: '#374151' },
  with_person: { bg: '#FEE2E2', fg: '#B91C1C' },
  won: { bg: '#DCFCE7', fg: '#15803D' },
  lost: { bg: '#F3F4F6', fg: '#6B7280' },
  do_not_contact: { bg: '#F3F4F6', fg: '#6B7280' },
}

export const AGENT_COLORS = ['#5B2BC9', '#B45309', '#1D4ED8', '#4A4357', '#0F766E', '#BE185D']

export function agentColor(a?: { avatarColor?: string; name?: string } | null) {
  if (a?.avatarColor) return a.avatarColor
  const n = (a?.name || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  return AGENT_COLORS[n % AGENT_COLORS.length]
}

export function agoText(iso: string | null | undefined) {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function dueText(iso: string | null | undefined) {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'due now'
  const h = Math.round(ms / 3600000)
  if (h < 24) return `in ${h}h`
  return `in ${Math.round(h / 24)}d`
}

export function needText(n?: LeadNeed | null) {
  if (!n) return ''
  return [n.sizeSqf && `${n.sizeSqf} sqft`, n.moveIn && `from ${n.moveIn}`, n.durationWeeks && `${n.durationWeeks} wks`, n.budget && `AED ${n.budget}/mo`, n.storing]
    .filter(Boolean).join(' · ')
}
