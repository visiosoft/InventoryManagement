import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Box, Users, FileText, CreditCard, BarChart3, FolderOpen, Settings, LogOut, Moon, Sun, UserPlus, ReceiptText, FileSpreadsheet, Truck, ShoppingCart, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { cn } from '../lib/utils'

const navTop = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
]

const navGroups = [
  {
    title: 'Inventory',
    items: [
      { to: '/units', label: 'Units', icon: Box },
      { to: '/contracts', label: 'Contracts', icon: FileText },
      { to: '/documents', label: 'Documents', icon: FolderOpen },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/quotes', label: 'Quotes', icon: FileSpreadsheet },
      { to: '/invoices', label: 'Invoices', icon: ReceiptText },
    ],
  },
  {
    title: 'Purchases',
    items: [
      { to: '/vendors', label: 'Vendors', icon: Truck },
      { to: '/expenses', label: 'Expenses', icon: Wallet },
    ],
  },
]

const navBottom = [
  { to: '/leads', label: 'Leads', icon: UserPlus },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [dark, setDark] = useState(() => localStorage.getItem('pb_theme') === 'dark')

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
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {navTop.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          {navGroups.map((group) => (
            <div key={group.title} className="pt-2">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">{group.title}</div>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                      isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                    )
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}

          {navBottom.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
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
        <Outlet />
      </main>
    </div>
  )
}
