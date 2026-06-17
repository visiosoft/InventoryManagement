import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
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
        <Route path="/payments" element={<Payments />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
