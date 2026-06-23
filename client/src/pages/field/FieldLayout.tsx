import { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Briefcase, ClipboardList, Truck, LogOut } from 'lucide-react'
import { useAuth } from '../../lib/auth'

interface Props {
  children: ReactNode
}

export default function FieldLayout({ children }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/field/login')
  }

  const navItems = [
    { to: '/field', icon: Home, label: 'Home', end: true },
    { to: '/field/jobs', icon: Briefcase, label: 'My Jobs', end: false },
    { to: '/field/survey', icon: ClipboardList, label: 'Survey', end: false },
    { to: '/field/dispatch', icon: Truck, label: 'Dispatch', end: false },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-2">
          <Truck size={22} />
          <span className="text-lg font-bold tracking-tight">PurpleBox Moving</span>
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
      <main className="flex-1 overflow-y-auto px-4 py-5 max-w-lg mx-auto w-full">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="border-t border-border bg-card shrink-0 safe-area-bottom">
        <div className="flex">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
