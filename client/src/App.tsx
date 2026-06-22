import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'

/** Renders children only if the user has the given module permission (or is admin). Otherwise redirects home. */
function PermGuard({ module, children }: { module: string; children: React.ReactNode }) {
  const { hasPermission } = useAuth()
  return hasPermission(module) ? <>{children}</> : <Navigate to="/" replace />
}

/** Admin-only guard */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />
}
import Layout from './components/Layout'
import Login from './pages/Login'
import SignContract from './pages/SignContract'
import Dashboard from './pages/Dashboard'
import Units from './pages/Units'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import NewContract from './pages/NewContract'
import Payments from './pages/Payments'
import Documents from './pages/Documents'
import Reports from './pages/Reports'
import MonthlyReport from './pages/reports/MonthlyReport'
import UnitsReport from './pages/reports/UnitsReport'
import FinancesReport from './pages/reports/FinancesReport'
import ForecastReport from './pages/reports/ForecastReport'
import ContractsReport from './pages/reports/ContractsReport'
import UpcomingVacanciesReport from './pages/reports/UpcomingVacanciesReport'
import OverduePaymentsReport from './pages/reports/OverduePaymentsReport'
import ExpiringContractsReport from './pages/reports/ExpiringContractsReport'
import Settings from './pages/Settings'
import Leads from './pages/Leads'
import Quotes from './pages/Quotes'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Vendors from './pages/Vendors'
import VendorDetail from './pages/VendorDetail'
import Purchases from './pages/Purchases'
import Expenses from './pages/Expenses'
import MovingInventory from './pages/MovingInventory'
import UserManagement from './pages/UserManagement'
import WhatsApp from './pages/WhatsApp'
import MovingDashboard from './pages/moving/MovingDashboard'
import MovingLeads from './pages/moving/MovingLeads'
import MovingLeadDetail from './pages/moving/MovingLeadDetail'
import MovingJobs from './pages/moving/MovingJobs'
import MovingJobDetail from './pages/moving/MovingJobDetail'
import NewMovingJob from './pages/moving/NewMovingJob'
import MovingSchedule from './pages/moving/MovingSchedule'
import MovingDispatch from './pages/moving/MovingDispatch'
import Workers from './pages/moving/Workers'
import Fleet from './pages/moving/Fleet'
import MovingQuotes from './pages/moving/MovingQuotes'
import MovingQuoteDetail from './pages/moving/MovingQuoteDetail'
import MovingInvoices from './pages/moving/MovingInvoices'
import MovingInvoiceDetail from './pages/moving/MovingInvoiceDetail'
import MovingRevenueReport from './pages/moving/reports/MovingRevenueReport'
import MovingJobsReport from './pages/moving/reports/MovingJobsReport'
import MovingCrewReport from './pages/moving/reports/MovingCrewReport'
import MovingFleetReport from './pages/moving/reports/MovingFleetReport'

export default function App() {
  const { user } = useAuth()

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sign/:token" element={<SignContract />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/sign/:token" element={<SignContract />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/units" element={<Units />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/:id" element={<VendorDetail />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/moving-inventory" element={<MovingInventory />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/new" element={<NewContract />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/payments" element={<PermGuard module="payments"><Payments /></PermGuard>} />
        <Route path="/documents" element={<PermGuard module="documents"><Documents /></PermGuard>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/monthly"   element={<PermGuard module="reports_monthly"><MonthlyReport /></PermGuard>} />
        <Route path="/reports/units"     element={<PermGuard module="reports_units"><UnitsReport /></PermGuard>} />
        <Route path="/reports/finances"  element={<PermGuard module="reports_finances"><FinancesReport /></PermGuard>} />
        <Route path="/reports/forecast"  element={<PermGuard module="reports_forecast"><ForecastReport /></PermGuard>} />
        <Route path="/reports/contracts" element={<PermGuard module="reports_contracts"><ContractsReport /></PermGuard>} />
        <Route path="/reports/vacancies" element={<PermGuard module="reports_vacancies"><UpcomingVacanciesReport /></PermGuard>} />
        <Route path="/reports/overdue"   element={<PermGuard module="reports_overdue"><OverduePaymentsReport /></PermGuard>} />
        <Route path="/reports/expiring"  element={<PermGuard module="reports_expiring"><ExpiringContractsReport /></PermGuard>} />
        <Route path="/users" element={<AdminGuard><UserManagement /></AdminGuard>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/whatsapp" element={<WhatsApp />} />

        {/* ── Moving Business ── */}
        <Route path="/moving" element={<PermGuard module="moving_dashboard"><MovingDashboard /></PermGuard>} />
        <Route path="/moving/leads" element={<PermGuard module="moving_leads"><MovingLeads /></PermGuard>} />
        <Route path="/moving/leads/:id" element={<PermGuard module="moving_leads"><MovingLeadDetail /></PermGuard>} />
        <Route path="/moving/jobs" element={<PermGuard module="moving_jobs"><MovingJobs /></PermGuard>} />
        <Route path="/moving/jobs/new" element={<PermGuard module="moving_jobs"><NewMovingJob /></PermGuard>} />
        <Route path="/moving/jobs/:id" element={<PermGuard module="moving_jobs"><MovingJobDetail /></PermGuard>} />
        <Route path="/moving/schedule" element={<PermGuard module="moving_schedule"><MovingSchedule /></PermGuard>} />
        <Route path="/moving/dispatch" element={<PermGuard module="moving_dispatch"><MovingDispatch /></PermGuard>} />
        <Route path="/moving/workers" element={<PermGuard module="moving_workers"><Workers /></PermGuard>} />
        <Route path="/moving/fleet" element={<PermGuard module="moving_fleet"><Fleet /></PermGuard>} />
        <Route path="/moving/quotes" element={<PermGuard module="moving_quotes"><MovingQuotes /></PermGuard>} />
        <Route path="/moving/quotes/:id" element={<PermGuard module="moving_quotes"><MovingQuoteDetail /></PermGuard>} />
        <Route path="/moving/invoices" element={<PermGuard module="moving_invoices"><MovingInvoices /></PermGuard>} />
        <Route path="/moving/invoices/:id" element={<PermGuard module="moving_invoices"><MovingInvoiceDetail /></PermGuard>} />
        <Route path="/moving/reports/revenue" element={<PermGuard module="reports_moving_revenue"><MovingRevenueReport /></PermGuard>} />
        <Route path="/moving/reports/jobs" element={<PermGuard module="reports_moving_jobs"><MovingJobsReport /></PermGuard>} />
        <Route path="/moving/reports/crew" element={<PermGuard module="reports_moving_crew"><MovingCrewReport /></PermGuard>} />
        <Route path="/moving/reports/fleet" element={<PermGuard module="reports_moving_fleet"><MovingFleetReport /></PermGuard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
