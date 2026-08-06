import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Box, Users, FileText, BarChart3, Building2, Briefcase, CalendarClock, CalendarOff, AlertTriangle, Clock, ChevronDown, FolderOpen, Settings, LogOut, Moon, Sun, UserPlus, ReceiptText, Truck, Wallet, TrendingUp, UserCog, X, Package, CalendarDays, ClipboardList, Users2, Menu, DatabaseBackup, ShieldCheck, ScrollText, CalendarCheck, RefreshCw, Map as MapIcon, Mail } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { cn } from '../lib/utils'

const navTop = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' as string | undefined },
]

const navGroups = [
  {
    title: 'Inventory',
    items: [
      { to: '/quotes', label: 'Book Unit', icon: FileText, perm: 'quotes' },
      { to: '/units', label: 'Search Units', icon: Box, perm: 'units' },
      { to: '/contracts', label: 'Tenants', icon: Briefcase, perm: 'contracts' },
      { to: '/floor-map', label: 'Floor Map', icon: MapIcon, perm: 'units' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/leads', label: 'Leads', icon: UserPlus, perm: 'leads' },
      { to: '/quotations', label: 'Quotations', icon: ScrollText, perm: 'quotes' },
    ],
  },
]

const profileMenuItems = [
  { to: '/invoices', label: 'Invoices', icon: ReceiptText, perm: 'invoices' },
  { to: '/documents', label: 'Documents', icon: FolderOpen, perm: 'documents' },
  { to: '/customers', label: 'Tenants', icon: Users, perm: 'customers' },
  { to: '/sites', label: 'Sites', icon: Building2, perm: 'units' },
  { to: '/settings/templates', label: 'Message Templates', icon: Mail, perm: 'settings' },
  { to: '/settings/automation', label: 'Automation Rules', icon: RefreshCw, perm: 'settings' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings' },
]

const reportItems = [
  { to: '/reports/monthly', label: 'Monthly Payments', icon: CalendarClock, perm: 'reports_monthly' },
  { to: '/reports/units', label: 'Unit Revenue', icon: Building2, perm: 'reports_units' },
  { to: '/reports/finances', label: 'Finances', icon: Wallet, perm: 'reports_finances' },
  { to: '/reports/forecast', label: 'Forecast', icon: TrendingUp, perm: 'reports_forecast' },
  { to: '/reports/contracts', label: 'Contracts', icon: BarChart3, perm: 'reports_contracts' },
  { to: '/reports/vacancies', label: 'Upcoming Vacancies', icon: CalendarOff, perm: 'reports_vacancies' },
  { to: '/reports/overdue', label: 'Overdue Payments', icon: AlertTriangle, perm: 'reports_overdue' },
  { to: '/reports/expiring', label: 'Expiring Contracts', icon: Clock, perm: 'reports_expiring' },
  { to: '/reports/income', label: 'Income Analysis', icon: TrendingUp, perm: 'reports_finances' },
]

const navBottom: { to: string; label: string; icon: any; perm: string }[] = []

const movingNavItems = [
  { to: '/moving', label: 'Dashboard', icon: LayoutDashboard, perm: 'moving_dashboard' as string },
  { to: '/moving/schedule', label: 'Schedule Jobs', icon: CalendarDays, perm: 'moving_schedule' },
  { to: '/moving/visits', label: 'Site Visits', icon: CalendarCheck, perm: 'moving_jobs' },
  { to: '/moving/jobs', label: 'Jobs List', icon: ClipboardList, perm: 'moving_jobs' },
  { to: '/moving/leads', label: 'Leads', icon: UserPlus, perm: 'moving_leads' },
  { to: '/moving/workers', label: 'Workers', icon: Users2, perm: 'moving_workers' },
  { to: '/moving/fleet', label: 'Fleet', icon: Truck, perm: 'moving_fleet' },
  { to: '/moving-inventory', label: 'Inventory', icon: Box, perm: 'moving_dashboard' },
  { to: '/moving/quotes', label: 'Quotes', icon: ScrollText, perm: 'moving_jobs' },
  { to: '/moving/invoices', label: 'Invoices', icon: ReceiptText, perm: 'moving_invoices' },
  { to: '/moving/dispatch', label: 'Dispatch', icon: Package, perm: 'moving_dispatch' },
  { to: '/moving/claims', label: 'Claims', icon: AlertTriangle, perm: 'moving_dashboard' },
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

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/quotes': 'Book Unit',
  '/units': 'Search Units',
  '/floor-map': 'Floor Map',
  '/sites': 'Sites',
  '/customers': 'Tenants',
  '/leads': 'Leads',
  '/quotations': 'Quotations',
  '/contracts': 'Tenants',
  '/invoices': 'Invoices',
  '/documents': 'Documents',
  '/settings': 'Settings',
  '/approvals': 'Approvals',
  '/users': 'User Management',
  '/backup': 'Backup',
  '/moving': 'Moving Dashboard',
  '/moving/schedule': 'Schedule Jobs',
  '/moving/visits': 'Site Visits',
  '/moving/jobs': 'Jobs List',
  '/moving/jobs/new': 'New Job',
  '/moving/leads': 'Leads',
  '/moving/workers': 'Workers',
  '/moving/fleet': 'Fleet',
  '/moving-inventory': 'Inventory',
  '/moving/quotes': 'Quotes',
  '/moving/invoices': 'Invoices',
  '/moving/dispatch': 'Dispatch',
  '/moving/claims': 'Claims',
  '/moving/reports': 'Reports',
  '/reports/monthly': 'Monthly Payments',
  '/reports/units': 'Unit Revenue',
  '/reports/finances': 'Finances',
  '/reports/forecast': 'Forecast',
  '/reports/contracts': 'Contracts Report',
  '/reports/vacancies': 'Upcoming Vacancies',
  '/reports/overdue': 'Overdue Payments',
  '/reports/expiring': 'Expiring Contracts',
  '/whatsapp': 'WhatsApp',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length >= 2) {
    const parent = '/' + segments.slice(0, 2).join('/')
    if (PAGE_TITLES[parent]) return PAGE_TITLES[parent]
  }
  if (segments.length >= 1) {
    const parent = '/' + segments[0]
    if (PAGE_TITLES[parent]) return PAGE_TITLES[parent]
  }
  return ''
}

export default function Layout() {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onReportsRoute = location.pathname.startsWith('/reports')
  const [reportsOpen, setReportsOpen] = useState(onReportsRoute)
  const [dark, setDark] = useState(() => localStorage.getItem('pb_theme') === 'dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pb_sidebar_collapsed') === 'true')
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const isAdmin = user?.role === 'admin'
  const isMovingOnly = hasPermission('moving_dashboard') && !hasPermission('units') && !hasPermission('dashboard')

  // Site switcher disabled for now — clear any previously selected site
  useEffect(() => { localStorage.removeItem('pb_site_id') }, [])

  // Close sidebar on route change (mobile)
  useEffect(() => { setSidebarOpen(false); setProfileOpen(false) }, [location.pathname])

  // Listen for sidebar collapse events from other components
  useEffect(() => {
    const handler = () => setCollapsed(localStorage.getItem('pb_sidebar_collapsed') === 'true')
    window.addEventListener('sidebar-collapse', handler)
    return () => window.removeEventListener('sidebar-collapse', handler)
  }, [])

  // Close profile dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])


  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pb_theme', dark ? 'dark' : 'light')
  }, [dark])

  const SidebarContent = ({ isCollapsed = false }: { isCollapsed?: boolean } = {}) => (
    <>
      {/* Logo */}
      <div className={cn("flex items-center h-16 border-b border-white/10 shrink-0", isCollapsed ? 'justify-center px-2' : 'gap-3 px-4')}>
        <div className="h-9 w-9 rounded-xl bg-[#FFF799] flex items-center justify-center shrink-0 shadow">
          <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-7 w-7 object-contain" />
        </div>
        {!isCollapsed && (
          <div>
            <div className="font-bold text-sm text-sidebar-foreground leading-tight">PurpleBox</div>
            <div className="text-[10px] text-sidebar-muted leading-tight">Unit Rental Manager</div>
          </div>
        )}
        {/* Close button — mobile only */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="ml-auto md:hidden text-sidebar-muted hover:text-sidebar-foreground cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto py-3 space-y-0.5", isCollapsed ? 'px-1.5' : 'px-2.5')}>
        {!isMovingOnly && navTop.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
            title={isCollapsed ? label : undefined}>
            <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
          </NavLink>
        ))}

        {!isMovingOnly && navGroups.map((group) => {
          const visibleItems = group.items.filter(({ perm }) => !perm || hasPermission(perm))
          if (visibleItems.length === 0) return null
          return (
            <div key={group.title || visibleItems[0]?.to} className="pt-3">
              {group.title && !isCollapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">
                  {group.title}
                </div>
              )}
              {isCollapsed && group.title && <div className="border-t border-white/10 my-1" />}
              {visibleItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
                  title={isCollapsed ? label : undefined}>
                  <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
                </NavLink>
              ))}
            </div>
          )
        })}

        {!isMovingOnly && isAdmin && hasPermission('quotes') && (
          <NavLink to="/approvals"
            className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
            title={isCollapsed ? 'Approvals' : undefined}>
            <ShieldCheck size={isCollapsed ? 18 : 15} />{!isCollapsed && 'Approvals'}
          </NavLink>
        )}

        {/* Reports */}
        {!isMovingOnly && (() => {
          const visibleReports = reportItems.filter(({ perm }) => hasPermission(perm))
          if (visibleReports.length === 0) return null
          if (isCollapsed) {
            return (
              <div className="pt-3">
                <div className="border-t border-white/10 my-1" />
                <NavLink to="/reports/monthly"
                  className={() => cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', onReportsRoute ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8')}
                  title="Reports">
                  <BarChart3 size={18} />
                </NavLink>
              </div>
            )
          }
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

        {!isMovingOnly && navBottom.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
            title={isCollapsed ? label : undefined}>
            <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
          </NavLink>
        ))}


        {/* Moving Business */}
        {(() => {
          const visibleMoving = movingNavItems.filter(({ perm }) => hasPermission(perm))
          if (visibleMoving.length === 0) return null
          return (
            <div className="pt-3">
              {isCollapsed ? <div className="border-t border-white/10 my-1" /> : <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">Moving</div>}
              <div className="space-y-0.5">
                {visibleMoving.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} end={to === '/moving'}
                    className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
                    title={isCollapsed ? label : undefined}>
                    <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })()}
      </nav>

      {/* Footer */}
      <div className={cn("shrink-0 border-t border-white/10 space-y-2", isCollapsed ? 'p-1.5' : 'p-3')}>
        <div className={cn("flex items-center rounded-lg bg-white/5", isCollapsed ? 'justify-center p-1.5' : 'gap-2.5 px-3 py-1.5')}>
          <div className="h-7 w-7 rounded-full bg-[#5B2BC9] flex items-center justify-center text-white text-xs font-bold shrink-0">
            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</div>
              <div className="text-[10px] text-sidebar-muted truncate">{user?.email}</div>
            </div>
          )}
        </div>
        {/* Dark/Logout visible on mobile only — desktop uses profile dropdown */}
        <div className="flex gap-1 md:hidden">
          <button
            onClick={() => setDark(!dark)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground cursor-pointer transition-colors"
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
            {dark ? 'Light' : 'Dark'}
          </button>
          <button
            onClick={async () => { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } window.location.reload(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground cursor-pointer transition-colors"
            title="Clear cache & reload"
          >
            <RefreshCw size={13} />Clear
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
      <aside className={cn("hidden md:flex fixed inset-y-0 left-0 bg-sidebar text-sidebar-foreground flex-col z-30 shadow-xl transition-all duration-200", collapsed ? 'w-[60px]' : 'w-56')}>
        {/* Called, not rendered as <SidebarContent/>: the function is defined
            inside Layout, so using it as a component would give React a new
            type every render and remount the nav — losing its scroll position
            on every navigation. */}
        {SidebarContent({ isCollapsed: collapsed })}
        <button
          onClick={() => { setCollapsed(c => { localStorage.setItem('pb_sidebar_collapsed', String(!c)); return !c }) }}
          className="shrink-0 flex items-center justify-center h-10 border-t border-white/10 text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5 cursor-pointer transition-colors"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronDown size={16} className={cn('transition-transform duration-200', collapsed ? '-rotate-90' : 'rotate-90')} />
        </button>
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
            {SidebarContent()}
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
      <main className={cn("flex-1 pt-14 md:pt-0 min-w-0 transition-all duration-200", collapsed ? 'md:ml-[60px]' : 'md:ml-56')} style={{ background: '#FBF8F2' }}>
        {/* Desktop top bar with profile dropdown */}
        <div className="hidden md:flex items-center justify-between h-14 px-6 border-b border-border/40">
          <h1 className="text-lg font-semibold" style={{ color: '#14081F' }}>{getPageTitle(location.pathname)}</h1>
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen(o => !o)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <div className="h-7 w-7 rounded-full bg-[#5B2BC9] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
              </div>
              <span className="text-sm font-medium text-foreground max-w-[120px] truncate">{user?.name}</span>
              <ChevronDown size={14} className={cn('text-muted-foreground transition-transform duration-200', profileOpen && 'rotate-180')} />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-border bg-white dark:bg-neutral-900 shadow-xl py-1.5 z-50">
                {/* User info */}
                <div className="px-3 py-2 border-b border-border/60">
                  <div className="text-sm font-semibold text-foreground truncate">{user?.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                </div>

                {/* Profile menu items */}
                <div className="py-1">
                  {profileMenuItems.filter(({ perm }) => hasPermission(perm)).map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                        isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-muted/60'
                      )}
                    >
                      <Icon size={15} className="text-muted-foreground" />{label}
                    </NavLink>
                  ))}
                </div>

                {/* Admin items */}
                {isAdmin && (
                  <div className="border-t border-border/60 py-1">
                    <NavLink
                      to="/users"
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                        isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-muted/60'
                      )}
                    >
                      <UserCog size={15} className="text-muted-foreground" />Users
                    </NavLink>
                    <NavLink
                      to="/backup"
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                        isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-muted/60'
                      )}
                    >
                      <DatabaseBackup size={15} className="text-muted-foreground" />Backup
                    </NavLink>
                  </div>
                )}

                {/* Dark mode + Logout */}
                <div className="border-t border-border/60 py-1">
                  <button
                    onClick={() => setDark(!dark)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    {dark ? <Sun size={15} className="text-muted-foreground" /> : <Moon size={15} className="text-muted-foreground" />}
                    {dark ? 'Light mode' : 'Dark mode'}
                  </button>
                  <button
                    onClick={async () => { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } window.location.reload(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <RefreshCw size={15} className="text-muted-foreground" />Clear cache
                  </button>
                  <button
                    onClick={() => { logout(); navigate('/login') }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <LogOut size={15} />Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={location.pathname === '/floor-map' ? '' : 'p-3 sm:p-4'}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
