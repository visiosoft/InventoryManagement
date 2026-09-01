import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/* Where /reports lands, in order of preference.
 *
 * Only routes that still exist. Nine reports were removed, and leaving them
 * listed here would send somebody with that permission to a page that is no
 * longer built — a blank screen rather than an honest redirect. */
const REPORT_ROUTES = [
  { perm: 'reports_units',         to: '/reports/rates' },
  { perm: 'reports_conversations', to: '/reports/conversations' },
]

export default function Reports() {
  const { hasPermission } = useAuth()
  const first = REPORT_ROUTES.find(r => hasPermission(r.perm))
  return <Navigate to={first?.to ?? '/'} replace />
}
