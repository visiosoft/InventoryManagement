import { useState } from 'react'
import { Check, KeyRound, User } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, Field, Input, Button } from '../components/ui'

export default function MyAccount() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (next !== confirm) { setErr('Passwords do not match'); return }
    if (next.length < 8) { setErr('Password must be at least 8 characters'); return }
    setBusy(true); setErr(''); setOk(false)
    try {
      const { data } = await api.post('/users/me/change-password', { currentPassword: current, newPassword: next })
      localStorage.setItem('pb_token', data.token)
      setCurrent(''); setNext(''); setConfirm('')
      setOk(true)
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Settings" subtitle="Your account" />

      <Card>
        <CardHeader title="My account" />
        <div className="px-4 pb-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User size={22} className="text-primary" />
          </div>
          <div>
            <div className="font-semibold">{user?.name}</div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Change password" />
        <div className="px-4 pb-4 space-y-4">
          {ok && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2">
              <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">Password updated successfully</span>
            </div>
          )}
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min 8 characters" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end">
            <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
              <KeyRound size={13} /> {busy ? 'Saving…' : 'Update password'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
