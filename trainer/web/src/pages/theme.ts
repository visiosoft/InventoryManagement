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

/* Soft, light and blue: white cards floating on a pale blue wash. */
export const INK = '#0F172A'
export const MUTED = '#64748B'
export const ACCENT = '#2563EB'
export const LINE = 'rgba(15,23,42,.07)'
export const TINT = '#EFF4FF'
export const HEAD = "'Inter', system-ui, sans-serif"
export const SHADOW = '0 1px 2px rgba(15,23,42,.04), 0 10px 30px -12px rgba(37,99,235,.18)'
/* One colour per measure, used by every chart and legend. */
export const SERIES = { approved: '#22C55E', edited: '#2563EB', rejected: '#EF4444', escalated: '#F59E0B', questions: '#8B5CF6' } as const

export const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: 'New', bg: '#F1F5F9', fg: MUTED },
  suggested: { label: 'To review', bg: '#FFF3D6', fg: '#8A5A00' },
  approved: { label: 'Approved', bg: '#E5F6EC', fg: '#166534' },
  published: { label: 'Published', bg: '#E0EAFF', fg: ACCENT },
  rejected: { label: 'Rejected', bg: '#FDECEC', fg: '#B91C1C' },
  escalated: { label: 'To a person', bg: '#FFEDE5', fg: '#C2410C' },
  draft: { label: 'Draft', bg: '#F1EFF5', fg: MUTED },
  superseded: { label: 'Superseded', bg: '#F1EFF5', fg: MUTED },
  archived: { label: 'Archived', bg: '#F1EFF5', fg: MUTED },
  running: { label: 'Running', bg: '#E0EAFF', fg: ACCENT },
  done: { label: 'Done', bg: '#E5F6EC', fg: '#166534' },
  failed: { label: 'Failed', bg: '#FDECEC', fg: '#B91C1C' },
}


export const btn = (primary = false, danger = false): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', height: 34, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: primary ? 0 : `1px solid rgba(15,23,42,.1)`, color: primary ? '#fff' : danger ? '#DC2626' : INK,
  background: primary ? 'linear-gradient(180deg, #3B82F6, #2563EB)' : '#fff',
  boxShadow: primary ? '0 6px 16px -6px rgba(37,99,235,.55)' : '0 1px 2px rgba(15,23,42,.04)',
})

export const panel: CSSProperties = { background: 'rgba(255,255,255,.88)', border: '1px solid rgba(255,255,255,.9)', borderRadius: 18, boxShadow: SHADOW, backdropFilter: 'blur(8px)' }
export const caps: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }
export const field: CSSProperties = { width: '100%', border: '1px solid rgba(15,23,42,.12)', borderRadius: 10, padding: '8px 11px', fontSize: 13.5, background: '#fff', color: INK }

export const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
