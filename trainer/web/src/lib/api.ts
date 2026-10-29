import axios from 'axios'

/* The trainer API. Every request carries the session and the organisation
   being worked on; the server checks both. */

export const TOKEN_KEY = 'trainer_token'
export const ORG_KEY = 'trainer_org'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  try {
    const t = localStorage.getItem(TOKEN_KEY)
    const o = localStorage.getItem(ORG_KEY)
    if (t) config.headers.Authorization = `Bearer ${t}`
    if (o) config.headers['X-Org'] = o
  } catch { /* private window: signed out */ }
  return config
})

api.interceptors.response.use((r) => r, (err) => {
  if (err?.response?.status === 401 && !String(err.config?.url || '').startsWith('/auth/')) {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
    if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/signup') && !location.pathname.startsWith('/invite')) location.assign('/login')
  }
  return Promise.reject(err)
})

export function apiError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || 'Something went wrong'
}
