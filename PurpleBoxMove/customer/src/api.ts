import { Platform } from 'react-native';

const API_BASE = 'https://office.purplebox.ae/api';

async function appendFile(form: FormData, fieldName: string, uri: string, name: string, type?: string) {
  if (Platform.OS === 'web') {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    form.append(fieldName, blob, name);
  } else {
    form.append(fieldName, { uri, name, type: type || 'image/jpeg' } as any);
  }
}

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
  verifyOtp: (phone: string, code: string, fullName?: string) =>
    req<{ token: string; customer: any; isNew: boolean }>('/customer-auth/verify-otp', {
      method: 'POST', body: JSON.stringify({ phone, code, fullName }),
    }),
  googleAuth: (accessToken: string) =>
    req<{ token: string; customer: any; needsPhone: boolean }>('/customer-auth/google', {
      method: 'POST', body: JSON.stringify({ accessToken }),
    }),
  setPhone: (phone: string) =>
    req<{ token: string; customer: any }>('/customer-auth/set-phone', {
      method: 'PATCH', body: JSON.stringify({ phone }),
    }),
  getMe: () => req<{ customer: any }>('/customer-auth/me'),
  updateProfile: (data: any) =>
    req<{ customer: any }>('/customer-auth/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  requestMove: async (data: any, photos?: { uri: string; name: string }[]) => {
    const form = new FormData();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null) form.append(k, String(v));
    });
    if (photos?.length) {
      for (const p of photos) {
        await appendFile(form, 'images', p.uri, p.name);
      }
    }
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/customer-portal/request-move`, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ job: any; lead: any }>;
  },
  getMoves: () =>
    req<{ leads: any[]; jobs: any[] }>('/customer-portal/moves'),
  getMove: (id: string) =>
    req<{ type: string; data: any }>(`/customer-portal/moves/${id}`),
  uploadPhotos: async (moveId: string, images: { uri: string; name: string; type: string }[], category?: string) => {
    const form = new FormData();
    for (const img of images) {
      await appendFile(form, 'images', img.uri, img.name, img.type);
    }
    if (category) form.append('category', category);
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/customer-portal/moves/${moveId}/photos`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  acceptQuote: (moveId: string) =>
    req<{ ok: boolean; jobStatus: string }>(`/customer-portal/moves/${moveId}/accept-quote`, { method: 'POST' }),
  getInvoices: () => req<{ invoices: any[] }>('/customer-portal/invoices'),
};
