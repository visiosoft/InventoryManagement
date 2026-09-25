import { api } from './api'

export type Bucket =
  | 'new' | 'engaged' | 'quoted' | 'booking' | 'quiet' | 'dormant'
  | 'with_person' | 'won' | 'lost' | 'do_not_contact'

export interface BucketCount { key: Bucket; label: string; count: number }

export interface LeadNeed {
  sizeSqf: number | null
  moveIn: string
  durationWeeks: number | null
  budget: number | null
  storing: string
}

export interface Offer { unitNumber: string; monthlyPrice: number | null; from: string; to: string; at: string }

export interface DeskRow {
  leadFileId: string
  leadId: string
  name: string
  phone: string
  status?: string
  temperature: string
  bucket: Bucket
  bucketLabel: string
  stage: string
  nextTouchAt: string | null
  frozen: boolean
  agent: string
  need: LeadNeed
  lastSummary: string
  lastAction: { summary: string; kind: string; at: string } | null
}

export interface DeskResponse {
  agent: { _id: string; name: string; mode: string; promptVersion: number } | null
  buckets: BucketCount[]
  rows: DeskRow[]
}

export interface AgentAction {
  _id: string
  kind: string
  summary: string
  detail: unknown
  bucketBefore: Bucket | null
  bucketAfter: Bucket | null
  revertible: boolean
  revertedAt: string | null
  revertOf: string | null
  actor: 'agent' | 'person' | 'system'
  user?: { name?: string } | null
  at: string
}

export interface LeadFileDetail {
  file: {
    _id: string
    lead: { _id: string; fullName: string; phone: string; status?: string; temperature?: string }
    agent: { name: string; promptVersion: number }
    bucket: Bucket
    bucketLabel: string
    stage: string
    need: LeadNeed
    offers: Offer[]
    openQuestions: string[]
    lastSummary: string
    nextTouchAt: string | null
    frozenAt: string | null
  }
  actions: AgentAction[]
}

export interface AgentProfile {
  _id: string
  name: string
  systemPrompt: string
  promptVersion: number
  model: string
  mode: 'off' | 'shadow'
  enabledTools: string[]
  whatsappNumbers: string[]
  cadence: { quoted: number[]; booking: number[]; quiet: number[]; dormant: number[] }
  escalateTo: { _id: string; name: string; email: string } | string | null
  maxToolRounds: number
  syncLeadStatus: boolean
  isActive: boolean
}

export interface ProfilesResponse {
  profiles: AgentProfile[]
  users: { _id: string; name: string; email: string; role: string }[]
  tools: string[]
  modes: string[]
  defaultCadence: AgentProfile['cadence']
}

export interface ToolCall { name: string; args: Record<string, unknown>; result: unknown }

export interface Decision {
  mode: string
  trigger: 'inbound' | 'touch'
  reply: string
  needsHuman: boolean
  reason: string
  summary: string
  template: { name: string; intent: string; bodyText?: string } | null
  bucketBefore: Bucket
  bucketAfter: Bucket
  toolCalls: ToolCall[]
  grounded: { ok: boolean; loose: string[] }
  model: string
  promptVersion: number
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
}

export interface SimulateResponse {
  lead: { _id: string; fullName: string; phone: string }
  decision: Decision
  file: { bucket: Bucket; need: LeadNeed; offers: Offer[]; openQuestions: string[] }
}

export const agentsApi = {
  desk: (bucket?: string) => api.get<DeskResponse>('/agents/desk', { params: bucket ? { bucket } : {} }).then((r) => r.data),
  lead: (leadId: string) => api.get<LeadFileDetail>(`/agents/leads/${leadId}`).then((r) => r.data),
  profiles: () => api.get<ProfilesResponse>('/agents/profiles').then((r) => r.data),
  createProfile: (body: Partial<AgentProfile>) => api.post<AgentProfile>('/agents/profiles', body).then((r) => r.data),
  updateProfile: (id: string, body: Partial<AgentProfile>) => api.put<AgentProfile>(`/agents/profiles/${id}`, body).then((r) => r.data),
  adopt: (leadId: string) => api.post(`/agents/leads/${leadId}/adopt`).then((r) => r.data),
  adoptOpen: (limit = 25) => api.post<{ created: number }>('/agents/adopt-open', { limit }).then((r) => r.data),
  handBack: (leadId: string, note = '') => api.post(`/agents/leads/${leadId}/hand-back`, { note }).then((r) => r.data),
  freeze: (leadId: string, resume = false, note = '') => api.post(`/agents/leads/${leadId}/freeze`, { resume, note }).then((r) => r.data),
  revert: (actionId: string) => api.post(`/agents/actions/${actionId}/revert`).then((r) => r.data),
  simulate: (body: { leadId?: string; phone?: string; text?: string; trigger: 'inbound' | 'touch'; persist?: boolean }) =>
    api.post<SimulateResponse>('/agents/simulate', body).then((r) => r.data),
  tick: () => api.post<{ proposed: number; exhausted: number; silenced: number; failed: number }>('/agents/tick').then((r) => r.data),
}

export const BUCKET_TONE: Record<Bucket, { bg: string; fg: string }> = {
  new: { bg: '#EFE7FB', fg: '#5B2BC9' },
  engaged: { bg: '#EFE7FB', fg: '#5B2BC9' },
  quoted: { bg: '#DBEAFE', fg: '#1D4ED8' },
  booking: { bg: '#FFEDD5', fg: '#C2410C' },
  quiet: { bg: '#FEF3C7', fg: '#B45309' },
  dormant: { bg: '#F3F4F6', fg: '#374151' },
  with_person: { bg: '#FEE2E2', fg: '#B91C1C' },
  won: { bg: '#DCFCE7', fg: '#15803D' },
  lost: { bg: '#F3F4F6', fg: '#6B7280' },
  do_not_contact: { bg: '#F3F4F6', fg: '#6B7280' },
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
