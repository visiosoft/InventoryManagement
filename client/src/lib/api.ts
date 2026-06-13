import axios from 'axios'
import type { Expense, IntegrationStatus, Invoice, Lead, Purchase, Quote, Vendor } from './types'

export const api = axios.create({ baseURL: '/api' })

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

export const leadApi = {
  list: (params: LeadQuery) => api.get<Lead[]>('/leads', { params }).then((r) => r.data),
  create: (body: Partial<Lead>) => api.post<Lead>('/leads', body).then((r) => r.data),
  update: (id: string, body: Partial<Lead>) => api.put<Lead>(`/leads/${id}`, body).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Lead>(`/leads/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/leads/${id}`).then((r) => r.data),
}

export const integrationApi = {
  status: () => api.get<IntegrationStatus>('/integrations/status').then((r) => r.data),
  syncGoogleContacts: (owner?: string) =>
    api
      .post<{ ok: boolean; configured: boolean; summary: { created: number; updated: number; skipped: number; errors: number } }>(
        '/integrations/google-contacts/sync',
        owner ? { owner } : {}
      )
      .then((r) => r.data),
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
