// Which deployment this build is: main and SAASModel are each deployed
// separately, and it's not otherwise visible from the UI which one you're on.
// Set VITE_APP_ENV=demo or VITE_APP_ENV=production per-deployment (Netlify
// site env vars, or client/.env for local dev). Unset defaults to production
// so a deployment nobody configured never quietly claims to be "just a demo".
export type AppEnv = 'production' | 'demo'

const raw = (import.meta.env.VITE_APP_ENV as string | undefined)?.trim().toLowerCase()

export const appEnv: AppEnv = raw === 'demo' ? 'demo' : 'production'
export const isDemoEnv = appEnv === 'demo'
