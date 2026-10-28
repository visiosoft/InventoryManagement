import { PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'
import ZohoCompareCard from '../components/ZohoCompareCard'
import ZohoPaymentSyncCard from '../components/ZohoPaymentSyncCard'
import DuplicatePaymentsCard from '../components/DuplicatePaymentsCard'

/** Keeping the CRM and Zoho Books in step: contacts, payments taken in Zoho, and the receivables they settle. */
export default function Zoho() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  return (
    <div className="space-y-8">
      <PageHeader title="Zoho" subtitle="CRM and Zoho Books, side by side" />
      <ZohoCompareCard />
      {/* Applying payments and voiding duplicates change money rows: admins only, as the server enforces. */}
      {isAdmin && <ZohoPaymentSyncCard />}
      {isAdmin && <DuplicatePaymentsCard />}
    </div>
  )
}
