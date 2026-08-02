import { Platform } from 'react-native';

// Point to your main PurpleBox backend:
//   Android emulator : http://10.0.2.2:5010
//   iOS simulator    : http://localhost:5010
//   Real device      : http://<LAN-IP>:5010
const API_BASE = Platform.OS === 'android'
  ? 'http://10.0.2.2:5010/api'
  : 'http://localhost:5010/api';

let TOKEN: string | null = null;
export function setToken(t: string | null) { TOKEN = t; }
export function getToken() { return TOKEN; }

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

function qs(p?: Record<string, string>): string {
  if (!p) return '';
  const s = new URLSearchParams(p).toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (email: string, password: string) =>
    req<{ token: string; user: any }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  getMe: () => req<{ user: any }>('/auth/me'),

  getSummary: () => req<any>('/moving-reports/summary'),

  getJobs: (p?: Record<string, string>) =>
    req<{ jobs: any[]; total: number }>(`/moving-jobs${qs(p)}`),
  getJob: (id: string) => req<any>(`/moving-jobs/${id}`),
  createJob: (data: any) =>
    req<any>('/moving-jobs', { method: 'POST', body: JSON.stringify(data) }),
  updateJobStatus: (id: string, status: string) =>
    req<any>(`/moving-jobs/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }),
  addJobNote: (id: string, text: string, author: string) =>
    req<any>(`/moving-jobs/${id}/notes`, {
      method: 'POST', body: JSON.stringify({ text, author }),
    }),
  uploadJobImages: async (
    id: string,
    images: { uri: string; name: string; type: string }[],
    category?: string,
  ) => {
    const form = new FormData();
    images.forEach(img => form.append('images', img as any));
    if (category) form.append('category', category);
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/moving-jobs/${id}/images`, {
      method: 'POST', headers, body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  getSchedule: (from: string, to: string) =>
    req<any[]>(`/moving-jobs/schedule?from=${from}&to=${to}`),

  getLeads: (p?: Record<string, string>) =>
    req<any[]>(`/moving-leads${qs(p)}`),

  searchCustomers: (search: string) =>
    req<{ data: any[] }>(`/customers?search=${encodeURIComponent(search)}&limit=20`),
  createCustomer: (data: { fullName: string; phone?: string; email?: string }) =>
    req<any>('/customers', { method: 'POST', body: JSON.stringify(data) }),

  getWorkers: () => req<any[]>('/workers'),
  getTrucks: () => req<any[]>('/trucks'),
  getInvoices: (p?: Record<string, string>) =>
    req<any[]>(`/moving-invoices${qs(p)}`),
  getInvoice: (id: string) => req<any>(`/moving-invoices/${id}`),
  sendInvoiceWhatsApp: (id: string) =>
    req<{ payUrl: string; token: string; balanceDue: number }>(`/moving-invoices/${id}/payment-link`, { method: 'POST' }),
  getInvoiceShareToken: (id: string) =>
    req<{ token: string }>(`/moving-invoices/${id}/share-token`, { method: 'POST' }),

  getQuotes: (p?: Record<string, string>) =>
    req<any[]>(`/moving-quotes${qs(p)}`),
  getQuote: (id: string) => req<any>(`/moving-quotes/${id}`),
  createQuote: (data: any) =>
    req<any>('/moving-quotes', { method: 'POST', body: JSON.stringify(data) }),
  sendQuoteWhatsApp: (id: string) =>
    req<{ ok: boolean; phone: string }>(`/moving-quotes/${id}/send-whatsapp`, { method: 'POST' }),
  getQuoteShareToken: (id: string) =>
    req<{ token: string }>(`/moving-quotes/${id}/share-token`, { method: 'POST' }),

  getSiteVisits: () => req<any[]>('/site-visits'),
  createSiteVisit: async (data: {
    visitDate: string; customerName: string; customerPhone: string;
    address: string; notes: string;
    files?: { uri: string; name: string; type: string }[];
  }) => {
    const form = new FormData();
    form.append('visitDate', data.visitDate);
    form.append('customerName', data.customerName);
    form.append('customerPhone', data.customerPhone);
    form.append('address', data.address);
    form.append('notes', data.notes);
    if (data.files) {
      data.files.forEach(f => form.append('files', f as any));
    }
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/site-visits`, {
      method: 'POST', headers, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Create failed');
    }
    return res.json();
  },

  createInvoice: (data: any) =>
    req<any>('/moving-invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id: string, data: any) =>
    req<any>(`/moving-invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInvoice: (id: string) =>
    req<{ ok: boolean }>(`/moving-invoices/${id}`, { method: 'DELETE' }),
};
