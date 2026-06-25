import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Box, Users, FileText, CreditCard, BarChart3, Building2, CalendarClock, CalendarOff, AlertTriangle, Clock, ChevronDown, FolderOpen, Settings, LogOut, Moon, Sun, UserPlus, ReceiptText, FileSpreadsheet, Truck, ShoppingCart, Wallet, TrendingUp, UserCheck, UserCog, X, MessageCircle, Package, CalendarDays, ClipboardList, Users2, Menu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { cn } from '../lib/utils'
import { integrationApi } from '../lib/api'

const navTop = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' as string | undefined },
]

const navGroups = [
  {
    title: 'Inventory',
    items: [
      { to: '/units',      label: 'Units',     icon: Box,        perm: 'units' },
      { to: '/contracts',  label: 'Contracts', icon: FileText,   perm: 'contracts' },
      { to: '/documents',  label: 'Documents', icon: FolderOpen, perm: 'documents' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/customers', label: 'Customers', icon: Users,         perm: 'customers' },
      { to: '/invoices',  label: 'Invoices',  icon: ReceiptText,   perm: 'invoices' },
      { to: '/whatsapp',  label: 'WhatsApp',  icon: MessageCircle, perm: undefined },
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
  { to: '/reports/monthly',   label: 'Monthly Payments',   icon: CalendarClock,  perm: 'reports_monthly' },
  { to: '/reports/units',     label: 'Unit Revenue',       icon: Building2,      perm: 'reports_units' },
  { to: '/reports/finances',  label: 'Finances',           icon: Wallet,         perm: 'reports_finances' },
  { to: '/reports/forecast',  label: 'Forecast',           icon: TrendingUp,     perm: 'reports_forecast' },
  { to: '/reports/contracts', label: 'Contracts',          icon: BarChart3,      perm: 'reports_contracts' },
  { to: '/reports/vacancies', label: 'Upcoming Vacancies', icon: CalendarOff,    perm: 'reports_vacancies' },
  { to: '/reports/overdue',   label: 'Overdue Payments',   icon: AlertTriangle,  perm: 'reports_overdue' },
  { to: '/reports/expiring',  label: 'Expiring Contracts', icon: Clock,          perm: 'reports_expiring' },
]

const navBottom = [
  { to: '/leads',     label: 'Leads',     icon: UserPlus,    perm: 'leads' as string | undefined },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart, perm: 'purchases' },
  { to: '/payments',  label: 'Payments',  icon: CreditCard,  perm: 'payments' },
  { to: '/settings',  label: 'Settings',  icon: Settings,    perm: 'settings' },
]

const movingNavItems = [
  { to: '/moving',          label: 'Dashboard', icon: LayoutDashboard, perm: 'moving_dashboard' as string },
  { to: '/moving/leads',    label: 'Leads',     icon: UserPlus,        perm: 'moving_leads' },
  { to: '/moving/jobs',     label: 'Jobs',      icon: ClipboardList,   perm: 'moving_jobs' },
  { to: '/moving/schedule', label: 'Schedule',  icon: CalendarDays,    perm: 'moving_schedule' },
  { to: '/moving/dispatch', label: 'Dispatch',  icon: Package,         perm: 'moving_dispatch' },
  { to: '/moving/workers',  label: 'Workers',   icon: Users2,          perm: 'moving_workers' },
  { to: '/moving/fleet',    label: 'Fleet',     icon: Truck,           perm: 'moving_fleet' },
  { to: '/moving/quotes',   label: 'Quotes',    icon: FileSpreadsheet, perm: 'moving_quotes' },
  { to: '/moving/invoices', label: 'Invoices',  icon: ReceiptText,     perm: 'moving_invoices' },
]

const movingReportItems = [
  { to: '/moving/reports/revenue', label: 'Revenue', icon: Wallet,    perm: 'reports_moving_revenue' },
  { to: '/moving/reports/jobs',    label: 'Jobs',    icon: BarChart3, perm: 'reports_moving_jobs' },
  { to: '/moving/reports/crew',    label: 'Crew',    icon: Users,     perm: 'reports_moving_crew' },
  { to: '/moving/reports/fleet',   label: 'Fleet',   icon: Truck,     perm: 'reports_moving_fleet' },
]

const navLinkCls = (isActive: boolean) => cn(
  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
  isActive
    ? 'bg-[#FFF799] text-[#111218] font-semibold shadow-sm'
    : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
)

const subLinkCls = (isActive: boolean) => cn(
  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-150',
  isActive
    ? 'bg-[#FFF799] text-[#111218] font-semibold'
    : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
)

export default function Layout() {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onReportsRoute = location.pathname.startsWith('/reports')
  const onMovingRoute  = location.pathname.startsWith('/moving')
  const [reportsOpen,       setReportsOpen]       = useState(onReportsRoute)
  const [movingOpen,        setMovingOpen]         = useState(onMovingRoute)
  const [movingReportsOpen, setMovingReportsOpen]  = useState(location.pathname.startsWith('/moving/reports'))
  const [dark,              setDark]               = useState(() => localStorage.getItem('pb_theme') === 'dark')
  const [sidebarOpen,       setSidebarOpen]        = useState(false)
  const isAdmin = user?.role === 'admin'
  const [contactsToast, setContactsToast] = useState<{ created: number } | null>(null)
  const lastSeenAt = useRef<string | null>(null)

  // Close sidebar on route change (mobile)
  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await integrationApi.lastSync()
        if (data?.at && data.created > 0 && data.at !== lastSeenAt.current) {
          lastSeenAt.current = data.at
          setContactsToast({ created: data.created })
        }
      } catch { /* silent */ }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pb_theme', dark ? 'dark' : 'light')
  }, [dark])

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0">
        <div className="h-9 w-9 rounded-xl bg-[#FFF799] flex items-center justify-center shrink-0 shadow">
          <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-7 w-7 object-contain" />
        </div>
        <div>
          <div className="font-bold text-sm text-sidebar-foreground leading-tight">PurpleBox</div>
          <div className="text-[10px] text-sidebar-muted leading-tight">Unit Rental Manager</div>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="ml-auto md:hidden text-sidebar-muted hover:text-sidebar-foreground cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {navTop.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => navLinkCls(isActive)}>
            <Icon size={15} />{label}
          </NavLink>
        ))}

        {navGroups.map((group) => {
          const visibleItems = group.items.filter(({ perm }) => !perm || hasPermission(perm))
          if (visibleItems.length === 0) return null
          return (
            <div key={group.title} className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">
                {group.title}
              </div>
              {visibleItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => navLinkCls(isActive)}>
                  <Icon size={15} />{label}
                </NavLink>
              ))}
            </div>
          )
        })}

        {/* Reports */}
        {(() => {
          const visibleReports = reportItems.filter(({ perm }) => hasPermission(perm))
          if (visibleReports.length === 0) return null
          return (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">Reports</div>
              <button
                onClick={() => setReportsOpen(o => !o)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all cursor-pointer',
                  onReportsRoute ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
                )}
              >
                <BarChart3 size={15} />
                <span className="flex-1 text-left">Reports</span>
                <ChevronDown size={13} className={cn('transition-transform duration-200', reportsOpen ? 'rotate-180' : '')} />
              </button>
              {reportsOpen && (
                <div className="ml-2.5 mt-0.5 border-l-2 border-[#467235]/40 pl-2 space-y-0.5">
                  {visibleReports.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={({ isActive }) => subLinkCls(isActive)}>
                      <Icon size={13} />{label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {navBottom.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => navLinkCls(isActive)}>
            <Icon size={15} />{label}
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink to="/users" className={({ isActive }) => navLinkCls(isActive)}>
            <UserCog size={15} />Users
          </NavLink>
        )}

        {/* Moving Business */}
        {(() => {
          const visibleMoving        = movingNavItems.filter(({ perm }) => hasPermission(perm))
          const visibleMovingReports = movingReportItems.filter(({ perm }) => hasPermission(perm))
          if (visibleMoving.length === 0 && visibleMovingReports.length === 0) return null
          return (
            <div className="pt-3">
              <div className="mb-2 border-t border-white/10" />
              <button
                onClick={() => setMovingOpen(o => !o)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all cursor-pointer',
                  onMovingRoute ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
                )}
              >
                <Truck size={15} />
                <span className="flex-1 text-left">Moving</span>
                <ChevronDown size={13} className={cn('transition-transform duration-200', movingOpen ? 'rotate-180' : '')} />
              </button>
              {movingOpen && (
                <div className="space-y-0.5">
                  {visibleMoving.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} end={to === '/moving'}
                      className={({ isActive }) => navLinkCls(isActive)}>
                      <Icon size={15} />{label}
                    </NavLink>
                  ))}
                  {visibleMovingReports.length > 0 && (
                    <>
                      <button
                        onClick={() => setMovingReportsOpen(o => !o)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all cursor-pointer',
                          location.pathname.startsWith('/moving/reports') ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
                        )}
                      >
                        <BarChart3 size={15} />
                        <span className="flex-1 text-left">Reports</span>
                        <ChevronDown size={13} className={cn('transition-transform duration-200', movingReportsOpen ? 'rotate-180' : '')} />
                      </button>
                      {movingReportsOpen && (
                        <div className="ml-2.5 mt-0.5 border-l-2 border-[#467235]/40 pl-2 space-y-0.5">
                          {visibleMovingReports.map(({ to, label, icon: Icon }) => (
                            <NavLink key={to} to={to} className={({ isActive }) => subLinkCls(isActive)}>
                              <Icon size={13} />{label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 p-3 space-y-2">
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/5">
          <div className="h-7 w-7 rounded-full bg-[#4C8CE4] flex items-center justify-center text-white text-xs font-bold shrink-0">
            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</div>
            <div className="text-[10px] text-sidebar-muted truncate">{user?.email}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setDark(!dark)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground cursor-pointer transition-colors"
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
            {dark ? 'Light' : 'Dark'}
          </button>
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground cursor-pointer transition-colors"
          >
            <LogOut size={13} />Logout
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-background">

      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-56 bg-sidebar text-sidebar-foreground flex-col z-30 shadow-xl">
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar drawer ───────────────────────────────── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative w-64 max-w-[80vw] bg-sidebar text-sidebar-foreground flex flex-col h-full shadow-2xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Mobile top bar ──────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 h-14 bg-sidebar text-sidebar-foreground flex items-center gap-3 px-4 shadow-lg">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-sidebar-muted hover:text-sidebar-foreground cursor-pointer p-1 -ml-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <div className="h-7 w-7 rounded-lg bg-[#FFF799] flex items-center justify-center shrink-0">
            <img src="/Invoicelogo_Logo.png" alt="" className="h-5 w-5 object-contain" />
          </div>
          <span className="font-bold text-sm text-sidebar-foreground">PurpleBox</span>
        </div>
        <button
          onClick={() => setDark(!dark)}
          className="text-sidebar-muted hover:text-sidebar-foreground cursor-pointer p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 min-w-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
          {contactsToast && (
            <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 px-4 py-3 shadow-xl text-sm text-emerald-800 dark:text-emerald-300 max-w-sm">
              <UserCheck size={16} className="shrink-0" />
              <span className="flex-1">
                <strong>{contactsToast.created} new contact{contactsToast.created > 1 ? 's' : ''}</strong> synced from Google Contacts.
              </span>
              <button onClick={() => setContactsToast(null)} className="shrink-0 text-emerald-600 hover:text-emerald-800 cursor-pointer">
                <X size={14} />
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  )
}
