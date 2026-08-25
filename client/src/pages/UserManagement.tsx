import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Edit2, KeyRound, ListTodo, Plus, ShieldCheck, ShieldOff, Target, Trash2, User, UserCog } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Input,
  Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th,
} from '../components/ui'
import { formatDate } from '../lib/utils'
import { isSalesRepRole, roleLabel } from '../lib/roles'

// ── Module definitions ────────────────────────────────────────────────────────

const MODULE_GROUPS = [
  {
    label: 'Inventory',
    modules: [
      { key: 'dashboard',        label: 'Dashboard' },
      { key: 'units',            label: 'Units' },
      { key: 'moving_inventory', label: 'Moving Ops' },
      { key: 'contracts',        label: 'Contracts' },
      { key: 'documents',        label: 'Documents' },
    ],
  },
  {
    label: 'Sales',
    modules: [
      { key: 'customers', label: 'Customers' },
      { key: 'quotes',    label: 'Quotes' },
      { key: 'invoices',  label: 'Invoices' },
    ],
  },
  {
    label: 'Purchases',
    modules: [
      { key: 'vendors',  label: 'Vendors' },
      { key: 'expenses', label: 'Expenses' },
    ],
  },
  {
    label: 'Operations',
    modules: [
      { key: 'leads',     label: 'Leads' },
      { key: 'whatsapp',  label: 'WhatsApp' },
      { key: 'purchases', label: 'Purchases' },
      { key: 'payments',  label: 'Payments' },
    ],
  },
  {
    label: 'Reports',
    modules: [
      { key: 'reports_monthly',   label: 'Monthly Payments' },
      { key: 'reports_units',     label: 'Unit Revenue' },
      { key: 'reports_finances',  label: 'Finances' },
      { key: 'reports_forecast',  label: 'Forecast' },
      { key: 'reports_contracts', label: 'Contracts Overview' },
      { key: 'reports_vacancies', label: 'Upcoming Vacancies' },
      { key: 'reports_overdue',   label: 'Overdue Payments' },
      { key: 'reports_expiring',  label: 'Expiring Contracts' },
    ],
  },
  {
    label: 'Moving Business',
    modules: [
      { key: 'moving_dashboard',        label: 'Dashboard' },
      { key: 'moving_leads',            label: 'Leads' },
      { key: 'moving_jobs',             label: 'Jobs' },
      { key: 'moving_schedule',         label: 'Schedule' },
      { key: 'moving_dispatch',         label: 'Dispatch' },
      { key: 'moving_workers',          label: 'Workers' },
      { key: 'moving_fleet',            label: 'Fleet' },
      { key: 'moving_quotes',            label: 'Quotes' },
      { key: 'moving_invoices',         label: 'Invoices' },
      { key: 'reports_moving_revenue',  label: 'Revenue Report' },
      { key: 'reports_moving_jobs',     label: 'Jobs Report' },
      { key: 'reports_moving_crew',     label: 'Crew Report' },
      { key: 'reports_moving_fleet',    label: 'Fleet Report' },
    ],
  },
  {
    label: 'Admin',
    modules: [
      { key: 'settings', label: 'Settings' },
    ],
  },
]

const ALL_MODULE_KEYS = MODULE_GROUPS.flatMap(g => g.modules.map(m => m.key))

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppUser {
  _id: string; name: string; email: string; role: string
  permissions: string[]; isActive: boolean; createdAt: string
}

// ── Permission checkbox grid ──────────────────────────────────────────────────

function PermissionGrid({ permissions, onChange, disabled }: {
  permissions: string[]
  onChange: (p: string[]) => void
  disabled?: boolean
}) {
  function toggle(key: string) {
    if (disabled) return
    onChange(permissions.includes(key) ? permissions.filter(k => k !== key) : [...permissions, key])
  }
  function toggleGroup(keys: string[], on: boolean) {
    if (disabled) return
    if (on) onChange([...new Set([...permissions, ...keys])])
    else onChange(permissions.filter(k => !keys.includes(k)))
  }
  function toggleAll(on: boolean) {
    if (disabled) return
    onChange(on ? [...ALL_MODULE_KEYS] : [])
  }

  const allChecked = ALL_MODULE_KEYS.every(k => permissions.includes(k))

  return (
    <div className="space-y-4">
      {/* Select all */}
      <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/50">
        <span className="text-sm font-semibold">All modules</span>
        <button type="button" onClick={() => toggleAll(!allChecked)} disabled={disabled}
          className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${allChecked ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-primary'}`}>
          {allChecked && <Check size={11} className="text-white" strokeWidth={3} />}
        </button>
      </div>

      {/* Groups */}
      {MODULE_GROUPS.map(group => {
        const keys = group.modules.map(m => m.key)
        const groupAllChecked = keys.every(k => permissions.includes(k))
        const groupSomeChecked = keys.some(k => permissions.includes(k))
        return (
          <div key={group.label} className="rounded-lg border overflow-hidden">
            {/* Group header */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
              <button type="button" onClick={() => toggleGroup(keys, !groupAllChecked)} disabled={disabled}
                className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  ${groupAllChecked ? 'bg-primary border-primary' : groupSomeChecked ? 'bg-primary/30 border-primary/60' : 'border-muted-foreground/40 hover:border-primary'}`}>
                {(groupAllChecked || groupSomeChecked) && <Check size={9} className="text-white" strokeWidth={3} />}
              </button>
            </div>
            {/* Module rows */}
            <div className="divide-y">
              {group.modules.map(mod => {
                const checked = permissions.includes(mod.key)
                return (
                  <label key={mod.key}
                    className={`flex items-center justify-between px-3 py-2 text-sm
                      ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-muted/30'}`}>
                    <span>{mod.label}</span>
                    <button type="button" onClick={() => toggle(mod.key)} disabled={disabled}
                      className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors shrink-0
                        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
                        ${checked ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-primary'}`}>
                      {checked && <Check size={9} className="text-white" strokeWidth={3} />}
                    </button>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Add / Edit user modal ─────────────────────────────────────────────────────

function UserModal({ editing, onClose, onDone }: {
  editing: AppUser | null   // null = create new
  onClose: () => void
  onDone: () => void
}) {
  const isNew = !editing
  const [name, setName]           = useState(editing?.name ?? '')
  const [email, setEmail]         = useState(editing?.email ?? '')
  const [password, setPassword]   = useState('')
  const [role, setRole]           = useState(editing?.role ?? 'staff')
  const [permissions, setPerms]   = useState<string[]>(
    editing?.permissions?.length ? editing.permissions : (editing?.role === 'admin' ? ALL_MODULE_KEYS : isSalesRepRole(editing?.role) ? ['sales_board'] : [])
  )
  const [isActive, setIsActive]   = useState(editing?.isActive ?? true)
  const [err, setErr]             = useState('')
  const [busy, setBusy]           = useState(false)
  const qc = useQueryClient()

  const isAdmin = role === 'admin'
  const isSalesRep = isSalesRepRole(role)

  function changeRole(next: string) {
    setRole(next)
    if (isSalesRepRole(next)) setPerms(['sales_board'])
    else if (permissions.length === 1 && permissions[0] === 'sales_board') setPerms([])
  }

  async function submit() {
    setBusy(true); setErr('')
    try {
      const body = { name, email, role, permissions, isActive }
      if (isNew) {
        await api.post('/users', { ...body, password })
      } else {
        await api.put(`/users/${editing!._id}`, password ? { ...body, password } : body)
      }
      qc.invalidateQueries({ queryKey: ['users'] })
      onDone()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal
      open
      wide
      title={isNew ? 'Add user' : 'Edit user'}
      onClose={onClose}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        {/* Left: account details */}
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Account details</div>
          <Field label="Full name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
          </Field>
          <Field label="Email address">
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
          </Field>
          <Field label={isNew ? 'Password' : 'New password (leave blank to keep current)'}>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={isNew ? 'Min 8 characters' : 'Leave blank to keep current'} />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={e => changeRole(e.target.value)}>
              <option value="staff">Staff — limited to assigned modules</option>
              <option value="admin">Admin — full access to everything</option>
              <option value="sales_rep">Sales Rep — only their assigned leads</option>
              <option value="accounts">Accounts — same access as a sales rep</option>
            </Select>
          </Field>

          {!isNew && (
            <Field label="Status">
              <Select value={isActive ? 'active' : 'inactive'} onChange={e => setIsActive(e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive (cannot log in)</option>
              </Select>
            </Field>
          )}

          {isAdmin && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-sm">
              <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" />
              <span className="text-muted-foreground">Admin users can manage settings and users. Select which modules they can access below.</span>
            </div>
          )}
          {isSalesRep && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-sm">
              <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" />
              <span className="text-muted-foreground">Sales reps automatically get their own "My Leads" board (only leads assigned to them), plus read access to the Unit Map, Customers, and Moving Schedule.</span>
            </div>
          )}
        </div>

        {/* Right: permissions */}
        {!isSalesRep && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Module access
            </div>
            <PermissionGrid permissions={permissions}
              onChange={setPerms} disabled={false} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t gap-3">
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name || !email || (isNew && !password)}>
            {busy ? 'Saving…' : isNew ? 'Create user' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Change password modal (for self) ─────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr]         = useState('')
  const [ok, setOk]           = useState(false)
  const [busy, setBusy]       = useState(false)

  async function submit() {
    if (next !== confirm) { setErr('Passwords do not match'); return }
    if (next.length < 8)  { setErr('Password must be at least 8 characters'); return }
    setBusy(true); setErr('')
    try {
      const { data } = await api.post('/users/me/change-password', { currentPassword: current, newPassword: next })
      localStorage.setItem('pb_token', data.token)
      setOk(true)
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open title="Change password" onClose={onClose}>
      {ok ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Check size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="font-medium">Password updated successfully</p>
          <Button onClick={onClose} className="mt-2">Done</Button>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <Field label="Current password">
              <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password">
              <Input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="Min 8 characters" />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between mt-5 pt-4 border-t gap-3">
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
                {busy ? 'Saving…' : 'Update password'}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── Sales rep: Targets modal (admin sets weekly/monthly goals) ───────────────

export function TargetsModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [weekUnits, setWeekUnits]     = useState('0')
  const [weekMoving, setWeekMoving]   = useState('0')
  const [monthUnits, setMonthUnits]   = useState('0')
  const [monthMoving, setMonthMoving] = useState('0')
  const [err, setErr]                 = useState('')
  const [busy, setBusy]               = useState(false)

  const { data, isLoading } = useQuery<{ targets: { weekly: { units: number; moving: number }; monthly: { units: number; moving: number } } }>({
    queryKey: ['sales-goals', user._id],
    queryFn: () => api.get(`/sales-goals/${user._id}`).then(r => r.data),
  })

  useEffect(() => {
    if (!data) return
    setWeekUnits(String(data.targets.weekly.units))
    setWeekMoving(String(data.targets.weekly.moving))
    setMonthUnits(String(data.targets.monthly.units))
    setMonthMoving(String(data.targets.monthly.moving))
  }, [data])

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.put(`/sales-goals/${user._id}`, {
        weekly: { units: Number(weekUnits) || 0, moving: Number(weekMoving) || 0 },
        monthly: { units: Number(monthUnits) || 0, moving: Number(monthMoving) || 0 },
      })
      onClose()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open title={`Targets — ${user.name}`} onClose={onClose}>
      {isLoading ? <Spinner /> : (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">This week</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units leased"><Input type="number" min={0} value={weekUnits} onChange={e => setWeekUnits(e.target.value)} /></Field>
              <Field label="Moving jobs booked"><Input type="number" min={0} value={weekMoving} onChange={e => setWeekMoving(e.target.value)} /></Field>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">This month</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units leased"><Input type="number" min={0} value={monthUnits} onChange={e => setMonthUnits(e.target.value)} /></Field>
              <Field label="Moving jobs booked"><Input type="number" min={0} value={monthMoving} onChange={e => setMonthMoving(e.target.value)} /></Field>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4 border-t gap-3">
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save targets'}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Sales rep: New Task modal (admin assigns a task to the rep) ──────────────

function NewTaskModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [priority, setPriority]     = useState('medium')
  const [err, setErr]               = useState('')
  const [busy, setBusy]             = useState(false)

  async function submit() {
    if (!title.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post('/tasks', {
        title: title.trim(),
        description: description.trim(),
        assignedTo: user._id,
        dueDate: dueDate || undefined,
        priority,
      })
      onClose()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Modal open title={`New task for ${user.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Follow up with Ahmed Nasser" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Optional details" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-between pt-4 border-t gap-3">
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create task'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user: me } = useAuth()
  const qc = useQueryClient()

  const [modalUser, setModalUser]       = useState<AppUser | null | 'new'>()
  const [showChangePw, setShowChangePw] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null)
  const [targetsUser, setTargetsUser]   = useState<AppUser | null>(null)
  const [taskUser, setTaskUser]         = useState<AppUser | null>(null)

  const { data: users, isLoading } = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  })

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setDeleteTarget(null) },
  })

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Add team members and control their module access"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowChangePw(true)}>
              <KeyRound size={13} /> Change my password
            </Button>
            <Button size="sm" onClick={() => setModalUser('new')}>
              <Plus size={13} /> Add user
            </Button>
          </div>
        }
      />

      {/* My profile card */}
      <Card className="mb-4">
        <CardHeader title="My account" subtitle="Your current session and access level" />
        <div className="px-4 pb-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User size={22} className="text-primary" />
          </div>
          <div>
            <div className="font-semibold">{me?.name}</div>
            <div className="text-sm text-muted-foreground">{me?.email}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold
                ${me?.role === 'admin' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' : isSalesRepRole(me?.role) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                {me?.role === 'admin' ? '👑 Admin' : me?.role === 'accounts' ? '🧾 Accounts' : me?.role === 'sales_rep' ? '🎯 Sales Rep' : '👤 Staff'}
              </span>
              {me?.role === 'admin'
                ? <span className="text-xs text-muted-foreground">Full access to all modules</span>
                : isSalesRepRole(me?.role)
                ? <span className="text-xs text-muted-foreground">My Leads board only</span>
                : <span className="text-xs text-muted-foreground">{me?.permissions?.length ?? 0} module{me?.permissions?.length !== 1 ? 's' : ''} assigned</span>
              }
            </div>
          </div>
        </div>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader
          title={`Team members (${users?.length ?? 0})`}
          subtitle="Manage accounts and module permissions"
        />

        {isLoading ? <Spinner /> : (users ?? []).length === 0 ? (
          <EmptyState message="No users yet. Add the first team member." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Module access</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map(u => {
                const isMe = u._id === me?.id
                const moduleCount = u.permissions?.length ?? 0
                return (
                  <tr key={u._id} className="hover:bg-muted/50">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-bold text-muted-foreground">
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-sm">
                            {u.name} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className={`flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5 w-fit
                        ${u.role === 'admin' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' : isSalesRepRole(u.role) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                        {u.role === 'admin' ? <ShieldCheck size={11} /> : <UserCog size={11} />}
                        {roleLabel(u.role)}
                      </span>
                    </Td>
                    <Td>
                      {u.role === 'admin' && moduleCount === 0 ? (
                        <span className="text-xs text-muted-foreground italic">All modules</span>
                      ) : isSalesRepRole(u.role) ? (
                        <span className="text-xs text-muted-foreground italic">My Leads board only</span>
                      ) : moduleCount === 0 ? (
                        <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <ShieldOff size={12} /> No access
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {u.permissions.slice(0, 4).map(p => (
                            <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                              {MODULE_GROUPS.flatMap(g => g.modules).find(m => m.key === p)?.label ?? p}
                            </span>
                          ))}
                          {moduleCount > 4 && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              +{moduleCount - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={u.isActive ? 'green' : 'red'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-1 justify-end">
                        {isSalesRepRole(u.role) && (
                          <>
                            <Button size="sm" variant="ghost" title="Set targets" onClick={() => setTargetsUser(u)}>
                              <Target size={13} />
                            </Button>
                            <Button size="sm" variant="ghost" title="Assign a task" onClick={() => setTaskUser(u)}>
                              <ListTodo size={13} />
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setModalUser(u)}>
                          <Edit2 size={13} />
                        </Button>
                        {!isMe && (
                          <Button size="sm" variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(u)}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Add/Edit modal */}
      {modalUser && (
        <UserModal
          editing={modalUser === 'new' ? null : modalUser}
          onClose={() => setModalUser(undefined)}
          onDone={() => setModalUser(undefined)}
        />
      )}

      {/* Change password modal */}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      {/* Sales rep: targets + new task */}
      {targetsUser && <TargetsModal user={targetsUser} onClose={() => setTargetsUser(null)} />}
      {taskUser && <NewTaskModal user={taskUser} onClose={() => setTaskUser(null)} />}

      {/* Delete confirm */}
      {deleteTarget && (
        <Modal open title="Delete user" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong className="text-foreground">{deleteTarget.name}</strong>?
            This cannot be undone.
          </p>
          {deleteUser.error && (
            <p className="mt-2 text-xs text-destructive">{apiError(deleteUser.error)}</p>
          )}
          <div className="flex gap-2 ml-auto mt-5 pt-4 border-t justify-end">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => deleteUser.mutate(deleteTarget._id)}
              disabled={deleteUser.isPending}>
              {deleteUser.isPending ? 'Deleting…' : 'Delete user'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
