import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { apiError } from '../lib/api'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel — branding (hidden on small screens) ── */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #111218 0%, #4C8CE4 70%, #3a6db8 100%)' }}>

        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-10" style={{ background: '#FFF799' }} />
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full opacity-10" style={{ background: '#FFF799' }} />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-lg" style={{ background: '#FFF799' }}>
            <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-8 w-8 object-contain" />
          </div>
          <div>
            <div className="font-bold text-white text-lg leading-tight">PurpleBox</div>
            <div className="text-xs leading-tight" style={{ color: '#8FAACF' }}>Unit Rental Manager</div>
          </div>
        </div>

        {/* Hero text */}
        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Manage your<br />storage units<br />with ease.
          </h2>
          <p className="text-base leading-relaxed" style={{ color: '#b8d0f0' }}>
            Track contracts, payments, and customers — all in one place.
          </p>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10 text-xs" style={{ color: '#7aa3cc' }}>
          © {new Date().getFullYear()} PurpleBox. All rights reserved.
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 bg-background">
        {/* Mobile logo */}
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
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your account to continue</p>
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
                className="w-full h-11 rounded-xl border-2 border-border bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-[#FFF799] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
