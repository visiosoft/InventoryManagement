import { Outlet } from 'react-router-dom'
import { LogOut, Package } from 'lucide-react'
import { useCustomerAuth } from '../../lib/customerAuth'

export default function PortalLayout() {
  const { customer, logout } = useCustomerAuth()

  return (
    <div className="min-h-screen" style={{ background: '#FBF8F2' }}>
      <header className="sticky top-0 z-30 border-b" style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: '#5B2BC9' }}>
              <Package size={18} color="#fff" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight" style={{ color: '#14081F' }}>PurpleBox</div>
              <div className="text-[10px] leading-tight" style={{ color: '#756E80' }}>Customer Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium" style={{ color: '#14081F' }}>{customer?.fullName}</span>
            <button
              onClick={logout}
              className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
              title="Sign out"
            >
              <LogOut size={16} style={{ color: '#756E80' }} />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
