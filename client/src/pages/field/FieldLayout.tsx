import { type ReactNode, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Home, Briefcase, Truck, LogOut, Menu, X,
  ClipboardList, FileText, Receipt, MapPin,
  Users, Car, Calendar, AlertTriangle, UserPlus,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'

interface Props {
  children: ReactNode
}

const NAV_ITEMS = [
  { to: '/field', icon: Home, label: 'Home', end: true },
  { to: '/field/jobs', icon: Briefcase, label: 'Jobs', end: false },
  { to: '/field/visits', icon: MapPin, label: 'Visits', end: false },
  { to: '/field/quotes', icon: FileText, label: 'Quotes', end: false },
]

const MORE_ITEMS = [
  { to: '/field/leads', icon: UserPlus, label: 'Leads' },
  { to: '/field/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/field/schedule', icon: Calendar, label: 'Schedule' },
  { to: '/field/dispatch', icon: Truck, label: 'Dispatch' },
  { to: '/field/survey', icon: ClipboardList, label: 'Survey' },
  { to: '/field/workers', icon: Users, label: 'Workers' },
  { to: '/field/fleet', icon: Car, label: 'Fleet' },
  { to: '/field/claims', icon: AlertTriangle, label: 'Claims' },
]

export default function FieldLayout({ children }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/field/login')
  }

  const isMoreActive = MORE_ITEMS.some(m => location.pathname.startsWith(m.to))

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-2">
          <Truck size={22} />
          <span className="text-lg font-bold tracking-tight">PurpleMove Admin</span>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <span className="text-sm font-medium opacity-90 truncate max-w-[120px]">
              {user.name}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-5 w-full" style={{ maxWidth: 600, margin: '0 auto' }}>
        {children}
      </main>

      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-16 left-0 right-0 bg-card border-t border-border rounded-t-2xl shadow-2xl p-4 z-50"
            onClick={e => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-3">
              {MORE_ITEMS.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-colors ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`
                  }
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="border-t border-border bg-card shrink-0 safe-area-bottom z-50 relative">
        <div className="flex">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
              isMoreActive || moreOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {moreOpen ? <X size={22} /> : <Menu size={22} />}
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
