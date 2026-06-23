import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { apiError } from '../../lib/api'

export default function FieldLogin() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/field', { replace: true })
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Truck size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">PurpleBox Moving</h1>
            <p className="text-muted-foreground text-sm mt-1">Field Worker Portal</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {err && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-700">
              {err}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="you@company.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-base font-semibold shadow-sm hover:bg-primary/90 disabled:opacity-60 transition-colors mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Use your regular PurpleBox login credentials
        </p>
      </div>
    </div>
  )
}
