import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { formatDistanceToNowStrict } from 'date-fns'
import { api } from './api'
import { useAuth } from './auth'

/** Client requests: one staff inbox for everything a customer asks for in the
 *  app (service jobs, extensions, move-outs, refunds, ID checks, bookings that
 *  need a look, new sign-ups). The server decides who sees what and which
 *  actions are allowed; this file only describes the shapes. */

export const CR_TYPES = ['service', 'extend', 'moveout', 'deposit_refund', 'id_check', 'booking_review', 'new_signup'] as const
export type CrType = typeof CR_TYPES[number]
export type CrTeam = 'warehouse' | 'sales' | 'accounts'
export const CR_STATUSES = ['new', 'in_progress', 'waiting_customer', 'resolved', 'declined', 'cancelled'] as const
export type CrStatus = typeof CR_STATUSES[number]
/** The statuses staff can set by hand; the rest come from an action. */
export const CR_OPEN_STATUSES = ['new', 'in_progress', 'waiting_customer'] as const
export type CrOpenStatus = typeof CR_OPEN_STATUSES[number]
export type CrScope = 'mine' | 'team' | 'all' | 'done'

export type CrAction =
  | 'claim' | 'assign' | 'status' | 'note' | 'message' | 'approve' | 'decline' | 'verify' | 'reject'
  | 'mark_refunded' | 'create_lead' | 'not_interested' | 'resolve'

export const TYPE_LABEL: Record<CrType, string> = {
  service: 'Service request',
  extend: 'Extend contract',
  moveout: 'Move-out',
  deposit_refund: 'Deposit refund',
  id_check: 'ID check',
  booking_review: 'Booking needs review',
  new_signup: 'New app sign-up',
}
export const TYPE_TONE: Record<CrType, string> = {
  service: 'blue', extend: 'purple', moveout: 'amber', deposit_refund: 'green',
  id_check: 'gray', booking_review: 'red', new_signup: 'blue',
}

export const TEAM_LABEL: Record<CrTeam, string> = { warehouse: 'Warehouse', sales: 'Sales', accounts: 'Accounts' }

export const STATUS_LABEL: Record<CrStatus, string> = {
  new: 'New', in_progress: 'In progress', waiting_customer: 'Waiting on customer',
  resolved: 'Resolved', declined: 'Declined', cancelled: 'Cancelled',
}
export const STATUS_TONE: Record<CrStatus, string> = {
  new: 'amber', in_progress: 'blue', waiting_customer: 'purple', resolved: 'green', declined: 'red', cancelled: 'gray',
}

export const isClosed = (s: CrStatus) => s === 'resolved' || s === 'declined' || s === 'cancelled'

export interface CrRow {
  id: string
  ref: string
  type: CrType
  team: CrTeam
  status: CrStatus
  priority: 'normal' | 'high'
  title: string
  summary: string
  customer: { id: string; name: string; phone: string } | null
  contract: { id: string; contractNo: string; units: string[] } | null
  assignee: { id: string; name: string } | null
  dueAt: string | null
  overdue: boolean
  escalatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CrList { items: CrRow[]; total: number; page: number; limit: number }

export interface CrCounts { mine: number; team: number; overdue: number; byType: Partial<Record<CrType, number>> }

export interface CrActivity { at: string; byName: string; kind: string; text: string }
export interface CrResolution { at: string; byName: string; outcome: string; reason: string }

export interface ServiceContext {
  serviceRequest: {
    id: string; ref: string; type: string; status: string; date: string; slotLabel: string | null
    startTime: string | null; endTime: string | null
    address: { label: string; line: string }
    items: Array<{ id: string; label: string; name: string; location: string | null }>
    estimate: { lines: Array<{ label: string; amount: number }>; total: number }
    payment: { state: 'pending' | 'paid' | 'refunded' | 'expired'; amount: number; cardFee: number; totalCharged: number; paidAt: string | null } | null
    driverName: string; driverPhone: string; charged: number | null; staffNote: string; notes: string
  }
}
export interface CustomerRequestInfo {
  id: string; status: string
  payload: { months?: number; requestedEndDate?: string; [k: string]: unknown }
  staffNote: string; createdAt: string
}
export interface ExtendContext {
  customerRequest: CustomerRequestInfo
  contract: { id: string; contractNo: string; endDate: string; rate: number; units: string[] }
  preview: { newEndDate: string; amount?: number }
}
export type MoveoutContext = ExtendContext
export interface DepositRefundContext {
  customerRequest: CustomerRequestInfo
  contract: { id: string; contractNo: string; endDate: string; status: string; deposit: number }
}
export interface IdCheckDoc {
  id: string; type: string; side: string; uploadedAt: string; url: string
  verification: { state: string; by: string; at: string; reason: string } | null
}
export interface IdCheckContext { documents: IdCheckDoc[] }
export interface BookingReviewContext {
  quote: { id: string; quoteNo: string; reviewReason: string; stripePaidAt: string | null; units: unknown; total: number }
}
export interface NewSignupContext {
  customer: { id: string; name: string; phone: string; email: string; createdAt: string; stage: string }
  existingLead: { id: string; status: string; owner: string | { id: string; name: string } | null } | null
}

export interface CrDetail extends CrRow {
  activity: CrActivity[]
  resolution: CrResolution | null
  context: Record<string, unknown>
  actions: CrAction[]
}

/* ---------- api helpers ---------- */

export const CR_KEY = 'client-requests'
export const crListKey = (params: Record<string, unknown>) => [CR_KEY, 'list', params] as const
export const crDetailKey = (id: string) => [CR_KEY, 'detail', id] as const
export const CR_COUNTS_KEY = [CR_KEY, 'counts'] as const

export const crApi = {
  list: (params: { scope: CrScope; type?: string; status?: string; q?: string; page?: number; limit?: number }) =>
    api.get<CrList>('/client-requests', {
      params: {
        scope: params.scope, type: params.type || undefined, status: params.status || undefined,
        q: params.q || undefined, page: params.page, limit: params.limit,
      },
    }).then(r => r.data),
  detail: (id: string) => api.get<CrDetail>(`/client-requests/${id}`).then(r => r.data),
  assignees: (team: CrTeam) => api.get<Array<{ id: string; name: string; role: string }>>('/client-requests/assignees', { params: { team } }).then(r => r.data),
  claim: (id: string) => api.post<CrDetail>(`/client-requests/${id}/claim`).then(r => r.data),
  assign: (id: string, userId: string | null) => api.post<CrDetail>(`/client-requests/${id}/assign`, { userId }).then(r => r.data),
  status: (id: string, status: CrOpenStatus) => api.post<CrDetail>(`/client-requests/${id}/status`, { status }).then(r => r.data),
  note: (id: string, text: string) => api.post<CrDetail>(`/client-requests/${id}/note`, { text }).then(r => r.data),
  message: (id: string, text: string) => api.post<CrDetail>(`/client-requests/${id}/message`, { text }).then(r => r.data),
  action: (id: string, body: { action: CrAction; reason?: string; amount?: number; method?: string; note?: string }) =>
    api.post<CrDetail>(`/client-requests/${id}/action`, body).then(r => r.data),
}

const ZERO_COUNTS: CrCounts = { mine: 0, team: 0, overdue: 0, byType: {} }

/** Sidebar and tab counts. A 404 means the server has not been deployed with
 *  this feature yet, so it reads as zeros rather than breaking the page. */
export function useClientRequestCounts() {
  const { user } = useAuth()
  return useQuery<CrCounts>({
    queryKey: CR_COUNTS_KEY,
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<CrCounts>('/client-requests/counts')
        return { ...ZERO_COUNTS, ...data, byType: data?.byType ?? {} }
      } catch (e) {
        if (axios.isAxiosError(e) && (e.response?.status === 404 || e.response?.status === 403)) return ZERO_COUNTS
        throw e
      }
    },
  })
}

/** "in 40 min" / "overdue 2h" — short enough for a table cell. */
export function dueLabel(dueAt: string | null, overdue: boolean): string {
  if (!dueAt) return '—'
  const short = formatDistanceToNowStrict(new Date(dueAt))
    .replace(/ seconds?/, 's').replace(/ minutes?/, ' min').replace(/ hours?/, 'h').replace(/ days?/, 'd')
    .replace(/ months?/, ' mo').replace(/ years?/, 'y')
  return overdue ? `overdue ${short}` : `in ${short}`
}
