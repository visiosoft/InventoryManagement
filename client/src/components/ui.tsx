import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TdHTMLAttributes,
  type TextareaHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

/* ---------- Button ---------- */
type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border bg-card hover:bg-muted',
  ghost: 'hover:bg-muted',
  destructive: 'bg-destructive text-white hover:opacity-90',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
}
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-6 text-sm',
  icon: 'h-9 w-9',
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(({ className, variant = 'default', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors cursor-pointer',
      'focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
      buttonVariants[variant],
      buttonSizes[size],
      className
    )}
    {...props}
  />
))
Button.displayName = 'Button'

/* ---------- Inputs ---------- */
const fieldClass =
  'w-full h-9 rounded-lg border bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldClass, className)} {...props} />
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldClass, 'h-auto min-h-20 py-2', className)} {...props} />
  )
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldClass, className)} {...props} />
)
Select.displayName = 'Select'

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn('block text-xs font-medium text-muted-foreground mb-1.5', className)}>{children}</label>
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/* ---------- Card ---------- */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>{children}</div>
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-2">
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 pb-4', className)}>{children}</div>
}

/* ---------- Badge ---------- */
const badgeTones: Record<string, string> = {
  gray: 'bg-muted text-muted-foreground',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-red-500/15 text-red-700 dark:text-red-400',
  purple: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
}

export function Badge({ children, tone = 'gray', className }: { children: ReactNode; tone?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', badgeTones[tone] || badgeTones.gray, className)}>
      {children}
    </span>
  )
}

export const unitStatusTone: Record<string, string> = {
  available: 'green',
  occupied: 'blue',
  reserved: 'amber',
  maintenance: 'gray',
}

export const contractStatusTone: Record<string, string> = {
  draft: 'gray',
  pending_signature: 'amber',
  active: 'green',
  ended: 'blue',
  cancelled: 'red',
}

export const paymentStatusTone: Record<string, string> = {
  pending: 'amber',
  paid: 'green',
  overdue: 'red',
}

export const leadStatusTone: Record<string, string> = {
  new: 'blue',
  contacted: 'amber',
  qualified: 'purple',
  proposal_sent: 'gray',
  won: 'green',
  lost: 'red',
}

export function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={cn('relative w-full rounded-xl border bg-card shadow-xl max-h-[90vh] overflow-y-auto', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Table ---------- */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)}>{children}</table>
    </div>
  )
}

export function Th({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('text-left text-xs font-medium text-muted-foreground px-4 py-2.5 border-b', className)} {...props}>
      {children}
    </th>
  )
}

export function Td({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-2.5 border-b border-border/60', className)} {...props}>
      {children}
    </td>
  )
}

/* ---------- Corner Ribbon ---------- */
const ribbonColors = {
  amber: '#D97706',
  green: '#059669',
  red: '#DC2626',
}

export function CornerRibbon({
  label,
  color,
  size = 'md',
}: {
  label: string
  color: 'amber' | 'green' | 'red'
  size?: 'sm' | 'md'
}) {
  const sm = { box: 52, strip: 68, right: -18, top: 11, fontSize: 9, py: 2 }
  const md = { box: 76, strip: 100, right: -26, top: 17, fontSize: 11, py: 3 }
  const d = size === 'sm' ? sm : md
  return (
    <div
      className="absolute top-0 right-0 overflow-hidden pointer-events-none z-10"
      style={{ width: d.box, height: d.box }}
    >
      <div
        className="absolute text-white font-bold text-center tracking-wide"
        style={{
          width: d.strip,
          right: d.right,
          top: d.top,
          fontSize: d.fontSize,
          paddingTop: d.py,
          paddingBottom: d.py,
          transform: 'rotate(45deg)',
          background: ribbonColors[color],
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        }}
      >
        {label}
      </div>
    </div>
  )
}

/* ---------- Misc ---------- */
export function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-sm text-muted-foreground">{message}</div>
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
