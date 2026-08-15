import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Target as TargetIcon, UserX } from 'lucide-react'
import { api } from '../lib/api'
import { PageHeader, Spinner, Card, CardHeader } from '../components/ui'
import { formatMoney, formatDate } from '../lib/utils'
import { ProgressBar, groupTasksByDue, type TaskItem } from './SalesBoard'
import { TargetsModal, type AppUser } from './UserManagement'

interface RepRow {
  user: { _id: string; name: string; email: string }
  targets: { weekly: { units: number; moving: number }; monthly: { units: number; moving: number } }
  actual: { weekly: { units: number; moving: number }; monthly: { units: number; moving: number } }
  revenue: { weekly: number; monthly: number }
  openTasks: number
  overdueTasks: number
}
interface StaleLead { id: string; type: 'storage' | 'moving'; name: string; owner: string; daysStale: number }
interface UnassignedLead { id: string; name: string; createdAt: string }
interface SalesTeamData {
  reps: RepRow[]
  staleLeads: StaleLead[]
  unassignedMovingLeads: UnassignedLead[]
}

export default function SalesTeam() {
  const qc = useQueryClient()
  const [targetsUser, setTargetsUser] = useState<AppUser | null>(null)

  const { data, isLoading } = useQuery<SalesTeamData>({
    queryKey: ['sales-team'],
    queryFn: () => api.get('/sales-team').then((r) => r.data),
  })

  const { data: allTasks = [] } = useQuery<TaskItem[]>({
    queryKey: ['all-tasks'],
    queryFn: () => api.get('/tasks', { params: { status: 'todo,in_progress' } }).then((r) => r.data),
  })

  if (isLoading || !data) return <Spinner />

  const taskGroups = groupTasksByDue(allTasks)

  return (
    <div className="space-y-5">
      <PageHeader title="Sales Team" subtitle="Every rep's targets, pipeline health, and open work in one place" />

      {/* Alerts */}
      {(data.staleLeads.length > 0 || data.unassignedMovingLeads.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.staleLeads.length > 0 && (
            <Card>
              <CardHeader title={`Stale leads (${data.staleLeads.length})`} subtitle='Still "New" after 1+ day' />
              <div className="px-4 pb-4 space-y-2">
                {data.staleLeads.slice(0, 8).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                      <span className="truncate">{l.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">({l.type === 'storage' ? 'Storage' : 'Moving'})</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                      <span>{l.owner}</span>
                      <span className="font-semibold text-amber-700 dark:text-amber-400">{l.daysStale}d</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {data.unassignedMovingLeads.length > 0 && (
            <Card>
              <CardHeader title={`Unassigned moving leads (${data.unassignedMovingLeads.length})`} subtitle="Nobody owns these yet" />
              <div className="px-4 pb-4 space-y-2">
                {data.unassignedMovingLeads.slice(0, 8).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserX size={13} className="text-destructive shrink-0" />
                      <span className="truncate">{l.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(l.createdAt)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Team table */}
      <Card>
        <CardHeader title="Team performance" subtitle={`${data.reps.length} sales rep${data.reps.length !== 1 ? 's' : ''}`} />
        {data.reps.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">No sales reps yet — onboard one from User Management.</p>
        ) : (
          <div className="px-4 pb-4 space-y-4">
            {data.reps.map((r) => (
              <div key={r.user._id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-sm">{r.user.name}</div>
                    <div className="text-xs text-muted-foreground">{r.user.email}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs">
                      <div className={r.overdueTasks > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                        {r.openTasks} open{r.overdueTasks > 0 ? ` · ${r.overdueTasks} overdue` : ''} task{r.openTasks !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTargetsUser({ _id: r.user._id, name: r.user.name, email: r.user.email, role: 'sales_rep', permissions: ['sales_board'], isActive: true, createdAt: '' })}
                      className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                    >
                      <TargetIcon size={12} /> Edit targets
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">This week</div>
                    <div className="text-xs text-muted-foreground mb-0.5">Units leased</div>
                    <ProgressBar actual={r.actual.weekly.units} target={r.targets.weekly.units} />
                    <div className="text-xs text-muted-foreground mb-0.5">Moving booked</div>
                    <ProgressBar actual={r.actual.weekly.moving} target={r.targets.weekly.moving} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">This month</div>
                    <div className="text-xs text-muted-foreground mb-0.5">Units leased</div>
                    <ProgressBar actual={r.actual.monthly.units} target={r.targets.monthly.units} />
                    <div className="text-xs text-muted-foreground mb-0.5">Moving booked</div>
                    <ProgressBar actual={r.actual.monthly.moving} target={r.targets.monthly.moving} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Revenue</div>
                    <div className="text-sm"><span className="text-muted-foreground">This week: </span><span className="font-semibold">{formatMoney(r.revenue.weekly)}</span></div>
                    <div className="text-sm mt-1"><span className="text-muted-foreground">This month: </span><span className="font-semibold">{formatMoney(r.revenue.monthly)}</span></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Task oversight */}
      <Card>
        <CardHeader title="Open tasks across the team" subtitle={`${allTasks.length} open`} />
        {taskGroups.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">No open tasks anywhere. Team's clear.</p>
        ) : (
          <div className="px-4 pb-4 space-y-4">
            {taskGroups.map((g) => (
              <div key={g.label}>
                <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${g.tone === 'overdue' ? 'text-destructive' : g.tone === 'today' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                  {g.label} ({g.items.length})
                </div>
                <div className="space-y-1.5">
                  {g.items.map((t) => (
                    <div key={t._id} className="flex items-center justify-between gap-3 text-sm border-b pb-1.5">
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className="font-medium text-xs text-muted-foreground shrink-0">{t.assignedTo?.name || '—'}</span>
                        <span className="truncate">{t.title}</span>
                      </div>
                      {t.dueDate && <span className="text-xs text-muted-foreground shrink-0">{formatDate(t.dueDate)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {targetsUser && (
        <TargetsModal
          user={targetsUser}
          onClose={() => { setTargetsUser(null); qc.invalidateQueries({ queryKey: ['sales-team'] }) }}
        />
      )}
    </div>
  )
}
