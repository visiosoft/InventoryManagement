import { Platform } from 'react-native';

const API_BASE = 'https://purplebox.mypaperlessoffice.org/api';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers, signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  requestOtp: (phone: string) =>
    req<{ message: string; code: string }>('/crew-auth/request-otp', {
      method: 'POST', body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string) =>
    req<{ token: string; worker: any }>('/crew-auth/verify-otp', {
      method: 'POST', body: JSON.stringify({ phone, code }),
    }),
  getMe: () => req<{ worker: any }>('/crew-auth/me'),

  getJobsByDate: (date: string) => req<{ jobs: any[] }>(`/crew-portal/jobs/by-date/${date}`),
  getJobs: () => req<{ jobs: any[] }>('/crew-portal/jobs'),
  getJob: (id: string) => req<{ job: any }>(`/crew-portal/jobs/${id}`),
  updateJobStatus: (id: string, status: string) =>
    req<{ job: any }>(`/crew-portal/jobs/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }),
  updateChecklist: (id: string, items: any[]) =>
    req<{ job: any }>(`/crew-portal/jobs/${id}/checklist`, {
      method: 'PATCH', body: JSON.stringify({ items }),
    }),
  uploadPhotos: async (jobId: string, images: { uri: string; name: string; type: string }[], area?: string) => {
    const form = new FormData();
    for (const img of images) {
      await appendFile(form, 'images', img.uri, img.name, img.type);
    }
    if (area) form.append('area', area);
    const headers: Record<string, string> = {};
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(`${API_BASE}/crew-portal/jobs/${jobId}/photos`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  clockIn: () => req<{ status: string; time: string }>('/crew-portal/clock-in', { method: 'POST', body: '{}' }),
  clockOut: () => req<{ status: string; time: string }>('/crew-portal/clock-out', { method: 'POST', body: '{}' }),
};
