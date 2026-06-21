import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Box, Users, FileText, CreditCard, BarChart3, Building2, CalendarClock, CalendarOff, AlertTriangle, Clock, ChevronDown, FolderOpen, Settings, LogOut, Moon, Sun, UserPlus, ReceiptText, FileSpreadsheet, Truck, ShoppingCart, Wallet, PackageOpen, TrendingUp, UserCheck, UserCog, X, MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { cn } from '../lib/utils'
import { integrationApi } from '../lib/api'

// ── Nav definitions (perm = module key required; undefined = always visible) ──

const navTop = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' as string | undefined },
]

const navGroups = [
  {
    title: 'Inventory',
    items: [
      { to: '/units',           label: 'Units',       icon: Box,         perm: 'units' },
      { to: '/moving-inventory',label: 'Moving Ops',  icon: PackageOpen, perm: 'moving_inventory' },
      { to: '/contracts',       label: 'Contracts',   icon: FileText,    perm: 'contracts' },
      { to: '/documents',       label: 'Documents',   icon: FolderOpen,  perm: 'documents' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/customers', label: 'Customers', icon: Users,          perm: 'customers' },
      { to: '/quotes',    label: 'Quotes',    icon: FileSpreadsheet, perm: 'quotes' },
      { to: '/invoices',  label: 'Invoices',  icon: ReceiptText,    perm: 'invoices' },
      { to: '/whatsapp',  label: 'WhatsApp',  icon: MessageCircle,  perm: undefined },
    ],
  },
  {
    title: 'Purchases',
    items: [
      { to: '/vendors',  label: 'Vendors',  icon: Truck,  perm: 'vendors' },
      { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'expenses' },
    ],
  },
]

const reportItems = [
  { to: '/reports/monthly',   label: 'Monthly Payments',    icon: CalendarClock, perm: 'reports_monthly' },
  { to: '/reports/units',     label: 'Unit Revenue',        icon: Building2,     perm: 'reports_units' },
  { to: '/reports/finances',  label: 'Finances',            icon: Wallet,        perm: 'reports_finances' },
  { to: '/reports/forecast',  label: 'Forecast',            icon: TrendingUp,    perm: 'reports_forecast' },
  { to: '/reports/contracts', label: 'Contracts',           icon: BarChart3,     perm: 'reports_contracts' },
  { to: '/reports/vacancies', label: 'Upcoming Vacancies',  icon: CalendarOff,    perm: 'reports_vacancies' },
  { to: '/reports/overdue',   label: 'Overdue Payments',    icon: AlertTriangle,  perm: 'reports_overdue' },
  { to: '/reports/expiring',  label: 'Expiring Contracts',  icon: Clock,          perm: 'reports_expiring' },
]

const navBottom = [
  { to: '/leads',     label: 'Leads',     icon: UserPlus,  perm: 'leads' as string | undefined },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart, perm: 'purchases' },
  { to: '/payments',  label: 'Payments',  icon: CreditCard, perm: 'payments' },
  { to: '/settings',  label: 'Settings',  icon: Settings,  perm: 'settings' },
]

export default function Layout() {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onReportsRoute = location.pathname.startsWith('/reports')
  const [reportsOpen, setReportsOpen] = useState(onReportsRoute)
  const [dark, setDark] = useState(() => localStorage.getItem('pb_theme') === 'dark')
  const isAdmin = user?.role === 'admin'
  const [contactsToast, setContactsToast] = useState<{ created: number } | null>(null)
  const lastSeenAt = useRef<string | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await integrationApi.lastSync()
        if (data?.at && data.created > 0 && data.at !== lastSeenAt.current) {
          lastSeenAt.current = data.at
          setContactsToast({ created: data.created })
        }
      } catch { /* silent — not critical */ }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pb_theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 w-56 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="flex items-center gap-2.5 px-5 h-16">
          <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-9 w-9 rounded-lg object-contain bg-white p-1" />
          <div>
            <div className="font-bold text-sm leading-tight">PurpleBox</div>
            <div className="text-[10px] text-sidebar-muted leading-tight">Unit Rental Manager</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {navTop.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
              )}>
              <Icon size={16} />{label}
            </NavLink>
          ))}

          {navGroups.map((group) => {
            const visibleItems = group.items.filter(({ perm }) => !perm || hasPermission(perm))
            if (visibleItems.length === 0) return null
            return (
              <div key={group.title} className="pt-2">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">{group.title}</div>
                {visibleItems.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                      isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                    )}>
                    <Icon size={16} />{label}
                  </NavLink>
                ))}
              </div>
            )
          })}

          {/* ── Reports expandable group ── */}
          {(() => {
            const visibleReports = reportItems.filter(({ perm }) => hasPermission(perm))
            if (visibleReports.length === 0) return null
            return (
              <div className="pt-2">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">Reports</div>
                <button
                  onClick={() => setReportsOpen(o => !o)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer',
                    onReportsRoute ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                  )}
                >
                  <BarChart3 size={16} />
                  <span className="flex-1 text-left">Reports</span>
                  <ChevronDown size={13} className={cn('transition-transform duration-200', reportsOpen ? 'rotate-180' : '')} />
                </button>

                {reportsOpen && (
                  <div className="ml-3 mt-0.5 border-l border-white/10 pl-2 space-y-0.5">
                    {visibleReports.map(({ to, label, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                            isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                          )
                        }
                      >
                        <Icon size={13} />
                        {label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {navBottom.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
              )}>
              <Icon size={16} />{label}
            </NavLink>
          ))}

          {/* Users — admin only */}
          {isAdmin && (
            <NavLink to="/users"
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
              )}>
              <UserCog size={16} />Users
            </NavLink>
          )}
        </nav>
        <div className="border-t border-white/10 p-3 space-y-1">
          <div className="px-3 py-1">
            <div className="text-xs font-medium">{user?.name}</div>
            <div className="text-[10px] text-sidebar-muted">{user?.email}</div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setDark(!dark)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground cursor-pointer"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
              {dark ? 'Light' : 'Dark'}
            </button>
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground cursor-pointer"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      </aside>
      <main className="ml-56 flex-1 p-6 lg:p-8 max-w-[1400px]">
        {contactsToast && (
          <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 px-4 py-3 shadow-lg text-sm text-emerald-800 dark:text-emerald-300 max-w-sm">
            <UserCheck size={16} className="shrink-0" />
            <span className="flex-1">
              <strong>{contactsToast.created} new contact{contactsToast.created > 1 ? 's' : ''}</strong> synced from Google Contacts and added to Leads.
            </span>
            <button onClick={() => setContactsToast(null)} className="shrink-0 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 cursor-pointer">
              <X size={14} />
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
