import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/utils'
import { Button } from './ui'

export interface FlowStep {
  key: string
  label: string
  /** done = completed, current = in progress, blocked = rejected/failed, upcoming = not reached */
  state: 'done' | 'current' | 'blocked' | 'upcoming'
  detail?: string
  to?: string
}

export interface FlowStepAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'outline' | 'success' | 'destructive'
  disabled?: boolean
}

export interface FlowStepDetail extends FlowStep {
  /** Extra info lines shown under the step label */
  lines?: string[]
  /** Inline action buttons for this step */
  actions?: FlowStepAction[]
}

const dotStyles = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-primary bg-primary/10 text-primary',
  blocked: 'border-red-500 bg-red-500 text-white',
  upcoming: 'border-muted-foreground/30 text-muted-foreground/50',
} as const

const labelStyles = {
  done: 'text-emerald-600 dark:text-emerald-400',
  current: 'text-primary',
  blocked: 'text-red-600 dark:text-red-400',
  upcoming: 'text-muted-foreground/60',
} as const

/**
 * Vertical rental-flow board — every step on one page with details and inline actions.
 * Lead → Quote → Contract → Invoice → Payment → Approval → Booked
 */
export function RentalFlowBoard({ steps }: { steps: FlowStepDetail[] }) {
  return (
    <div>
      {steps.map((s, i) => (
        <div key={s.key} className="flex gap-3">
          {/* Rail */}
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                dotStyles[s.state]
              )}
            >
              {s.state === 'done' ? <Check size={14} strokeWidth={3} /> : s.state === 'blocked' ? <X size={14} strokeWidth={3} /> : i + 1}
            </span>
            {i < steps.length - 1 && (
              <span className={cn('w-0.5 flex-1 my-1 rounded', s.state === 'done' ? 'bg-emerald-400' : 'bg-muted-foreground/20')} />
            )}
          </div>

          {/* Content */}
          <div className={cn('flex-1 min-w-0', i < steps.length - 1 ? 'pb-4' : 'pb-0.5')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold leading-7', labelStyles[s.state])}>
                  {s.label}
                  {s.detail && <span className="ml-2 text-xs font-medium text-muted-foreground">{s.detail}</span>}
                </p>
                {(s.lines || []).map((line, li) => (
                  <p key={li} className="text-xs text-muted-foreground mt-0.5">{line}</p>
                ))}
              </div>
              {(s.actions || []).length > 0 && (
                <div className="flex flex-wrap gap-2 shrink-0">
                  {(s.actions || []).map((a) => (
                    <Button
                      key={a.label}
                      size="sm"
                      variant={a.variant === 'primary' ? undefined : a.variant ?? 'outline'}
                      disabled={a.disabled}
                      onClick={a.onClick}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Unified rental-flow progress stepper:
 * Lead → Quote → Contract → Invoice → Payment → Approval → Booked
 */
export function RentalFlowStepper({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex items-start min-w-max py-1">
        {steps.map((s, i) => {
          const dot = (
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors',
                s.state === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
                s.state === 'current' && 'border-primary bg-primary/10 text-primary',
                s.state === 'blocked' && 'border-red-500 bg-red-500 text-white',
                s.state === 'upcoming' && 'border-muted-foreground/30 text-muted-foreground/50'
              )}
            >
              {s.state === 'done' ? <Check size={13} strokeWidth={3} /> : s.state === 'blocked' ? <X size={13} strokeWidth={3} /> : i + 1}
            </span>
          )
          const label = (
            <div className="mt-1.5 text-center">
              <p
                className={cn(
                  'text-[11px] font-semibold leading-tight',
                  s.state === 'done' && 'text-emerald-600 dark:text-emerald-400',
                  s.state === 'current' && 'text-primary',
                  s.state === 'blocked' && 'text-red-600 dark:text-red-400',
                  s.state === 'upcoming' && 'text-muted-foreground/60'
                )}
              >
                {s.label}
              </p>
              {s.detail && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 max-w-20 truncate" title={s.detail}>{s.detail}</p>}
            </div>
          )
          return (
            <li key={s.key} className="flex items-start">
              {i > 0 && (
                <span
                  className={cn(
                    'mt-3 h-0.5 w-6 sm:w-10 shrink-0 rounded',
                    s.state === 'done' || s.state === 'current' || s.state === 'blocked'
                      ? 'bg-emerald-400'
                      : 'bg-muted-foreground/20'
                  )}
                />
              )}
              <div className="flex flex-col items-center w-16 sm:w-20">
                {s.to ? (
                  <Link to={s.to} className="flex flex-col items-center hover:opacity-80 transition-opacity cursor-pointer">
                    {dot}
                    {label}
                  </Link>
                ) : (
                  <div className="flex flex-col items-center">
                    {dot}
                    {label}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
