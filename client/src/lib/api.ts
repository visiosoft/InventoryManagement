import axios from 'axios'
import type { Customer, Expense, IntegrationStatus, Invoice, Lead, Product, Purchase, Quote, ReminderConfig, ReminderLog, UnitType, Vendor } from './types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

export const api = axios.create({ baseURL: apiBaseUrl })

/** Absolute URL for a raw API path (PDF links, downloads) — always on the API
 * host, never the frontend origin, so proxies can't misroute it. */
export const apiUrl = (path: string) => `${apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`

/**
 * Which requests carry the chosen facility.
 *
 * An allowlist, not every request. The first attempt at facilities sent
 * `?site=` to everything, including the many routes that ignore it — so some
 * pages filtered and others did not, the app disagreed with itself, and the
 * whole feature was switched off. These are exactly the routes whose handlers
 * call `siteScope()` on the server.
 *
 * Everything absent from this list is company-wide on purpose: quotes,
 * invoices, leads, customers, tasks, documents, expenses and the whole moving
 * business are not split by facility. Add a path here only alongside the
 * server-side scoping that makes it mean something.
 */
const SITE_SCOPED_PATHS = [
  '/units',
  '/contracts',
  '/payments',
  '/reports',
  '/floor-plans',
]

const isSiteScoped = (url = '') => {
  const path = url.split('?')[0]
  return SITE_SCOPED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pb_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  const siteId = localStorage.getItem('pb_site_id')
  if (siteId && isSiteScoped(config.url) && config.params?.site === undefined) {
    config.params = { ...(config.params ?? {}), site: siteId }
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('pb_token')
      localStorage.removeItem('pb_user')
      location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) return err.response?.data?.error || err.message
  return err instanceof Error ? err.message : 'Something went wrong'
}

export type LeadQuery = {
  search?: string
  status?: string
  source?: string
  owner?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

export type LeadPage = { data: Lead[]; total: number; page: number; pages: number; limit: number }

export const productApi = {
  list: () => api.get<Product[]>('/products').then((r) => r.data),
  listAll: () => api.get<Product[]>('/products?active=false').then((r) => r.data),
  create: (body: Partial<Product>) => api.post<Product>('/products', body).then((r) => r.data),
  update: (id: string, body: Partial<Product>) => api.put<Product>(`/products/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/products/${id}`).then((r) => r.data),
}

export const unitTypeApi = {
  list: () => api.get<UnitType[]>('/unit-types').then((r) => r.data),
  create: (body: Partial<UnitType>) => api.post<UnitType>('/unit-types', body).then((r) => r.data),
  update: (id: string, body: Partial<UnitType>) => api.put<UnitType>(`/unit-types/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/unit-types/${id}`).then((r) => r.data),
}

export const leadApi = {
  list: (params: LeadQuery) => api.get<LeadPage>('/leads', { params }).then((r) => r.data),
  create: (body: Partial<Lead>) => api.post<Lead>('/leads', body).then((r) => r.data),
  update: (id: string, body: Partial<Lead>) => api.put<Lead>(`/leads/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string, comment?: string) => api.patch<Lead>(`/leads/${id}/status`, { status, comment }).then((r) => r.data),
  convertToCustomer: (id: string) =>
    api
      .post<{ ok: true; created: boolean; customer: Customer; lead: Lead }>(`/leads/${id}/convert`)
      .then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/leads/${id}`).then((r) => r.data),
}

export const integrationApi = {
  status: () => api.get<IntegrationStatus>('/integrations/status').then((r) => r.data),
  connectDrive: () =>
    api.get<{ url: string }>('/integrations/drive/connect').then((r) => r.data),
  connectGmail: () =>
    api.get<{ url: string }>('/integrations/gmail/connect').then((r) => r.data),
  connectStripe: (body: { secretKey?: string; webhookSecret?: string }) =>
    api.post<{ ok: true; configured: boolean; webhookConfigured: boolean }>('/integrations/stripe/connect', body).then((r) => r.data),
  disconnectStripe: () =>
    api.post<{ ok: true }>('/integrations/stripe/disconnect').then((r) => r.data),
}

export type QuoteQuery = { search?: string; status?: string; customer?: string; lead?: string }
export type InvoiceQuery = { search?: string; status?: string; customer?: string; page?: number; limit?: number }

export interface UnitBooking {
  kind: 'contract' | 'quote' | 'current'
  ref: string
  customer: string
  startDate?: string
  endDate?: string
  status?: string
}

export interface AvailableUnit {
  _id: string
  unitNumber: string
  floor: string
  sizeSqf: number
  price: number
  status: string
  discountPct: number
  bookedInPeriod?: boolean
  bookings?: UnitBooking[]
}

export const quoteApi = {
  list: (params: QuoteQuery) => api.get<Quote[]>('/quotes', { params }).then((r) => r.data),
  get: (id: string) => api.get<Quote>(`/quotes/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Quote>('/quotes', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Quote>(`/quotes/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Quote>(`/quotes/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/quotes/${id}`).then((r) => r.data),
  updateFlowStep: (id: string, step: number, stepsDone: boolean[]) =>
    api.patch(`/quotes/${id}/flow-step`, { step, stepsDone }).then((r) => r.data),
  convertToContract: (id: string) =>
    api.post<{ contractId: string; contractNo: string }>(`/quotes/${id}/convert-to-contract`).then((r) => r.data),
  share: (id: string, channel?: 'whatsapp' | 'email') =>
    api.post<{ token: string; url: string }>(`/quotes/${id}/share`, { channel }).then((r) => r.data),
  availableUnits: (from?: string, to?: string, all?: boolean) =>
    api.get<AvailableUnit[]>('/quotes/available-units', { params: { from, to, all: all ? 'true' : undefined } }).then((r) => r.data),
}

export const invoiceApi = {
  list: (params: InvoiceQuery) => api.get<{ data: Invoice[]; total: number; page: number; pages: number; limit: number }>('/invoices', { params }).then((r) => r.data),
  get: (id: string) => api.get<Invoice>(`/invoices/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Invoice>('/invoices', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Invoice>(`/invoices/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Invoice>(`/invoices/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/invoices/${id}`).then((r) => r.data),
  removeMany: (ids: string[]) => api.post<{ ok: true; deleted: number; requested: number }>('/invoices/bulk-delete', { ids }).then((r) => r.data),
  uploadAttachments: (id: string, form: FormData) =>
    api.post<Invoice>(`/invoices/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  removeAttachment: (id: string, index: number) => api.delete<Invoice>(`/invoices/${id}/attachments/${index}`).then((r) => r.data),
  recordPayment: (id: string, body: { amount: number; method: string; date: string; notes?: string }) =>
    api.post<Invoice>(`/invoices/${id}/record-payment`, body).then((r) => r.data),
  deletePayment: (id: string, idx: number) => api.delete<Invoice>(`/invoices/${id}/payments/${idx}`).then((r) => r.data),
  importCsv: (form: FormData, mode: 'skip' | 'update' = 'skip') =>
    api
      .post<{ ok: boolean; batch: string; summary: { created: number; updated: number; skipped: number; errors: number; stubsCreated: number; total: number }; stubs: string[]; errors: string[] }>(
        `/invoices/import/csv?mode=${mode}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
  rollbackImport: (batch: string) =>
    api.delete<{ ok: boolean; invoicesDeleted: number; customersDeleted: number }>(`/invoices/import/rollback/${encodeURIComponent(batch)}`).then((r) => r.data),
}

export const customerApi = {
  bulkDelete: (ids: string[]) =>
    api.post<{ ok: boolean; deleted: number; skipped: number }>('/customers/bulk-delete', { ids }).then((r) => r.data),
  mergeInto: (sourceId: string, targetId: string) =>
    api.post<{ ok: boolean; invoicesMoved: number; deletedCustomer: string; intoCustomer: string }>(`/customers/${sourceId}/merge-into/${targetId}`).then((r) => r.data),
}

export interface VendorSummary {
  stats: {
    totalBills: number
    totalPaid: number
    outstanding: number
    overdueBills: number
    totalExpenses: number
    billCount: number
    expenseCount: number
  }
  monthlyData: { month: string; bills: number; paid: number }[]
}

export type PagedResponse<T> = { data: T[]; total: number; page: number; pages: number; limit: number }

export type VendorQuery = { search?: string; status?: string; category?: string; page?: number; limit?: number }
export type PurchaseQuery = { search?: string; status?: string; vendor?: string; page?: number; limit?: number }
export type ExpenseQuery = {
  search?: string
  status?: string
  vendor?: string
  vendorName?: string
  expenseAccount?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

export const vendorApi = {
  list: (params: VendorQuery) => api.get<PagedResponse<Vendor>>('/vendors', { params }).then((r) => r.data),
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Vendor>('/vendors', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Vendor>(`/vendors/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/vendors/${id}`).then((r) => r.data),
  importCsv: (form: FormData, mode: 'skip' | 'update' = 'skip') =>
    api
      .post<{ ok: boolean; summary: { created: number; updated: number; skipped: number; errors: number; total: number } }>(
        `/vendors/import/csv?mode=${mode}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
  summary: (id: string) =>
    api.get<VendorSummary>(`/vendors/${id}/summary`).then((r) => r.data),
}

export const purchaseApi = {
  list: (params: PurchaseQuery) => api.get<PagedResponse<Purchase>>('/purchases', { params }).then((r) => r.data),
  get: (id: string) => api.get<Purchase>(`/purchases/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Purchase>('/purchases', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Purchase>(`/purchases/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Purchase>(`/purchases/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/purchases/${id}`).then((r) => r.data),
  uploadAttachments: (id: string, form: FormData) =>
    api.post<Purchase>(`/purchases/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  removeAttachment: (id: string, index: number) => api.delete<Purchase>(`/purchases/${id}/attachments/${index}`).then((r) => r.data),
  recordPayment: (id: string, body: { amount: number; method: string; date: string; notes?: string }) =>
    api.post<Purchase>(`/purchases/${id}/record-payment`, body).then((r) => r.data),
  deletePayment: (id: string, idx: number) =>
    api.delete<Purchase>(`/purchases/${id}/payments/${idx}`).then((r) => r.data),
  importCsv: (form: FormData, mode: 'skip' | 'update' = 'skip') =>
    api
      .post<{ ok: boolean; summary: { created: number; updated: number; skipped: number; errors: number; vendorLinked: number; total: number } }>(
        `/purchases/import/csv?mode=${mode}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
}

export const expenseApi = {
  list: (params: ExpenseQuery) => api.get<PagedResponse<Expense>>('/expenses', { params }).then((r) => r.data),
  get: (id: string) => api.get<Expense>(`/expenses/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Expense>('/expenses', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Expense>(`/expenses/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Expense>(`/expenses/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/expenses/${id}`).then((r) => r.data),
  importCsv: (form: FormData, mode: 'skip' | 'update' = 'skip') =>
    api
      .post<{ ok: boolean; summary: { created: number; updated: number; skipped: number; errors: number; vendorLinked: number; total: number } }>(
        `/expenses/import/csv?mode=${mode}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
  relinkVendors: () =>
    api.post<{ ok: boolean; linked: number; checked: number }>('/expenses/relink-vendors').then((r) => r.data),
  uploadAttachments: (id: string, form: FormData) =>
    api.post(`/expenses/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  removeAttachment: (id: string, index: number) =>
    api.delete(`/expenses/${id}/attachments/${index}`).then((r) => r.data),
}

export type WhatsAppMsg = {
  _id: string
  messageId: string
  phone: string
  phoneNormalized: string
  direction: 'inbound' | 'outbound'
  type: string
  text: string
  status: string
  occurredAt: string
  // Written by the AI assistant rather than a colleague.
  sentByAi?: boolean
  // Set when the sender edited, deleted or reacted to this message afterwards.
  editedAt?: string | null
  deletedAt?: string | null
  reaction?: string
  /* Set on a message we have since corrected — the wording the customer has
     is out of date, and the thread should say so. */
  correctedAt?: string | null
  replyToMessageId?: string
}

/** ownerName is '' when nobody has been given the lead yet. */
export type WhatsAppLeadRef = {
  _id: string; fullName: string; status: string
  ownerName?: string
  /** Who owns it, by id — the inbox reassigns from the chat and must not
      identify a person by name. null when nobody has it. */
  ownerId?: string | null
  /** Somebody chose this owner, rather than it being auto-created with one. */
  assigned?: boolean
  /** The name they set on their own WhatsApp profile, if we have seen one. */
  profileName?: string
}

/** A named tag a person puts on a conversation, as in the WhatsApp Business app. */
export type WhatsAppLabel = {
  _id: string
  name: string
  color: string
  sortOrder?: number
  chatCount?: number
}

export type WhatsAppConversation = {
  phoneNormalized: string
  phone: string
  count: number
  lastAt: string
  /* When they last wrote. WhatsApp only allows free text for 24 hours after
     this; past it only an approved template gets through. */
  lastInboundAt?: string | null
  lead: WhatsAppLeadRef | null
  // Resolved on the server by the last nine digits of the number. Whether
  // someone is a customer is a fact about this, not about a lead's status.
  customer: { _id: string; fullName: string } | null
  labels: WhatsAppLabel[]
  // AI assistant state for this thread: '' when it has never looked at it.
  botStatus?: '' | 'bot' | 'escalated' | 'paused'
  botDraft?: string
  botEscalationReason?: string
}

export type WhatsAppCredentials = {
  phoneNumberId?: string
  accessToken?: string
  verifyToken?: string
  appSecret?: string
}

export const whatsappApi = {
  /**
   * The conversation list.
   *
   * `q` is searched server-side across every thread — the sidebar only holds a
   * window of the most recent, so filtering in the browser could never reach an
   * older chat. `phone` keeps the open conversation in the response even when
   * it sorts below that window.
   */
  conversations: (opts: { q?: string; phone?: string; limit?: number; owner?: string } = {}) =>
    api.get<WhatsAppConversation[]>('/whatsapp/conversations', {
      params: {
        ...(opts.q ? { q: opts.q } : {}),
        ...(opts.phone ? { phone: opts.phone } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.owner && opts.owner !== 'all' ? { owner: opts.owner } : {}),
      },
    }).then((r) => {
      /* Counted over every conversation, not the page being returned — the
         tabs used to count what had been loaded, so a rep with 275 chats was
         told they had four.

         null means the API predates this and did neither the counting nor the
         filtering, so the page falls back to doing both over what it has. A
         missing header must not read as "you have none". */
      let ownerCounts: { all: number; mine: number; unassigned: number } | null = null
      try {
        const raw = r.headers['x-owner-counts']
        if (raw) ownerCounts = JSON.parse(String(raw))
      } catch { /* an older API, handled above */ }
      return {
        list: r.data,
        total: Number(r.headers['x-total-conversations']) || r.data.length,
        matched: Number(r.headers['x-matched-conversations']) || r.data.length,
        ownerCounts,
      }
    }),
  messages: (phone?: string) =>
    api.get<WhatsAppMsg[]>('/whatsapp/messages', { params: phone ? { phone } : {} }).then((r) => r.data),
  send: (to: string, body: string) => api.post<{ ok: boolean }>('/whatsapp/send', { to, body }).then((r) => r.data),
  // Removes it from our own record — Meta has no unsend endpoint, so this
  // cannot pull a message back off the customer's phone.
  deleteMessage: (id: string) => api.delete<WhatsAppMsg>(`/whatsapp/messages/${id}`).then((r) => r.data),
  /* Send corrected wording as a reply quoting the original. Meta has no edit
     for business messages, so the old one stays on their phone with the
     correction threaded underneath it. */
  correctMessage: (id: string, text: string) =>
    api.post<{ ok: boolean; quoted: boolean; message: WhatsAppMsg }>(
      `/whatsapp/messages/${id}/correct`, { text },
    ).then((r) => r.data),
  labels: () => api.get<WhatsAppLabel[]>('/whatsapp/labels').then((r) => r.data),
  createLabel: (body: { name: string; color: string }) =>
    api.post<WhatsAppLabel>('/whatsapp/labels', body).then((r) => r.data),
  updateLabel: (id: string, body: Partial<{ name: string; color: string; sortOrder: number }>) =>
    api.patch<WhatsAppLabel>(`/whatsapp/labels/${id}`, body).then((r) => r.data),
  deleteLabel: (id: string) => api.delete(`/whatsapp/labels/${id}`).then((r) => r.data),
  setChatLabels: (phoneNormalized: string, labelIds: string[]) =>
    api.put<{ ok: boolean; labels: string[] }>(
      `/whatsapp/conversations/${phoneNormalized}/labels`, { labelIds }
    ).then((r) => r.data),
  createLead: (phoneNormalized: string, body: { fullName?: string; email?: string; owner?: string; notes?: string }) =>
    api.post<{ action: 'created' | 'updated' | 'exists'; lead: WhatsAppLeadRef }>(
      `/whatsapp/conversations/${phoneNormalized}/lead`, body,
    ).then((r) => r.data),
  connect: (body: WhatsAppCredentials) =>
    api.post<{ ok: boolean; configured: boolean; missing: string[]; displayPhoneNumber: string; verifiedName: string }>(
      '/integrations/whatsapp/connect', body
    ).then((r) => r.data),
  disconnect: () => api.post<{ ok: boolean }>('/integrations/whatsapp/disconnect').then((r) => r.data),
}

export const reminderConfigApi = {
  get: () => api.get<ReminderConfig>('/reminder-config').then((r) => r.data),
  save: (body: Partial<ReminderConfig>) => api.put<ReminderConfig>('/reminder-config', body).then((r) => r.data),
  logs: (params?: { contract?: string; payment?: string; limit?: number; skip?: number }) =>
    api.get<{ logs: ReminderLog[]; total: number }>('/reminder-config/logs', { params }).then((r) => r.data),
  test: (paymentId: string) =>
    api.post<{ ok: boolean; stageName: string; message: string; results: { channel: string; success: boolean; error?: string }[] }>(
      `/reminder-config/test/${paymentId}`, {}
    ).then((r) => r.data),
  runNow: () => api.post<{ ok: boolean; sent: number; skipped: number; errors: number }>('/reminder-config/run', {}).then((r) => r.data),
}
