import axios from 'axios'

/* The trainer API. Every request carries the session and the organisation
   being worked on; the server checks both. */

export const TOKEN_KEY = 'trainer_token'
export const ORG_KEY = 'trainer_org'

/** Where the app is served: '/' on its own domain, '/train/' inside the CRM site. */
export const BASE = import.meta.env.BASE_URL

export const api = axios.create({ baseURL: `${BASE}api` })

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
    const here = location.pathname.slice(BASE.length - 1)
    if (!here.startsWith('/login') && !here.startsWith('/signup') && !here.startsWith('/invite')) location.assign(`${BASE}login`)
  }
  return Promise.reject(err)
})

export function apiError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || 'Something went wrong'
}
