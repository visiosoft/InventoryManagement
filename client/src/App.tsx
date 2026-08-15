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

function SmartHome() {
  const { hasPermission } = useAuth()
  const hasMoving = hasPermission('moving_dashboard')
  const hasStorage = hasPermission('units') || hasPermission('dashboard')
  const isMovingOnly = hasMoving && !hasStorage
  if (isMovingOnly) {
    return <Navigate to="/moving" replace />
  }
  return <Dashboard />
}
import Layout from './components/Layout'
import Login from './pages/Login'
import SignContract from './pages/SignContract'
import Dashboard from './pages/Dashboard'
import Units from './pages/Units'
import FloorMap from './pages/FloorMap'
import Sites from './pages/Sites'
import Customers from './pages/Customers'
import CustomerContractRedirect from './pages/CustomerContractRedirect'
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
import IncomeAnalysis from './pages/reports/IncomeAnalysis'
import Settings from './pages/Settings'
import MessageTemplates from './pages/MessageTemplates'
import AgreementTemplate from './pages/AgreementTemplate'
import ZohoComparison from './pages/ZohoComparison'
import Backup from './pages/Backup'
import Leads from './pages/Leads'
import SalesBoard from './pages/SalesBoard'
import Quotations from './pages/Quotations'
import Quotes from './pages/Quotes'
import NewQuote from './pages/NewQuote'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Vendors from './pages/Vendors'
import VendorDetail from './pages/VendorDetail'
import Purchases from './pages/Purchases'
import PurchaseDetail from './pages/PurchaseDetail'
import Expenses from './pages/Expenses'
import MovingInventory from './pages/MovingInventory'
import UserManagement from './pages/UserManagement'
import SalesTeam from './pages/SalesTeam'
import WhatsApp from './pages/WhatsApp'
import WhatsAppSetup from './pages/WhatsAppSetup'
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
import MovingInvoices from './pages/moving/MovingInvoices'
import MovingInvoiceDetail from './pages/moving/MovingInvoiceDetail'
import MovingQuotes from './pages/moving/MovingQuotes'
import MovingQuoteDetail from './pages/moving/MovingQuoteDetail'
import MovingClaims from './pages/moving/MovingClaims'
import MovingReportsHub from './pages/moving/MovingReportsHub'
import MovingRevenueReport from './pages/moving/reports/MovingRevenueReport'
import MovingArReport from './pages/moving/reports/MovingArReport'
import MovingCostsReport from './pages/moving/reports/MovingCostsReport'
import MovingProfitabilityReport from './pages/moving/reports/MovingProfitabilityReport'
import MovingPipelineReport from './pages/moving/reports/MovingPipelineReport'
import MovingCrewReport from './pages/moving/reports/MovingCrewReport'
import MovingFleetReport from './pages/moving/reports/MovingFleetReport'
import MovingPayrollReport from './pages/moving/reports/MovingPayrollReport'
import MovingClaimsReport from './pages/moving/reports/MovingClaimsReport'
import MovingStripePaymentsReport from './pages/moving/reports/MovingStripePaymentsReport'
import SiteVisits from './pages/moving/SiteVisits'
import MovingSurveyDetail from './pages/moving/MovingSurveyDetail'
import ClientUpload from './pages/moving/ClientUpload'
import PaySuccess from './pages/PaySuccess'
import SharedJobView from './pages/moving/SharedJobView'
import FieldLogin from './pages/field/FieldLogin'
import FieldApp from './pages/field/FieldApp'
import ReminderSettings from './pages/ReminderSettings'
import AutomationRules from './pages/AutomationRules'
import Approvals from './pages/Approvals'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import PortalLogin from './pages/portal/PortalLogin'
import PortalApp from './pages/portal/PortalApp'
import { CustomerAuthProvider } from './lib/customerAuth'

export default function App() {
  const { user } = useAuth()

  if (location.pathname.startsWith('/portal')) {
    return (
      <CustomerAuthProvider>
        <Routes>
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal/*" element={<PortalApp />} />
        </Routes>
      </CustomerAuthProvider>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/sign/:token" element={<SignContract />} />
        <Route path="/upload/moving/:token" element={<ClientUpload />} />
        <Route path="/share/job/:token" element={<SharedJobView />} />
        <Route path="/pay/success" element={<PaySuccess />} />
        <Route path="/field/login" element={<FieldLogin />} />
        <Route path="/field/*" element={<FieldApp />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/sign/:token" element={<SignContract />} />
      <Route path="/upload/moving/:token" element={<ClientUpload />} />
      <Route path="/share/job/:token" element={<SharedJobView />} />
      <Route path="/pay/success" element={<PaySuccess />} />
      <Route path="/field/login" element={<Navigate to="/field" replace />} />
      <Route path="/field/*" element={<FieldApp />} />
      <Route element={<Layout />}>
        <Route path="/" element={<SmartHome />} />
        <Route path="/units" element={<Units />} />
        <Route path="/floor-map" element={<PermGuard module="units"><FloorMap /></PermGuard>} />
        <Route path="/sites" element={<PermGuard module="units"><Sites /></PermGuard>} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerContractRedirect />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/my-leads" element={<PermGuard module="sales_board"><SalesBoard /></PermGuard>} />
        <Route path="/quotes" element={<PermGuard module="quotes"><Quotations /></PermGuard>} />
        <Route path="/quotes/new" element={<PermGuard module="quotes"><NewQuote /></PermGuard>} />
        <Route path="/quotations" element={<PermGuard module="quotes"><Quotes /></PermGuard>} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/:id" element={<VendorDetail />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/purchases/:id" element={<PurchaseDetail />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/moving-inventory" element={<MovingInventory />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/new" element={<NewContract />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/payments" element={<PermGuard module="payments"><Payments /></PermGuard>} />
        <Route path="/documents" element={<PermGuard module="documents"><Documents /></PermGuard>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/monthly" element={<PermGuard module="reports_monthly"><MonthlyReport /></PermGuard>} />
        <Route path="/reports/units" element={<PermGuard module="reports_units"><UnitsReport /></PermGuard>} />
        <Route path="/reports/finances" element={<PermGuard module="reports_finances"><FinancesReport /></PermGuard>} />
        <Route path="/reports/forecast" element={<PermGuard module="reports_forecast"><ForecastReport /></PermGuard>} />
        <Route path="/reports/contracts" element={<PermGuard module="reports_contracts"><ContractsReport /></PermGuard>} />
        <Route path="/reports/vacancies" element={<PermGuard module="reports_vacancies"><UpcomingVacanciesReport /></PermGuard>} />
        <Route path="/reports/overdue" element={<PermGuard module="reports_overdue"><OverduePaymentsReport /></PermGuard>} />
        <Route path="/reports/expiring" element={<PermGuard module="reports_expiring"><ExpiringContractsReport /></PermGuard>} />
        <Route path="/reports/income" element={<PermGuard module="reports_finances"><IncomeAnalysis /></PermGuard>} />
        <Route path="/approvals" element={<AdminGuard><Approvals /></AdminGuard>} />
        <Route path="/users" element={<AdminGuard><UserManagement /></AdminGuard>} />
        <Route path="/sales-team" element={<AdminGuard><SalesTeam /></AdminGuard>} />
        <Route path="/backup" element={<AdminGuard><Backup /></AdminGuard>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/templates" element={<AdminGuard><MessageTemplates /></AdminGuard>} />
        <Route path="/settings/agreement" element={<AdminGuard><AgreementTemplate /></AdminGuard>} />
        <Route path="/zoho-comparison" element={<AdminGuard><ZohoComparison /></AdminGuard>} />
        <Route path="/settings/reminders" element={<AdminGuard><ReminderSettings /></AdminGuard>} />
        <Route path="/settings/automation" element={<AdminGuard><AutomationRules /></AdminGuard>} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="/whatsapp/setup" element={<AdminGuard><WhatsAppSetup /></AdminGuard>} />

        {/* ── Moving Business ── */}
        <Route path="/moving" element={<PermGuard module="moving_dashboard"><MovingDashboard /></PermGuard>} />
        <Route path="/moving/leads" element={<PermGuard module="moving_leads"><MovingLeads /></PermGuard>} />
        <Route path="/moving/leads/:id" element={<PermGuard module="moving_leads"><MovingLeadDetail /></PermGuard>} />
        <Route path="/moving/jobs" element={<PermGuard module="moving_jobs"><MovingJobs /></PermGuard>} />
        <Route path="/moving/jobs/new" element={<PermGuard module="moving_jobs"><NewMovingJob /></PermGuard>} />
        <Route path="/moving/jobs/:id" element={<PermGuard module="moving_jobs"><MovingJobDetail /></PermGuard>} />
        <Route path="/moving/jobs/:id/survey" element={<PermGuard module="moving_jobs"><MovingSurveyDetail /></PermGuard>} />
        <Route path="/moving/schedule" element={<PermGuard module="moving_schedule"><MovingSchedule /></PermGuard>} />
        <Route path="/moving/dispatch" element={<PermGuard module="moving_dispatch"><MovingDispatch /></PermGuard>} />
        <Route path="/moving/workers" element={<PermGuard module="moving_workers"><Workers /></PermGuard>} />
        <Route path="/moving/fleet" element={<PermGuard module="moving_fleet"><Fleet /></PermGuard>} />
        <Route path="/moving/quotes" element={<PermGuard module="moving_jobs"><MovingQuotes /></PermGuard>} />
        <Route path="/moving/quotes/:id" element={<PermGuard module="moving_jobs"><MovingQuoteDetail /></PermGuard>} />
        <Route path="/moving/invoices" element={<PermGuard module="moving_invoices"><MovingInvoices /></PermGuard>} />
        <Route path="/moving/invoices/:id" element={<PermGuard module="moving_invoices"><MovingInvoiceDetail /></PermGuard>} />
        <Route path="/moving/visits" element={<PermGuard module="moving_jobs"><SiteVisits /></PermGuard>} />
        <Route path="/moving/claims" element={<PermGuard module="moving_dashboard"><MovingClaims /></PermGuard>} />
        <Route path="/moving/reports" element={<PermGuard module="moving_dashboard"><MovingReportsHub /></PermGuard>} />
        <Route path="/moving/reports/ar" element={<PermGuard module="reports_moving_ar"><MovingArReport /></PermGuard>} />
        <Route path="/moving/reports/revenue" element={<PermGuard module="reports_moving_revenue"><MovingRevenueReport /></PermGuard>} />
        <Route path="/moving/reports/costs" element={<PermGuard module="reports_moving_costs"><MovingCostsReport /></PermGuard>} />
        <Route path="/moving/reports/profitability" element={<PermGuard module="reports_moving_profitability"><MovingProfitabilityReport /></PermGuard>} />
        <Route path="/moving/reports/pipeline" element={<PermGuard module="reports_moving_pipeline"><MovingPipelineReport /></PermGuard>} />
        <Route path="/moving/reports/crew" element={<PermGuard module="reports_moving_crew"><MovingCrewReport /></PermGuard>} />
        <Route path="/moving/reports/fleet" element={<PermGuard module="reports_moving_fleet"><MovingFleetReport /></PermGuard>} />
        <Route path="/moving/reports/payroll" element={<PermGuard module="reports_moving_payroll"><MovingPayrollReport /></PermGuard>} />
        <Route path="/moving/reports/claims" element={<PermGuard module="moving_dashboard"><MovingClaimsReport /></PermGuard>} />
        <Route path="/moving/reports/stripe-payments" element={<PermGuard module="reports_moving_stripe"><MovingStripePaymentsReport /></PermGuard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
