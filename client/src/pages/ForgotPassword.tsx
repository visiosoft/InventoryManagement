import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
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
            Forgot your<br />password?
          </h2>
          <p className="text-base leading-relaxed" style={{ color: '#b8d0f0' }}>
            No worries — we'll send you a link to reset it.
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
          {sent ? (
            <div>
              <div className="h-14 w-14 rounded-full flex items-center justify-center mb-5" style={{ background: '#E8F5E9' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" /></svg>
              </div>
              <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
              <p className="text-sm text-muted-foreground mt-2 mb-6">
                If an account exists for <strong className="text-foreground">{email}</strong>, we've sent a password reset link. Check your inbox and spam folder.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold"
                style={{ color: '#4C8CE4' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-foreground">Forgot password</h1>
                <p className="text-sm text-muted-foreground mt-1">Enter your email and we'll send you a reset link</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@purplebox.ae"
                    required
                    autoFocus
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
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-5 text-center">
                <Link to="/login" className="text-sm font-medium" style={{ color: '#4C8CE4' }}>
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
