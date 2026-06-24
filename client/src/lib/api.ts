import axios from 'axios'
import type { Expense, IntegrationStatus, Invoice, Lead, Product, Purchase, Quote, UnitType, Vendor } from './types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

export const api = axios.create({ baseURL: apiBaseUrl })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pb_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
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
}

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
  list: (params: LeadQuery) => api.get<Lead[]>('/leads', { params }).then((r) => r.data),
  create: (body: Partial<Lead>) => api.post<Lead>('/leads', body).then((r) => r.data),
  update: (id: string, body: Partial<Lead>) => api.put<Lead>(`/leads/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string, comment?: string) => api.patch<Lead>(`/leads/${id}/status`, { status, comment }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/leads/${id}`).then((r) => r.data),
}

export const integrationApi = {
  status: () => api.get<IntegrationStatus>('/integrations/status').then((r) => r.data),
  syncGoogleContacts: () =>
    api
      .post<{ ok: boolean; configured: boolean; summary: { created: number; updated: number; skipped: number; errors: number } }>(
        '/integrations/google-contacts/sync', {}
      )
      .then((r) => r.data),
  lastSync: () =>
    api
      .get<{ at: string | null; created: number; updated: number; skipped: number; errors: number }>(
        '/integrations/google-contacts/last-sync'
      )
      .then((r) => r.data),
  connectContacts: () =>
    api.get<{ url: string }>('/integrations/contacts/connect').then((r) => r.data),
}

export type QuoteQuery = { search?: string; status?: string; customer?: string }
export type InvoiceQuery = { search?: string; status?: string; customer?: string }

export const quoteApi = {
  list: (params: QuoteQuery) => api.get<Quote[]>('/quotes', { params }).then((r) => r.data),
  get: (id: string) => api.get<Quote>(`/quotes/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Quote>('/quotes', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Quote>(`/quotes/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Quote>(`/quotes/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/quotes/${id}`).then((r) => r.data),
}

export const invoiceApi = {
  list: (params: InvoiceQuery) => api.get<Invoice[]>('/invoices', { params }).then((r) => r.data),
  get: (id: string) => api.get<Invoice>(`/invoices/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Invoice>('/invoices', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Invoice>(`/invoices/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Invoice>(`/invoices/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/invoices/${id}`).then((r) => r.data),
  uploadAttachments: (id: string, form: FormData) =>
    api.post<Invoice>(`/invoices/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  removeAttachment: (id: string, index: number) => api.delete<Invoice>(`/invoices/${id}/attachments/${index}`).then((r) => r.data),
  recordPayment: (id: string, body: { amount: number; method: string; date: string; notes?: string }) =>
    api.post<Invoice>(`/invoices/${id}/record-payment`, body).then((r) => r.data),
  deletePayment: (id: string, idx: number) => api.delete<Invoice>(`/invoices/${id}/payments/${idx}`).then((r) => r.data),
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

export type VendorQuery = { search?: string; status?: string; category?: string }
export type PurchaseQuery = { search?: string; status?: string; vendor?: string }
export type ExpenseQuery = {
  search?: string
  status?: string
  vendor?: string
  expenseAccount?: string
  from?: string
  to?: string
}

export const vendorApi = {
  list: (params: VendorQuery) => api.get<Vendor[]>('/vendors', { params }).then((r) => r.data),
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Vendor>('/vendors', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Vendor>(`/vendors/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/vendors/${id}`).then((r) => r.data),
  importCsv: (form: FormData) =>
    api
      .post<{ ok: boolean; summary: { created: number; updated: number; skipped: number; errors: number; total: number } }>(
        '/vendors/import/csv',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
  summary: (id: string) =>
    api.get<VendorSummary>(`/vendors/${id}/summary`).then((r) => r.data),
}

export const purchaseApi = {
  list: (params: PurchaseQuery) => api.get<Purchase[]>('/purchases', { params }).then((r) => r.data),
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
}

export const expenseApi = {
  list: (params: ExpenseQuery) => api.get<Expense[]>('/expenses', { params }).then((r) => r.data),
  get: (id: string) => api.get<Expense>(`/expenses/${id}`).then((r) => r.data),
  create: (body: Record<string, unknown>) => api.post<Expense>('/expenses', body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) => api.put<Expense>(`/expenses/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Expense>(`/expenses/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/expenses/${id}`).then((r) => r.data),
  importCsv: (form: FormData) =>
    api
      .post<{ ok: boolean; summary: { created: number; updated: number; skipped: number; errors: number; vendorLinked: number; total: number } }>(
        '/expenses/import/csv',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      .then((r) => r.data),
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
  lead?: { _id: string; fullName: string; phone: string; status: string; source: string }
}

export type WhatsAppConversation = {
  phoneNormalized: string
  phone: string
  count: number
  lastAt: string
}

export const whatsappApi = {
  conversations: () => api.get<WhatsAppConversation[]>('/whatsapp/conversations').then((r) => r.data),
  messages: (phone?: string) =>
    api.get<WhatsAppMsg[]>('/whatsapp/messages', { params: phone ? { phone } : {} }).then((r) => r.data),
  send: (to: string, body: string) => api.post<{ ok: boolean }>('/whatsapp/send', { to, body }).then((r) => r.data),
}
