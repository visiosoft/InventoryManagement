import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import FieldLayout from './FieldLayout'
import FieldHome from './FieldHome'
import FieldJobs from './FieldJobs'
import FieldSurvey from './FieldSurvey'
import FieldDispatch from './FieldDispatch'

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
        <Route path="survey" element={<FieldSurvey />} />
        <Route path="dispatch" element={<FieldDispatch />} />
        <Route path="*" element={<Navigate to="/field" replace />} />
      </Routes>
    </FieldLayout>
  )
}
