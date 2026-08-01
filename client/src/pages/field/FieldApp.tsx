import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import FieldLayout from './FieldLayout'
import FieldHome from './FieldHome'
import FieldJobs from './FieldJobs'
import FieldJobDetail from './FieldJobDetail'
import FieldVisits from './FieldVisits'
import FieldQuotes from './FieldQuotes'
import FieldInvoices from './FieldInvoices'
import FieldLeads from './FieldLeads'
import FieldSchedule from './FieldSchedule'
import FieldDispatch from './FieldDispatch'
import FieldSurvey from './FieldSurvey'
import FieldWorkers from './FieldWorkers'
import FieldFleet from './FieldFleet'
import FieldClaims from './FieldClaims'

export default function FieldApp() {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/field/login" replace />
  }

  return (
    <FieldLayout>
      <Routes>
        <Route index element={<FieldHome />} />
        <Route path="jobs" element={<FieldJobs />} />
        <Route path="jobs/:id" element={<FieldJobDetail />} />
        <Route path="visits" element={<FieldVisits />} />
        <Route path="quotes" element={<FieldQuotes />} />
        <Route path="invoices" element={<FieldInvoices />} />
        <Route path="leads" element={<FieldLeads />} />
        <Route path="schedule" element={<FieldSchedule />} />
        <Route path="dispatch" element={<FieldDispatch />} />
        <Route path="survey" element={<FieldSurvey />} />
        <Route path="workers" element={<FieldWorkers />} />
        <Route path="fleet" element={<FieldFleet />} />
        <Route path="claims" element={<FieldClaims />} />
        <Route path="*" element={<Navigate to="/field" replace />} />
      </Routes>
    </FieldLayout>
  )
}
