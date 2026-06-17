import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const REPORT_ROUTES = [
  { perm: 'reports_monthly',   to: '/reports/monthly' },
  { perm: 'reports_units',     to: '/reports/units' },
  { perm: 'reports_finances',  to: '/reports/finances' },
  { perm: 'reports_forecast',  to: '/reports/forecast' },
  { perm: 'reports_contracts', to: '/reports/contracts' },
  { perm: 'reports_vacancies', to: '/reports/vacancies' },
  { perm: 'reports_overdue',   to: '/reports/overdue' },
  { perm: 'reports_expiring',  to: '/reports/expiring' },
]

export default function Reports() {
  const { hasPermission } = useAuth()
  const first = REPORT_ROUTES.find(r => hasPermission(r.perm))
  return <Navigate to={first?.to ?? '/'} replace />
}
