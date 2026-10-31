import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useOutletContext } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { SessionProvider, useSession } from './lib/session'
import { Login, Signup, Invite } from './pages/Auth'
import Shell from './pages/Shell'
import Overview from './pages/Overview'
import Review from './pages/Review'
import Knowledge from './pages/Knowledge'
import Imports from './pages/Imports'
import Tests from './pages/Tests'
import Sandbox from './pages/Sandbox'
import Scenarios from './pages/Scenarios'
import Settings from './pages/Settings'
import Platform from './pages/Platform'
import { PageTitle } from './pages/shared'
import type { Me } from './pages/theme'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false } } })

function Guarded() {
  const { user, loading } = useSession()
  if (loading) return null
  return user ? <Shell /> : <Navigate to="/login" replace />
}
function Public({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession()
  if (loading) return null
  return user ? <Navigate to="/" replace /> : <>{children}</>
}
function With({ title, sub, page: Page }: { title: string; sub: string; page: (p: { me: Me }) => React.ReactNode }) {
  const { me } = useOutletContext<{ me: Me }>()
  return <><PageTitle title={title} sub={sub} /><Page me={me} /></>
}
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  return user?.platformAdmin ? <>{children}</> : <Navigate to="/" replace />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Routes>
            <Route path="/login" element={<Public><Login /></Public>} />
            <Route path="/signup" element={<Public><Signup /></Public>} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route element={<Guarded />}>
              <Route index element={<Overview />} />
              <Route path="/review" element={<With title="Review" sub="Each common question with the answer the AI should give. Approve it, change it, or send it to a person." page={Review} />} />
              <Route path="/answers" element={<With title="Approved answers" sub="Every answer your business stands behind, with its versions. Nothing reaches an agent until it is published." page={Knowledge} />} />
              <Route path="/imports" element={<Imports />} />
              <Route path="/sandbox" element={<Sandbox />} />
              <Route path="/scenarios" element={<Scenarios />} />
              <Route path="/tests" element={<With title="Tests & go-live" sub="Score the agent on every approved scenario, check the graduation gates, and move it toward live customers one stage at a time." page={Tests} />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/platform" element={<AdminOnly><Platform /></AdminOnly>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
