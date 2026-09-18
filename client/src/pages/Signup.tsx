import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Headphones, User } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError } from '../lib/api'

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [businessName, setBusinessName] = useState('')
  const [adminName, setAdminName]       = useState('')
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [error, setError]               = useState('')
  const [busy, setBusy]                 = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signup({ businessName, adminName, email, password })
      navigate('/')
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  const inputClass = "w-full h-12 rounded-lg border border-border bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#4C8CE4]/40 focus:border-[#4C8CE4] transition-colors"

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel — the form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 lg:px-20 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2.5 mb-8">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#FFF799' }}>
              <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-5 w-5 object-contain" />
            </div>
            <span className="font-bold text-foreground">PurpleBox</span>
          </div>

          <div className="mb-7">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">Welcome to PurpleBox</h1>
            <p className="text-sm text-muted-foreground mt-2">Get started — it's free. No credit card needed.</p>
          </div>

          <button
            type="button"
            disabled
            title="Coming soon"
            className="w-full h-12 rounded-lg border border-border bg-card text-sm font-medium text-muted-foreground flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
          >
            Continue with Google
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted">Soon</span>
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">Or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5">
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Business name"
              required
              className={inputClass}
            />
            <input
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Your name"
              required
              className={inputClass}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (at least 6 characters)"
              required
              minLength={6}
              className={inputClass}
            />

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2.5 text-xs text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-lg font-semibold text-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
              style={{ background: '#FFF799', color: '#111218' }}
            >
              {busy ? 'Creating your account…' : 'Continue'}
            </button>

            <p className="text-center text-xs text-muted-foreground pt-1">
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </p>

            <p className="text-center text-xs text-muted-foreground pt-2">
              Already have an account? <Link to="/login" className="font-medium" style={{ color: '#4C8CE4' }}>Log in</Link>
            </p>
          </form>
        </div>
      </div>

      {/* ── Right panel — illustration (hidden on small screens) ── */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center relative overflow-hidden p-10"
        style={{ background: 'linear-gradient(160deg, #111218 0%, #4C8CE4 70%, #3a6db8 100%)' }}>

        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-10" style={{ background: '#FFF799' }} />
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full opacity-10" style={{ background: '#FFF799' }} />

        <div className="relative w-full max-w-sm">
          {/* A mock "product" card, echoing what a dashboard looks like once you're in */}
          <div className="rounded-2xl bg-white shadow-2xl p-5 relative z-10">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`flex items-center gap-3 ${i > 0 ? 'mt-4' : ''}`}>
                <div className="h-8 w-8 rounded-full shrink-0" style={{ background: ['#4C8CE4', '#FFF799', '#5B2BC9'][i], opacity: 0.85 }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2 rounded-full bg-muted" style={{ width: `${70 - i * 10}%` }} />
                  <div className="h-2 rounded-full bg-muted/60" style={{ width: `${45 - i * 5}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Floating "Done" tag */}
          <div className="absolute -right-4 top-6 rounded-lg bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 shadow-lg rotate-[-4deg] z-20">
            Done
          </div>

          {/* Floating avatar bubbles */}
          <div className="absolute -top-8 left-10 h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg z-20"
            style={{ background: '#5B2BC9' }}>
            <Headphones size={22} className="text-white" />
          </div>
          <div className="absolute -bottom-8 -right-6 h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg z-20"
            style={{ background: '#4C8CE4' }}>
            <User size={26} className="text-white" />
          </div>
          <div className="absolute top-1/2 -left-10 h-10 w-10 rounded-full flex items-center justify-center shadow-lg z-20"
            style={{ background: '#FFF799' }}>
            <Check size={18} style={{ color: '#111218' }} />
          </div>
        </div>

        {/* Hero text */}
        <div className="absolute bottom-10 left-10 right-10 z-10">
          <h2 className="text-2xl font-bold text-white leading-tight mb-2">Start your free trial in minutes.</h2>
          <p className="text-sm leading-relaxed" style={{ color: '#b8d0f0' }}>
            Up to 50 units and 50 contracts, free — upgrade any time for unlimited.
          </p>
        </div>
      </div>
    </div>
  )
}
