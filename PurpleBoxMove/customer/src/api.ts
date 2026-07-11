import { Platform } from 'react-native';

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

export const api = {
  requestOtp: (phone: string) =>
    req<{ message: string; code: string }>('/customer-auth/request-otp', {
      method: 'POST', body: JSON.stringify({ phone }),
    }),

  verifyOtp: (phone: string, code: string) =>
    req<{ token: string; customer: any }>('/customer-auth/verify-otp', {
      method: 'POST', body: JSON.stringify({ phone, code }),
    }),

  getMe: () => req<{ customer: any }>('/customer-auth/me'),

  updateProfile: (data: { fullName?: string; email?: string; nationality?: string; address?: string }) =>
    req<{ customer: any }>('/customer-auth/profile', {
      method: 'PATCH', body: JSON.stringify(data),
    }),

  requestMove: (data: {
    propertyType?: string;
    propertySize?: string;
    moveDate?: string;
    pickupAddress?: string;
    deliveryAddress?: string;
    instructions?: string;
    notes?: string;
  }) =>
    req<{ lead: any }>('/customer-portal/request-move', {
      method: 'POST', body: JSON.stringify(data),
    }),

  getMoves: () =>
    req<{ leads: any[]; jobs: any[] }>('/customer-portal/moves'),

  getMove: (id: string) =>
    req<{ type: string; data: any }>(`/customer-portal/moves/${id}`),

  uploadPhotos: async (
    moveId: string,
    images: { uri: string; name: string; type: string }[],
    category?: string,
  ) => {
    const form = new FormData();
    images.forEach(img => form.append('images', img as any));
    if (category) form.append('category', category);
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/customer-portal/moves/${moveId}/photos`, {
      method: 'POST', headers, body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  getInvoices: () =>
    req<{ invoices: any[] }>('/customer-portal/invoices'),

  getInvoice: (id: string) =>
    req<{ invoice: any }>(`/customer-portal/invoices/${id}`),
};
