import type { CSSProperties } from 'react'

/* AI Training & Quality Control — shared types and small pieces. */

export type Suggestion = { text: string; sources: string[]; needsData: string; escalate: boolean; by?: string; at?: string; error?: string }
export type Cluster = {
  _id: string; key: string; name: string; category: string; question: string; count: number; languages: string[]
  status: 'new' | 'suggested' | 'approved' | 'rejected' | 'escalated'
  suggestion?: Suggestion; record?: string | null; bulkEligible?: boolean
  comments?: { by: { name: string }; text: string; at: string }[]
  history?: { action: string; by: { name: string }; at: string; note?: string }[]
}
export type Question = { _id: string; text: string; lang: string; repeats: number; split: 'train' | 'eval'; humanReply?: string; at?: string; context?: { from: string; text: string }[] }
export type Version = { version: number; answer: string; followUp?: string; status: string; by?: { name: string }; at?: string; note?: string; original?: string }
export type KRecord = {
  _id: string; intent: string; category: string; question: string; variations: string[]; answer: string; followUp: string
  escalate: boolean; escalationNote: string; status: string; version: number; versions: Version[]
  approvedBy?: { name: string }; approvedAt?: string; expiresAt?: string | null
}
export type OrgSettings = {
  id: string; name: string; slug: string; business: string; categories: string[]; prohibited: string[]; activeSnapshot: number; plan: string
  maxReplyLength: number; retentionDays: number; facts: string; variables: { name: string; value: string }[]
  ai: { provider: string; model: string; keyHint: string; defaults: Record<string, string> }
  connector: { url: string; enabled: boolean; hasToken: boolean; lastCheckAt?: string; lastCheck: string }
  whatsapp: { connected: boolean; phoneNumberId: string; connectedAt?: string }
}
export type Me = { org: OrgSettings; role: string; permissions: string[] }

export const INK = '#14081F'
export const MUTED = '#6B6478'
export const PURPLE = '#4A2A9E'
export const LINE = 'rgba(20,8,31,.09)'
export const TINT = '#F6F4FB'
export const HEAD = "'Bricolage Grotesque', sans-serif"

export const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: 'New', bg: '#F1EFF5', fg: MUTED },
  suggested: { label: 'To review', bg: '#FFF3D6', fg: '#8A5A00' },
  approved: { label: 'Approved', bg: '#E5F6EC', fg: '#166534' },
  published: { label: 'Published', bg: '#E8E3FA', fg: PURPLE },
  rejected: { label: 'Rejected', bg: '#FDECEC', fg: '#B91C1C' },
  escalated: { label: 'To a person', bg: '#FFEDE5', fg: '#C2410C' },
  draft: { label: 'Draft', bg: '#F1EFF5', fg: MUTED },
  superseded: { label: 'Superseded', bg: '#F1EFF5', fg: MUTED },
  archived: { label: 'Archived', bg: '#F1EFF5', fg: MUTED },
  running: { label: 'Running', bg: '#E8E3FA', fg: PURPLE },
  done: { label: 'Done', bg: '#E5F6EC', fg: '#166534' },
  failed: { label: 'Failed', bg: '#FDECEC', fg: '#B91C1C' },
}


export const btn = (primary = false, danger = false): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', height: 34, padding: '0 13px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: primary ? 0 : `1px solid ${LINE}`, background: primary ? PURPLE : '#fff', color: primary ? '#fff' : danger ? '#B91C1C' : INK,
})

export const panel: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14 }
export const caps: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }
export const field: CSSProperties = { width: '100%', border: `1px solid rgba(20,8,31,.16)`, borderRadius: 9, padding: '8px 10px', fontSize: 13.5, background: '#fff', color: INK }

export const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
