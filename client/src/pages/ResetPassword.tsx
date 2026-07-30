import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, apiError } from '../lib/api'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid reset link</h1>
          <p className="text-sm text-muted-foreground mb-4">This password reset link is missing or invalid.</p>
          <Link to="/forgot-password" className="text-sm font-semibold" style={{ color: '#4C8CE4' }}>Request a new link</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #111218 0%, #4C8CE4 70%, #3a6db8 100%)' }}>
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-10" style={{ background: '#FFF799' }} />
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full opacity-10" style={{ background: '#FFF799' }} />
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-lg" style={{ background: '#FFF799' }}>
            <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-8 w-8 object-contain" />
          </div>
          <div>
            <div className="font-bold text-white text-lg leading-tight">PurpleBox</div>
            <div className="text-xs leading-tight" style={{ color: '#8FAACF' }}>Unit Rental Manager</div>
          </div>
        </div>
        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Set a new<br />password
          </h2>
          <p className="text-base leading-relaxed" style={{ color: '#b8d0f0' }}>
            Choose a strong password for your account.
          </p>
        </div>
        <div className="relative z-10 text-xs" style={{ color: '#7aa3cc' }}>
          © {new Date().getFullYear()} PurpleBox. All rights reserved.
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 bg-background">
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: '#FFF799' }}>
            <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <div className="font-bold text-foreground leading-tight">PurpleBox</div>
            <div className="text-xs text-muted-foreground leading-tight">Unit Rental Manager</div>
          </div>
        </div>

        <div className="w-full max-w-sm">
          {done ? (
            <div>
              <div className="h-14 w-14 rounded-full flex items-center justify-center mb-5" style={{ background: '#E8F5E9' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <h1 className="text-2xl font-bold text-foreground">Password reset!</h1>
              <p className="text-sm text-muted-foreground mt-2 mb-6">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full h-11 rounded-xl font-semibold text-sm transition-all duration-150"
                style={{ background: '#FFF799', color: '#111218' }}
              >
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-foreground">Reset password</h1>
                <p className="text-sm text-muted-foreground mt-1">Enter your new password below</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">New password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    required
                    autoFocus
                    className="w-full h-11 rounded-xl border-2 border-border bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-[#FFF799] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">Confirm password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    className="w-full h-11 rounded-xl border-2 border-border bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-[#FFF799] transition-colors"
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2.5 text-xs text-red-700 dark:text-red-400">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  style={{ background: '#FFF799', color: '#111218' }}
                >
                  {busy ? 'Resetting…' : 'Reset password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
