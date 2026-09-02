import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'

/** Renders children only if the user has the given module permission (or is admin). Otherwise redirects home. */
function PermGuard({ module, orSalesRep, children }: { module: string; orSalesRep?: boolean; children: React.ReactNode }) {
  const { hasPermission, user } = useAuth()
  // Booking a unit is a rep's core job, but 'quotes' is not one of the
  // permissions reps are created with, so the role opens the door instead.
  // Accounts shares a rep's permissions but not this: they handle the money
  // after a booking, they do not take one. Hiding the sidebar entry alone
  // would leave the page a URL away.
  const allowed = hasPermission(module)
    // Accounts are in as readers: they invoice against what was booked, so the
    // booking screen is worth reading. Every write it makes is refused by the
    // server (readOnlyFor in middleware/auth.js), and the page hides the
    // buttons rather than letting them fail.
    || (orSalesRep && (user?.role === 'sales_rep' || user?.role === 'accounts'))
  return allowed ? <>{children}</> : <Navigate to="/" replace />
}

/** Admin-only guard */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />
}

/** Some screens are for a named set of roles rather than a module. */
function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth()
  return roles.includes(user?.role ?? '') ? <>{children}</> : <Navigate to="/" replace />
}

/** Tasks is a sales-rep/admin tool — staff don't get it. */
function TasksGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'admin' || isSalesRepRole(user?.role) ? <>{children}</> : <Navigate to="/" replace />
}

function SmartHome() {
  const { user, hasPermission } = useAuth()
  /* Accounts get their own dashboard: the company one answers a manager's
     questions, and their day is invoices, not occupancy. Checked before the
     sales-rep line below, which counts accounts as a rep-ish role. */
  if (user?.role === 'accounts') {
    return <AccountsDashboard />
  }
  // A rep's home is their own leads board, not the company-wide dashboard.
  if (isSalesRepRole(user?.role)) {
    return <Navigate to="/my-leads" replace />
  }
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
import SignMovingJob from './pages/SignMovingJob'
import Dashboard from './pages/Dashboard'
import Units from './pages/Units'
import FloorMap from './pages/FloorMap'
import Sites from './pages/Sites'
import Customers from './pages/Customers'
import PersonProfile from './pages/PersonProfile'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Payments from './pages/Payments'
import Documents from './pages/Documents'
import Reports from './pages/Reports'
import AskReports from './pages/reports/AskReports'
import DailyDigest from './pages/DailyDigest'
import RatesReport from './pages/reports/RatesReport'
import Settings from './pages/Settings'
import MessageTemplates from './pages/MessageTemplates'
import WhatsAppDebug from './pages/WhatsAppDebug'
import AgreementTemplate from './pages/AgreementTemplate'
import AiAssistant from './pages/AiAssistant'
import Marketing from './pages/Marketing'
import SentEmails from './pages/SentEmails'
import Walkthroughs from './pages/Walkthroughs'
import { WalkthroughProvider } from './walkthroughs/WalkthroughProvider'
import ZohoComparison from './pages/ZohoComparison'
import Backup from './pages/Backup'
import Leads from './pages/Leads'
import SalesBoard from './pages/SalesBoard'
import MovingEstimator from './pages/MovingEstimator'
import MyPerformance from './pages/MyPerformance'
import AccountsDashboard from './pages/AccountsDashboard'
import LeadDistribution from './pages/LeadDistribution'
import Leaderboard from './pages/Leaderboard'
import MyAccount from './pages/MyAccount'
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
import Tasks from './pages/Tasks'
import Diary from './pages/Diary'
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
import { isSalesRepRole } from './lib/roles'

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
        <Route path="/sign-moving/:token" element={<SignMovingJob />} />
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
    <WalkthroughProvider>
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/sign/:token" element={<SignContract />} />
      <Route path="/sign-moving/:token" element={<SignMovingJob />} />
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
        <Route path="/customers/:id" element={<PersonProfile />} />
        <Route path="/people/:id" element={<PersonProfile />} />
        {/* Accounts do not work leads, so the page is not theirs — hiding the
            sidebar entry alone would leave it a URL away. */}
        <Route path="/leads" element={<RoleGuard roles={['admin', 'staff', 'sales_rep']}><Leads /></RoleGuard>} />
        <Route path="/leads/:id" element={<PersonProfile />} />
        <Route path="/my-leads" element={<RoleGuard roles={['admin', 'staff', 'sales_rep']}><SalesBoard /></RoleGuard>} />
        <Route path="/moving-estimator" element={<PermGuard module="sales_board"><MovingEstimator /></PermGuard>} />
        <Route path="/my-performance" element={<PermGuard module="sales_board"><MyPerformance /></PermGuard>} />
        <Route path="/leaderboard" element={<PermGuard module="sales_board"><Leaderboard /></PermGuard>} />
        <Route path="/accounts" element={<RoleGuard roles={['admin', 'accounts']}><AccountsDashboard /></RoleGuard>} />
        <Route path="/settings/lead-distribution" element={<AdminGuard><LeadDistribution /></AdminGuard>} />
        <Route path="/account" element={<MyAccount />} />
        <Route path="/quotes" element={<PermGuard module="quotes" orSalesRep><Quotations /></PermGuard>} />
        <Route path="/quotes/new" element={<PermGuard module="quotes" orSalesRep><NewQuote /></PermGuard>} />
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
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/payments" element={<PermGuard module="payments"><Payments /></PermGuard>} />
        <Route path="/documents" element={<PermGuard module="documents"><Documents /></PermGuard>} />
        <Route path="/reports" element={<Reports />} />
        {/* Admin-only: a report here can reach revenue and every rep's numbers,
            and the server enforces the same rule. */}
        <Route path="/reports/ask" element={<RoleGuard roles={['admin', 'accounts']}><AskReports /></RoleGuard>} />
        <Route path="/reports/conversations" element={<PermGuard module="reports_conversations"><DailyDigest /></PermGuard>} />
        <Route path="/reports/rates" element={<PermGuard module="reports_units"><RatesReport /></PermGuard>} />
        <Route path="/approvals" element={<AdminGuard><Approvals /></AdminGuard>} />
        <Route path="/users" element={<AdminGuard><UserManagement /></AdminGuard>} />
        <Route path="/sales-team" element={<AdminGuard><SalesTeam /></AdminGuard>} />
        <Route path="/tasks" element={<TasksGuard><Tasks /></TasksGuard>} />
        <Route path="/diary" element={<Diary />} />
        <Route path="/backup" element={<AdminGuard><Backup /></AdminGuard>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/templates" element={<AdminGuard><MessageTemplates /></AdminGuard>} />
        <Route path="/settings/whatsapp-debug" element={<AdminGuard><WhatsAppDebug /></AdminGuard>} />
        <Route path="/settings/agreement" element={<AdminGuard><AgreementTemplate /></AdminGuard>} />
        <Route path="/zoho-comparison" element={<AdminGuard><ZohoComparison /></AdminGuard>} />
        <Route path="/settings/reminders" element={<AdminGuard><ReminderSettings /></AdminGuard>} />
        <Route path="/settings/automation" element={<AdminGuard><AutomationRules /></AdminGuard>} />
        <Route path="/settings/ai" element={<AdminGuard><AiAssistant /></AdminGuard>} />
        <Route path="/marketing" element={<AdminGuard><Marketing /></AdminGuard>} />
        <Route path="/settings/sent-emails" element={<AdminGuard><SentEmails /></AdminGuard>} />
        <Route path="/walkthroughs" element={<Walkthroughs />} />
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
    </WalkthroughProvider>
  )
}
