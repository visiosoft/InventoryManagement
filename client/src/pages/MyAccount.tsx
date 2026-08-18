import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, KeyRound, Target, User } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, Field, Input, Button, Spinner } from '../components/ui'
import { isSalesRepRole } from '../lib/roles'

interface TargetsResponse {
  targets: {
    daily: { units: number; moving: number }
    weekly: { units: number; moving: number }
    monthly: { units: number; moving: number }
    dailyFollowUps: number
    startTime: string
    finishTime: string
  }
}

function TargetsCard() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<TargetsResponse>({
    queryKey: ['my-targets'],
    queryFn: () => api.get('/sales-goals/me').then((r) => r.data),
  })

  const [dailyFollowUps, setDailyFollowUps] = useState('0')
  const [startTime, setStartTime] = useState('')
  const [finishTime, setFinishTime] = useState('')
  const [dailyUnits, setDailyUnits] = useState('0')
  const [dailyMoving, setDailyMoving] = useState('0')
  const [weeklyUnits, setWeeklyUnits] = useState('0')
  const [weeklyMoving, setWeeklyMoving] = useState('0')
  const [monthlyUnits, setMonthlyUnits] = useState('0')
  const [monthlyMoving, setMonthlyMoving] = useState('0')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    const t = data.targets
    setDailyFollowUps(String(t.dailyFollowUps ?? 0))
    setStartTime(t.startTime || '')
    setFinishTime(t.finishTime || '')
    setDailyUnits(String(t.daily?.units ?? 0))
    setDailyMoving(String(t.daily?.moving ?? 0))
    setWeeklyUnits(String(t.weekly?.units ?? 0))
    setWeeklyMoving(String(t.weekly?.moving ?? 0))
    setMonthlyUnits(String(t.monthly?.units ?? 0))
    setMonthlyMoving(String(t.monthly?.moving ?? 0))
  }, [data])

  async function save() {
    setBusy(true); setErr(''); setOk(false)
    try {
      await api.put('/sales-goals/me', {
        dailyFollowUps: Number(dailyFollowUps) || 0,
        startTime,
        finishTime,
        daily: { units: Number(dailyUnits) || 0, moving: Number(dailyMoving) || 0 },
        weekly: { units: Number(weeklyUnits) || 0, moving: Number(weeklyMoving) || 0 },
        monthly: { units: Number(monthlyUnits) || 0, moving: Number(monthlyMoving) || 0 },
      })
      qc.invalidateQueries({ queryKey: ['my-targets'] })
      qc.invalidateQueries({ queryKey: ['sales-goal'] })
      setOk(true)
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  if (isLoading) return <Card><div className="p-4"><Spinner /></div></Card>

  return (
    <Card>
      <CardHeader title="Daily targets" />
      <div className="px-4 pb-4 space-y-4">
        {ok && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2">
            <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Targets saved</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Daily follow-ups">
            <Input type="number" min={0} value={dailyFollowUps} onChange={(e) => setDailyFollowUps(e.target.value)} />
          </Field>
          <Field label="Start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="Finish time">
            <Input type="time" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Storage sales</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Daily"><Input type="number" min={0} value={dailyUnits} onChange={(e) => setDailyUnits(e.target.value)} /></Field>
            <Field label="Weekly"><Input type="number" min={0} value={weeklyUnits} onChange={(e) => setWeeklyUnits(e.target.value)} /></Field>
            <Field label="Monthly"><Input type="number" min={0} value={monthlyUnits} onChange={(e) => setMonthlyUnits(e.target.value)} /></Field>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Moving sales</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Daily"><Input type="number" min={0} value={dailyMoving} onChange={(e) => setDailyMoving(e.target.value)} /></Field>
            <Field label="Weekly"><Input type="number" min={0} value={weeklyMoving} onChange={(e) => setWeeklyMoving(e.target.value)} /></Field>
            <Field label="Monthly"><Input type="number" min={0} value={monthlyMoving} onChange={(e) => setMonthlyMoving(e.target.value)} /></Field>
          </div>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            <Target size={13} /> {busy ? 'Saving…' : 'Save targets'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

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

      {isSalesRepRole(user?.role) && <TargetsCard />}

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
