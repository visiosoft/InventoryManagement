import { Navigate, Route, Routes } from 'react-router-dom'
import { useCustomerAuth } from '../../lib/customerAuth'
import PortalLayout from './PortalLayout'
import PortalJobs from './PortalJobs'
import PortalJobDetail from './PortalJobDetail'

export default function PortalApp() {
  const { customer } = useCustomerAuth()

  if (!customer) {
    return <Navigate to="/portal/login" replace />
  }

  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<PortalJobs />} />
        <Route path="jobs/:id" element={<PortalJobDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  )
}
