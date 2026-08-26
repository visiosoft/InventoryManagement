import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import WhatsAppBell from './WhatsAppBell'
import { Bot, Compass, Megaphone, LayoutDashboard, Search, Box, Users, FileText, BarChart3, Building2, Briefcase, CalendarClock, CalendarOff, AlertTriangle, Clock, ChevronDown, FolderOpen, Settings, LogOut, Moon, Sun, UserPlus, ReceiptText, Truck, Wallet, TrendingUp, UserCog, X, Package, CalendarDays, ClipboardList, Users2, Menu, DatabaseBackup, ScrollText, CalendarCheck, RefreshCw, Mail, Filter, PieChart, ShieldAlert, CreditCard, Target, Calculator, ListTodo, NotebookPen, MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import GlobalSearch from './GlobalSearch'
import { cn } from '../lib/utils'
import { isSalesRepRole } from '../lib/roles'

const navTop = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' as string | undefined },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, perm: 'dashboard' },
]

const navGroups = [
  {
    title: 'Inventory',
    items: [
      { to: '/quotes', label: 'Book Unit', icon: FileText, perm: 'quotes' },
      { to: '/units', label: 'Search Units', icon: Box, perm: 'units' },
      { to: '/contracts', label: 'Tenants', icon: Briefcase, perm: 'contracts' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/my-leads', label: 'My Leads', icon: UserPlus, perm: 'sales_board' },
      { to: '/moving-estimator', label: 'Moving Estimator', icon: Calculator, perm: 'sales_board' },
      { to: '/my-performance', label: 'Reports', icon: BarChart3, perm: 'sales_board' },
      { to: '/account', label: 'Settings', icon: Settings, perm: 'sales_board' },
      { to: '/leads', label: 'Leads', icon: UserPlus, perm: 'leads' },
      { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, perm: ['whatsapp', 'leads'] },
    ],
  },
]

// The profile menu, laid out in two columns of labelled groups. Settings,
// dark mode and cache live in the footer, so they are not listed here.
const profileMenuGroups = [
  {
    label: 'Storage',
    items: [
      { to: '/invoices', label: 'Invoices', icon: ReceiptText, perm: 'invoices' as string | undefined, adminOnly: false },
      { to: '/documents', label: 'Documents', icon: FolderOpen, perm: 'documents', adminOnly: false },
      { to: '/customers', label: 'Tenants', icon: Users, perm: 'customers', adminOnly: false },
      { to: '/sites', label: 'Sites', icon: Building2, perm: 'units', adminOnly: false },
    ],
  },
  {
    label: 'Moving',
    items: [
      { to: '/moving/leads', label: 'Moving Leads', icon: UserPlus, perm: 'moving_leads', adminOnly: false },
      { to: '/moving/workers', label: 'Workers', icon: Users2, perm: 'moving_workers', adminOnly: false },
      { to: '/moving/fleet', label: 'Fleet', icon: Truck, perm: 'moving_fleet', adminOnly: false },
      { to: '/moving-inventory', label: 'Moving Inventory', icon: Box, perm: 'moving_dashboard', adminOnly: false },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/settings/templates', label: 'Message Templates', icon: Mail, perm: 'settings', adminOnly: false },
      { to: '/settings/agreement', label: 'Agreement Template', icon: FileText, perm: 'settings', adminOnly: false },
      { to: '/settings/automation', label: 'Automation Rules', icon: RefreshCw, perm: 'settings', adminOnly: false },
      { to: '/settings/ai', label: 'AI Assistant', icon: Bot, perm: 'settings', adminOnly: false },
      { to: '/settings/sent-emails', label: 'Sent Emails', icon: Mail, perm: 'settings', adminOnly: true },
      { to: '/marketing', label: 'Marketing', icon: Megaphone, perm: 'settings', adminOnly: true },
      { to: '/zoho-comparison', label: 'Zoho Comparison', icon: RefreshCw, perm: 'settings', adminOnly: false },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/tasks', label: 'Tasks', icon: ListTodo, perm: undefined, adminOnly: true },
      { to: '/diary', label: 'Daily Diary', icon: NotebookPen, perm: undefined, adminOnly: false },
      { to: '/walkthroughs', label: 'Walkthroughs', icon: Compass, perm: undefined, adminOnly: false },
      { to: '/users', label: 'Users', icon: UserCog, perm: undefined, adminOnly: true },
      { to: '/sales-team', label: 'Sales Team', icon: Target, perm: undefined, adminOnly: true },
      { to: '/backup', label: 'Backup', icon: DatabaseBackup, perm: undefined, adminOnly: true },
    ],
  },
]

const profileMenuItems = profileMenuGroups.flatMap((g) => g.items)

const reportItems = [
  { to: '/reports/monthly', label: 'Monthly Payments', icon: CalendarClock, perm: 'reports_monthly' },
  { to: '/reports/units', label: 'Unit Revenue', icon: Building2, perm: 'reports_units' },
  { to: '/reports/rates', label: 'Actual vs Leased', icon: Wallet, perm: 'reports_units' },
  { to: '/reports/finances', label: 'Finances', icon: Wallet, perm: 'reports_finances' },
  { to: '/reports/forecast', label: 'Forecast', icon: TrendingUp, perm: 'reports_forecast' },
  { to: '/reports/contracts', label: 'Contracts', icon: BarChart3, perm: 'reports_contracts' },
  { to: '/reports/vacancies', label: 'Upcoming Vacancies', icon: CalendarOff, perm: 'reports_vacancies' },
  { to: '/reports/overdue', label: 'Overdue Payments', icon: AlertTriangle, perm: 'reports_overdue' },
  { to: '/reports/expiring', label: 'Expiring Contracts', icon: Clock, perm: 'reports_expiring' },
  { to: '/reports/income', label: 'Income Analysis', icon: TrendingUp, perm: 'reports_finances' },
  { to: '/reports/conversations', label: 'Daily Conversations', icon: MessageCircle, perm: 'reports_conversations' },
]

const navBottom: { to: string; label: string; icon: any; perm: string | string[] }[] = []

// Sales reps see one flat list matching the standalone mockup's nav order,
// instead of the admin app's split Inventory/Sales/Moving groups.
// Daily drivers first, then reference material. Dashboard is the rep's leads
// board, so there's no separate Leads entry — they were the same page and
// both lit up as active.
// A rep's own board and their to-do list sit above the groups — they are
// what the day starts on, not a category of work.
const salesRepNavTop = [
  // Called "Dashboard" until a rep asked where Leads had gone. The page is
  // their leads board — the same one the top menu calls My Leads — so naming
  // it after the thing it shows is the whole fix.
  { key: 'leads', to: '/my-leads', label: 'Leads', icon: UserPlus, perm: 'sales_board' },
  { key: 'tasks', to: '/tasks', label: 'Tasks', icon: ListTodo, perm: 'sales_board' },
]

const salesRepNavGroups = [
  {
    title: 'Sales',
    items: [
      { key: 'whatsapp', to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, perm: 'sales_board' },
      { key: 'diary', to: '/diary', label: 'Daily Diary', icon: NotebookPen, perm: 'sales_board' },
      { key: 'reports', to: '/my-performance', label: 'Reports', icon: BarChart3, perm: 'sales_board' },
    ],
  },
  {
    title: 'Storage',
    items: [
      { key: 'book-unit', to: '/quotes', label: 'Book Unit', icon: FileText, perm: 'sales_board' },
      { key: 'customers', to: '/contracts', label: 'Customers', icon: Users, perm: 'contracts' },
      { key: 'search-units', to: '/units', label: 'Search Units', icon: Box, perm: 'units' },
    ],
  },
  {
    title: 'Moving',
    items: [
      { key: 'moving-schedule', to: '/moving/schedule', label: 'Moving Schedule', icon: CalendarDays, perm: 'moving_schedule' },
      // Gated on moving_jobs rather than sales_board, so it appears only for
      // whoever is given it — accounts today, not every rep by default.
      { key: 'moving-jobs', to: '/moving/jobs', label: 'Jobs List', icon: ClipboardList, perm: 'moving_jobs' },
      { key: 'moving-estimator', to: '/moving-estimator', label: 'Moving Estimator', icon: Calculator, perm: 'sales_board' },
    ],
  },
]

const salesRepNavBottom = [
  { key: 'settings', to: '/account', label: 'Settings', icon: Settings, perm: 'sales_board' },
]

// The moving menu, grouped the way the work splits: what the crews do day
// to day, then the money. Leads sits in the profile menu with the other
// occasional screens.
const movingNavGroups = [
  {
    title: 'Moving',
    items: [
      { to: '/moving', label: 'Dashboard', icon: LayoutDashboard, perm: 'moving_dashboard' as string },
      { to: '/moving/schedule', label: 'Schedule Jobs', icon: CalendarDays, perm: 'moving_schedule' },
      { to: '/moving/visits', label: 'Site Visits', icon: CalendarCheck, perm: 'moving_jobs' },
      { to: '/moving/jobs', label: 'Jobs List', icon: ClipboardList, perm: 'moving_jobs' },
      { to: '/moving/dispatch', label: 'Dispatch', icon: Package, perm: 'moving_dispatch' },
      { to: '/moving/claims', label: 'Claims', icon: AlertTriangle, perm: 'moving_dashboard' },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { to: '/moving/quotes', label: 'Quotes', icon: ScrollText, perm: 'moving_jobs' },
      { to: '/moving/invoices', label: 'Invoices', icon: ReceiptText, perm: 'moving_invoices' },
    ],
  },
]

// Flattened for the permission and route checks that only need the paths.
const movingNavItems = movingNavGroups.flatMap((g) => g.items)

const movingReportItems = [
  { to: '/moving/reports/ar', label: 'Accounts Receivable', icon: Wallet, perm: 'reports_moving_ar' },
  { to: '/moving/reports/revenue', label: 'Revenue', icon: TrendingUp, perm: 'reports_moving_revenue' },
  { to: '/moving/reports/profitability', label: 'Profitability', icon: PieChart, perm: 'reports_moving_profitability' },
  { to: '/moving/reports/costs', label: 'Cost Breakdown', icon: Filter, perm: 'reports_moving_costs' },
  { to: '/moving/reports/pipeline', label: 'Sales Pipeline', icon: TrendingUp, perm: 'reports_moving_pipeline' },
  { to: '/moving/reports/crew', label: 'Crew', icon: Users2, perm: 'reports_moving_crew' },
  { to: '/moving/reports/fleet', label: 'Fleet', icon: Truck, perm: 'reports_moving_fleet' },
  { to: '/moving/reports/payroll', label: 'Payroll', icon: ReceiptText, perm: 'reports_moving_payroll' },
  { to: '/moving/reports/claims', label: 'Damage Claims', icon: ShieldAlert, perm: 'moving_dashboard' },
  { to: '/moving/reports/stripe-payments', label: 'Stripe Payments', icon: CreditCard, perm: 'reports_moving_stripe' },
]


type BusinessMode = 'storage' | 'moving'

const BUSINESS_MODE_KEY = 'pb_business_mode'

// Routes that belong to the Moving business. `/moving-estimator` is
// deliberately excluded — it lives in the Sales group on the storage side.
function isMovingPath(pathname: string): boolean {
  return pathname === '/moving' || pathname.startsWith('/moving/') || pathname.startsWith('/moving-inventory')
}

// Every route reachable from the storage half of the nav, used to snap the
// switcher back to Storage when the stored preference contradicts the page.
const storagePaths = [
  ...navTop.map(i => i.to),
  ...navGroups.flatMap(g => g.items.map(i => i.to)),
  ...reportItems.map(i => i.to),
  ...navBottom.map(i => i.to),
  ...profileMenuItems.map(i => i.to).filter(to => !to.startsWith('/moving')),
]

function isStoragePath(pathname: string): boolean {
  return storagePaths.some(p => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))
}

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
  '/my-leads': 'My Leads',
  '/moving-estimator': 'Moving Estimator',
  '/my-performance': 'My Performance',
  '/account': 'Settings',
  '/quotations': 'Quotations',
  '/contracts': 'Tenants',
  '/invoices': 'Invoices',
  '/documents': 'Documents',
  '/settings': 'Settings',
  '/settings/agreement': 'Agreement Template',
  '/zoho-comparison': 'Zoho Comparison',
  '/approvals': 'Approvals',
  '/users': 'User Management',
  '/sales-team': 'Sales Team',
  '/tasks': 'Tasks',
  '/diary': 'Daily Diary',
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
  '/whatsapp': 'WhatsApp Inbox',
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
  const onMovingReportsRoute = location.pathname.startsWith('/moving/reports')
  const [movingReportsOpen, setMovingReportsOpen] = useState(onMovingReportsRoute)
  const [dark, setDark] = useState(() => localStorage.getItem('pb_theme') === 'dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pb_sidebar_collapsed') === 'true')
  const [profileOpen, setProfileOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const isAdmin = user?.role === 'admin'
  const isSalesRepUser = isSalesRepRole(user?.role)
  const isMovingOnly = hasPermission('moving_dashboard') && !hasPermission('units') && !hasPermission('dashboard')

  // ── Business switcher ──────────────────────────────────────────
  // Storage and Moving are two businesses in one app; the sidebar shows one
  // at a time instead of stacking both.
  // Moving Leads lives in the profile menu now, so count it here too — it is
  // still moving access even though it is not in the sidebar list.
  const hasMovingAccess = movingNavItems.some(({ perm }) => hasPermission(perm)) || hasPermission('moving_leads')
    || movingReportItems.some(({ perm }) => hasPermission(perm))
  const hasStorageAccess = navTop.some(({ perm }) => !perm || hasPermission(perm))
    || navGroups.some(g => g.items.some(({ perm }) => !perm || hasPermission(perm)))
    || reportItems.some(({ perm }) => hasPermission(perm))
    || navBottom.some(({ perm }) => !perm || hasPermission(perm))
  // Nothing to switch to → no switcher (moving-only users, storage-only users,
  // and sales reps, who keep their own flat nav).
  const showBusinessSwitcher = !isSalesRepUser && !isMovingOnly && hasMovingAccess && hasStorageAccess
  const [storedMode, setStoredMode] = useState<BusinessMode>(
    () => (localStorage.getItem(BUSINESS_MODE_KEY) === 'moving' ? 'moving' : 'storage')
  )
  // The route wins over the stored preference, so the menu can never
  // contradict the page you are looking at.
  const businessMode: BusinessMode =
    isMovingOnly || !hasStorageAccess ? 'moving'
    : !hasMovingAccess ? 'storage'
    : isMovingPath(location.pathname) ? 'moving'
    : isStoragePath(location.pathname) ? 'storage'
    : storedMode
  useEffect(() => { localStorage.setItem(BUSINESS_MODE_KEY, businessMode) }, [businessMode])
  const switchBusiness = (mode: BusinessMode) => {
    setStoredMode(mode)
    localStorage.setItem(BUSINESS_MODE_KEY, mode)
    navigate(mode === 'moving' ? '/moving' : '/')
  }
  const canSeeWhatsApp = hasPermission('leads') || hasPermission('sales_board')
  const showStorageNav = !isMovingOnly && !isSalesRepUser && businessMode === 'storage'
  const showMovingNav = !isSalesRepUser && businessMode === 'moving'

  // Site switcher disabled for now — clear any previously selected site
  useEffect(() => { localStorage.removeItem('pb_site_id') }, [])

  // Close sidebar on route change (mobile)
  useEffect(() => { setSidebarOpen(false); setProfileOpen(false); setMobileSearchOpen(false) }, [location.pathname])

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

      {/* Business switcher — Storage or Moving, never both at once */}
      {showBusinessSwitcher && (
        isCollapsed ? (
          <div className="shrink-0 flex flex-col items-center gap-1 border-b border-white/10 px-1.5 py-2">
            <button
              onClick={() => switchBusiness('storage')}
              title="Storage"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer',
                businessMode === 'storage'
                  ? 'bg-[#FFF799] text-[#111218] shadow-sm'
                  : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
              )}
            >
              <Box size={16} />
            </button>
            <button
              onClick={() => switchBusiness('moving')}
              title="Moving"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer',
                businessMode === 'moving'
                  ? 'bg-[#FFF799] text-[#111218] shadow-sm'
                  : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
              )}
            >
              <Truck size={16} />
            </button>
          </div>
        ) : (
          <div className="shrink-0 border-b border-white/10 px-2.5 py-2.5">
            <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
              <button
                onClick={() => switchBusiness('storage')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-all duration-150 cursor-pointer',
                  businessMode === 'storage'
                    ? 'bg-[#FFF799] text-[#111218] shadow-sm'
                    : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
                )}
              >
                <Box size={14} />Storage
              </button>
              <button
                onClick={() => switchBusiness('moving')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-all duration-150 cursor-pointer',
                  businessMode === 'moving'
                    ? 'bg-[#FFF799] text-[#111218] shadow-sm'
                    : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
                )}
              >
                <Truck size={14} />Moving
              </button>
            </div>
          </div>
        )
      )}

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto py-3 space-y-0.5", isCollapsed ? 'px-1.5' : 'px-2.5')}>
        {isSalesRepUser && (() => {
          const link = ({ key, to, label, icon: Icon }: { key: string; to: string; label: string; icon: any }) => (
            <NavLink key={key} to={to}
              className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
              title={isCollapsed ? label : undefined}>
              <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
            </NavLink>
          )
          return (
            <>
              {salesRepNavTop.filter(({ perm }) => !perm || hasPermission(perm)).map(link)}

              {salesRepNavGroups.map((group) => {
                const items = group.items.filter(({ perm }) => !perm || hasPermission(perm))
                if (items.length === 0) return null
                return (
                  <div key={group.title} className="pt-3">
                    {isCollapsed
                      ? <div className="border-t border-white/10 my-1" />
                      : <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">{group.title}</div>}
                    <div className="space-y-0.5">{items.map(link)}</div>
                  </div>
                )
              })}

              <div className="pt-3">
                {salesRepNavBottom.filter(({ perm }) => !perm || hasPermission(perm)).map(link)}
              </div>
            </>
          )
        })()}

        {showStorageNav && navTop.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
            title={isCollapsed ? label : undefined}>
            <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
          </NavLink>
        ))}

        {showStorageNav && navGroups.map((group) => {
          // Search Units used to be hidden from reps, on the reasoning that the
          // 'units' permission also gated the editable unit list. It no longer
          // does — units are created and priced on Settings → Unit Pricing —
          // and a rep who cannot look up what is free cannot do their job.
          const visibleItems = group.items
            .filter(({ perm }) => !perm || hasPermission(perm))
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

        {/* Reports */}
        {showStorageNav && (() => {
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

        {showStorageNav && navBottom.filter(({ perm }) => !perm || hasPermission(perm)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => isCollapsed ? cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', isActive ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8') : navLinkCls(isActive)}
            title={isCollapsed ? label : undefined}>
            <Icon size={isCollapsed ? 18 : 15} />{!isCollapsed && label}
          </NavLink>
        ))}


        {/* Moving Business */}
        {showMovingNav && movingNavGroups.map((group) => {
          const visibleMoving = group.items.filter(({ perm }) => hasPermission(perm))
          if (visibleMoving.length === 0) return null
          return (
            <div key={group.title} className="pt-3">
              {isCollapsed ? <div className="border-t border-white/10 my-1" /> : <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">{group.title}</div>}
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
        })}

        {/* Moving Reports */}
        {showMovingNav && (() => {
          const visibleMovingReports = movingReportItems.filter(({ perm }) => hasPermission(perm))
          if (visibleMovingReports.length === 0) return null
          if (isCollapsed) {
            return (
              <div className="pt-3">
                <div className="border-t border-white/10 my-1" />
                <NavLink to="/moving/reports/ar"
                  className={() => cn('flex items-center justify-center rounded-lg p-2 transition-all duration-150', onMovingReportsRoute ? 'bg-[#FFF799] text-[#111218] shadow-sm' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8')}
                  title="Moving Reports">
                  <BarChart3 size={18} />
                </NavLink>
              </div>
            )
          }
          return (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">Moving Reports</div>
              <button
                onClick={() => setMovingReportsOpen(o => !o)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all cursor-pointer',
                  onMovingReportsRoute ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/8'
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
            </div>
          )
        })()}

        {/* Settings & admin — mobile only; desktop reaches these via the profile dropdown */}
        {!isSalesRepUser && (() => {
          const visibleProfile = profileMenuItems.filter(
            ({ perm, adminOnly }) => (!perm || hasPermission(perm)) && (!adminOnly || isAdmin)
          )
          if (visibleProfile.length === 0 && !isAdmin) return null
          return (
            <div className="pt-3 md:hidden">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted/60">Settings</div>
              {visibleProfile.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => navLinkCls(isActive)}>
                  <Icon size={15} />{label}
                </NavLink>
              ))}
              {hasPermission('settings') && (
                <NavLink to="/settings" className={({ isActive }) => navLinkCls(isActive)}>
                  <Settings size={15} />Settings
                </NavLink>
              )}
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
        {!isMovingOnly && (
          <button
            onClick={() => setMobileSearchOpen((o) => !o)}
            className={cn('cursor-pointer p-1 rounded-lg hover:bg-white/10 transition-colors', mobileSearchOpen ? 'text-[#FFF799]' : 'text-sidebar-muted hover:text-sidebar-foreground')}
            title="Search"
          >
            <Search size={19} />
          </button>
        )}
        <button
          onClick={() => setDark(!dark)}
          className="text-sidebar-muted hover:text-sidebar-foreground cursor-pointer p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {/* Mobile search bar — slides under the header */}
      {mobileSearchOpen && !isMovingOnly && (
        <div className="md:hidden fixed top-14 inset-x-0 z-30 bg-sidebar px-3 pt-1 pb-3 shadow-lg">
          <GlobalSearch />
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────── */}
      <main className={cn("flex-1 pt-14 md:pt-0 min-w-0 transition-all duration-200", collapsed ? 'md:ml-[60px]' : 'md:ml-56')} style={{ background: '#FBF8F2' }}>
        {/* Desktop top bar with profile dropdown */}
        <div className="hidden md:flex items-center justify-between h-14 px-6 border-b border-border/40">
          <h1 className="text-lg font-semibold shrink-0" style={{ color: '#14081F' }}>{getPageTitle(location.pathname)}</h1>
          <div className="flex items-center gap-3">
          {!isMovingOnly && <GlobalSearch />}
          {/* Unread WhatsApp, on every page — the console is not the only place
              someone works, and a waiting customer should not depend on being
              in the right tab to notice. */}
          {canSeeWhatsApp && <WhatsAppBell />}
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
              <div
                className="absolute right-0 top-full mt-3 z-50 overflow-hidden"
                style={{
                  width: 640,
                  background: '#fff',
                  borderRadius: 18,
                  border: '1px solid rgba(20,8,31,.10)',
                  boxShadow: '0 24px 60px rgba(20,8,31,.14), 0 6px 16px rgba(20,8,31,.06)',
                }}
              >
                {/* Who you are signed in as */}
                <div
                  className="flex items-center gap-3.5"
                  style={{ padding: '20px 24px', borderBottom: '1px solid rgba(20,8,31,.10)' }}
                >
                  <div
                    className="grid place-items-center shrink-0"
                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#5B2BC9', color: '#fff', fontWeight: 700, fontSize: 17 }}
                  >
                    {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate" style={{ fontWeight: 700, fontSize: 15, color: '#14081F' }}>{user?.name}</div>
                    <div className="truncate" style={{ fontSize: 13, color: '#756E80', marginTop: 1 }}>{user?.email}</div>
                  </div>
                </div>

                {/* Two columns of grouped links */}
                <div className="grid grid-cols-2" style={{ columnGap: 28, rowGap: 22, padding: '20px 24px' }}>
                  {profileMenuGroups.map((group) => {
                    const items = group.items.filter(
                      (i) => (!i.perm || hasPermission(i.perm)) && (!i.adminOnly || isAdmin)
                    )
                    if (items.length === 0) return null
                    return (
                      <div key={group.label}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#4A1FA0', marginBottom: 8, padding: '0 8px' }}>
                          {group.label}
                        </div>
                        <div className="grid" style={{ gap: 2 }}>
                          {items.map(({ to, label, icon: Icon }) => (
                            <NavLink
                              key={to}
                              to={to}
                              className="flex items-center gap-2.5 rounded-lg transition-colors hover:bg-[#F7F3FF]"
                              style={({ isActive }) => ({
                                padding: '7px 8px',
                                fontSize: 14,
                                fontWeight: isActive ? 600 : 500,
                                color: isActive ? '#4A1FA0' : '#4A4357',
                                background: isActive ? '#F7F3FF' : undefined,
                              })}
                            >
                              <Icon size={16} className="shrink-0" style={{ color: '#756E80' }} />
                              <span className="truncate">{label}</span>
                            </NavLink>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Settings, dark mode, cache, sign out */}
                <div
                  className="flex items-center gap-2"
                  style={{ padding: '14px 24px', borderTop: '1px solid rgba(20,8,31,.10)', background: '#F7F3FF' }}
                >
                  {hasPermission('settings') && (
                    <>
                      <NavLink
                        to="/settings"
                        className="flex items-center gap-2 rounded-lg hover:bg-white transition-colors"
                        style={{ padding: '7px 10px', fontSize: 14, fontWeight: 500, color: '#4A4357' }}
                      >
                        <Settings size={16} style={{ color: '#756E80' }} />
                        <span>Settings</span>
                      </NavLink>
                      <span style={{ width: 1, height: 18, background: 'rgba(20,8,31,.14)' }} />
                    </>
                  )}

                  <div className="flex items-center gap-2 flex-1" style={{ padding: '7px 10px', fontSize: 14, fontWeight: 500, color: '#4A4357' }}>
                    {dark ? <Sun size={16} style={{ color: '#756E80' }} /> : <Moon size={16} style={{ color: '#756E80' }} />}
                    <span>Dark mode</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={dark}
                      aria-label="Dark mode"
                      onClick={() => setDark(!dark)}
                      className="relative cursor-pointer ml-auto"
                      style={{ width: 36, height: 20, borderRadius: 999, background: dark ? '#5B2BC9' : 'rgba(20,8,31,.18)', transition: 'background .15s' }}
                    >
                      <span
                        className="absolute"
                        style={{ top: 2, left: dark ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(20,8,31,.2)', transition: 'left .15s' }}
                      />
                    </button>
                  </div>

                  <span style={{ width: 1, height: 18, background: 'rgba(20,8,31,.14)' }} />
                  <button
                    type="button"
                    onClick={async () => { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } window.location.reload(); }}
                    className="flex items-center gap-2 rounded-lg hover:bg-white transition-colors cursor-pointer"
                    style={{ padding: '7px 10px', fontSize: 14, fontWeight: 500, color: '#756E80' }}
                  >
                    <RefreshCw size={14} />
                    <span>Clear cache</span>
                  </button>

                  <span style={{ width: 1, height: 18, background: 'rgba(20,8,31,.14)' }} />
                  <button
                    type="button"
                    onClick={() => { logout(); navigate('/login') }}
                    className="flex items-center gap-2 rounded-lg hover:bg-white transition-colors cursor-pointer"
                    style={{ padding: '7px 10px', fontSize: 14, fontWeight: 600, color: '#C0332C' }}
                  >
                    <LogOut size={15} />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        <div className={location.pathname === '/floor-map' ? '' : 'p-3 sm:p-4'}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
