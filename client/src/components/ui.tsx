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
    <div className="flex items-center justify-between px-5 pt-4 pb-3 gap-3">
      <div className="flex-1">
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative w-full bg-card shadow-2xl max-h-[92vh] overflow-y-auto',
        'rounded-t-2xl sm:rounded-xl border',
        className || (wide ? 'sm:max-w-2xl' : 'sm:max-w-md')
      )}>
        <div className="flex items-center justify-between border-b px-5 py-3.5 sticky top-0 bg-card z-10">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer p-1 rounded-lg hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
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
    <th className={cn('text-left text-xs font-semibold text-muted-foreground px-4 py-2.5 border-b bg-muted/50 first:rounded-tl-lg last:rounded-tr-lg whitespace-nowrap', className)} {...props}>
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

export function Pagination({
  page, pages, total, limit, onPage, onLimit,
}: {
  page: number; pages: number; total: number; limit: number
  onPage: (p: number) => void; onLimit?: (l: number) => void
}) {
  if (pages <= 0) return null
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t text-sm">
      <span className="text-muted-foreground text-xs">
        {total === 0 ? 'No results' : `${from}–${to} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        {onLimit && (
          <select
            value={limit}
            onChange={e => onLimit(Number(e.target.value))}
            className="h-7 rounded border border-border bg-background px-1.5 text-xs focus:outline-none"
          >
            {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button
          onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="h-7 w-7 rounded border border-border bg-background text-xs disabled:opacity-40 hover:bg-muted transition-colors"
        >‹</button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === pages || Math.abs(p - page) <= 1)
          .reduce<(number | '…')[]>((acc, p, i, arr) => {
            if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…')
            acc.push(p); return acc
          }, [])
          .map((p, i) =>
            p === '…'
              ? <span key={`e${i}`} className="px-1 text-muted-foreground text-xs">…</span>
              : <button key={p} onClick={() => onPage(p as number)}
                  className={`h-7 w-7 rounded border text-xs transition-colors ${
                    p === page
                      ? 'border-primary bg-primary text-primary-foreground font-medium'
                      : 'border-border bg-background hover:bg-muted'
                  }`}>{p}</button>
          )
        }
        <button
          onClick={() => onPage(page + 1)} disabled={page >= pages}
          className="h-7 w-7 rounded border border-border bg-background text-xs disabled:opacity-40 hover:bg-muted transition-colors"
        >›</button>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ---------- Breadcrumb ---------- */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          {idx > 0 && <span className="text-muted-foreground/50">/</span>}
          {item.href ? (
            <a href={item.href} className="hover:text-foreground transition-colors">{item.label}</a>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  )
}

/* ---------- Section Header ---------- */
export function SectionHeader({ icon: Icon, title, subtitle, action }: {
  icon?: React.ElementType
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div className="flex items-center gap-3">
        {Icon && <Icon size={22} className="text-primary" />}
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ---------- Status Badge with Icon ---------- */
export function StatusBadge({
  label,
  tone,
  icon: Icon
}: {
  label: string
  tone: string
  icon?: React.ElementType
}) {
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
      badgeTones[tone] || badgeTones.gray
    )}>
      {Icon && <Icon size={14} />}
      {label}
    </div>
  )
}

/* ---------- Info Grid ---------- */
export function InfoGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return (
    <dl className={cn('grid gap-6', {
      'grid-cols-1': cols === 1,
      'grid-cols-2': cols === 2,
      'grid-cols-3': cols === 3,
      'grid-cols-4': cols === 4,
    })}>
      {children}
    </dl>
  )
}

export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}
