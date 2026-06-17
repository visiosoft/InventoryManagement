export interface UnitType {
  _id: string
  sizeSqf: number
  label?: string
  monthlyRate: number
  weeklyRate: number
  discountPct: number
  createdAt?: string
}

export type UnitStatus = 'available' | 'occupied' | 'reserved' | 'maintenance'

export interface Unit {
  _id: string
  unitNumber: string
  floor: string
  sizeSqf: number | null
  price: number | null
  lengthFt: number | null
  widthFt: number | null
  status: UnitStatus
  notes?: string
}

export interface AccessPerson {
  name: string
  phone?: string
  relation?: string
  idType?: string
  idNumber?: string
}

export interface Customer {
  _id: string
  fullName: string
  clientId?: string
  tenantType?: 'individual' | 'company'
  email?: string
  phone?: string
  phones?: string[]
  emergencyNumber?: string
  nationality?: string
  address?: string
  company?: string
  emiratesId?: string
  eidExpiry?: string
  passportNumber?: string
  passportExpiry?: string
  accessPersons?: AccessPerson[]
  notes?: string
  createdAt?: string
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'won' | 'lost'
export type LeadSource = 'manual' | 'google_contacts' | 'whatsapp' | 'referral' | 'walk_in' | 'other'
export type DurationUnit = 'week' | 'month'

export interface Lead {
  _id: string
  fullName: string
  email?: string
  phone: string
  phoneNormalized: string
  status: LeadStatus
  source: LeadSource
  leadDateTime: string
  storageSizeValue: number
  storageSizeUnit: 'sqft'
  durationValue: number
  durationUnit: DurationUnit
  owner: { _id: string; name: string; email: string }
  unitsNeeded: number
  notes?: string
  createdAt?: string
}

export interface IntegrationStatus {
  zoho: { configured: boolean }
  drive: { configured: boolean }
  whatsapp: { configured: boolean; missing?: string[] }
  googleContacts: { configured: boolean; missing?: string[] }
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface QuoteItem {
  sortOrder: number
  itemDetails: string
  quantity: number
  rate: number
  discountPct: number
  amount: number
}

export interface Quote {
  _id: string
  quoteNo: string
  quoteDate: string
  creationDate: string
  salesperson?: string
  expiryDate: string
  pdfTemplate: string
  customer: { _id: string; fullName: string; email?: string }
  billingAddress?: string
  shippingAddress?: string
  subject?: string
  items: QuoteItem[]
  subTotal: number
  adjustment: number
  total: number
  notes?: string
  status: QuoteStatus
  createdAt?: string
}

export interface InvoicePaymentEntry {
  date: string
  amount: number
  method: string
  notes?: string
}

export interface InvoiceItem {
  sortOrder: number
  itemDetails: string
  quantity: number
  rate: number
  discountPct: number
  amount: number
}

export interface InvoiceAttachment {
  name: string
  mimeType?: string
  size?: number
  storage: 'drive' | 'local'
  driveFileId?: string
  url: string
}

export interface Invoice {
  _id: string
  invoiceNo: string
  orderNumber?: string
  invoiceDate: string
  terms?: string
  dueDate: string
  salesperson?: string
  bankInformation?: string
  subject?: string
  customer: { _id: string; fullName: string; email?: string; phone?: string; address?: string }
  items: InvoiceItem[]
  customerNotes?: string
  subTotal: number
  total: number
  paymentMade?: number
  paymentHistory?: InvoicePaymentEntry[]
  termsAndConditions?: string
  attachments: InvoiceAttachment[]
  status: InvoiceStatus
  createdAt?: string
}

export type VendorStatus = 'active' | 'inactive'

export interface VendorAddress {
  attention?: string
  address?: string
  street2?: string
  city?: string
  state?: string
  country?: string
  code?: string
  phone?: string
  fax?: string
}

export interface Vendor {
  _id: string
  contactId: string
  contactName: string
  companyName?: string
  displayName?: string
  email?: string
  phone?: string
  mobilePhone?: string
  currencyCode?: string
  status: VendorStatus
  notes?: string
  website?: string
  paymentTermsLabel?: string
  paymentTerms?: number
  openingBalance?: number
  ownerName?: string
  source?: string
  categories?: string[]
  billingAddress?: VendorAddress
  shippingAddress?: VendorAddress
  createdAt?: string
}

export interface PurchasePaymentEntry {
  date: string
  amount: number
  method: string
  notes?: string
}

export type PurchaseStatus = 'draft' | 'sent' | 'received' | 'partial' | 'cancelled'
export type ExpenseStatus = 'recorded' | 'approved' | 'paid' | 'reimbursed' | 'cancelled'

export interface PurchaseItem {
  sortOrder: number
  itemDetails: string
  quantity: number
  rate: number
  discountPct: number
  amount: number
}

export interface PurchaseAttachment {
  name: string
  mimeType?: string
  size?: number
  storage: 'drive' | 'local'
  driveFileId?: string
  url: string
}

export interface Purchase {
  _id: string
  purchaseNo: string
  orderNumber?: string
  purchaseDate: string
  terms?: string
  dueDate: string
  purchaser?: string
  bankInformation?: string
  subject?: string
  vendor: { _id: string; contactName: string; companyName?: string; email?: string; phone?: string }
  items: PurchaseItem[]
  vendorNotes?: string
  subTotal: number
  total: number
  paymentMade?: number
  paymentHistory?: PurchasePaymentEntry[]
  termsAndConditions?: string
  attachments: PurchaseAttachment[]
  status: PurchaseStatus
  createdAt?: string
}

export interface Expense {
  _id: string
  expenseDate: string
  description?: string
  expenseAccount: string
  expenseAccountCode?: string
  paidThrough?: string
  paidThroughAccountCode?: string
  vendor?: { _id: string; contactName: string; companyName?: string; email?: string; phone?: string }
  vendorName?: string
  projectName?: string
  entryNumber?: number
  currencyCode?: string
  exchangeRate?: number
  isInclusiveTax?: boolean
  mileageRate?: number
  mileageUnit?: string
  distance?: number
  startOdometerReading?: number
  endOdometerReading?: number
  mileageType?: string
  vehicleName?: string
  claimantEmail?: string
  taxName?: string
  taxPercentage?: number
  taxType?: string
  taxAmount?: number
  expenseAmount?: number
  total: number
  referenceNo?: string
  isBillable?: boolean
  customerName?: string
  expenseReferenceId?: string
  recurrenceName?: string
  expenseReportName?: string
  isReimbursable?: boolean
  categories?: string[]
  status: ExpenseStatus
  source?: 'manual' | 'import_csv'
  importedAt?: string
  createdAt?: string
}

export type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'ended' | 'cancelled'

export interface Contract {
  _id: string
  contractNo: string
  customer: Customer
  unit: Unit
  units?: Unit[]
  billingPeriod: 'weekly' | 'monthly'
  rate: number
  deposit: number
  startDate: string
  endDate: string
  autoRenew: boolean
  status: ContractStatus
  zohoRequestId?: string
  signedDocUrl?: string
  paymentMethod?: string
  firstPaymentDate?: string
  nextPaymentDate?: string
  authorizedPersons?: AccessPerson[]
  notes?: string
  createdAt?: string
}

export type PaymentStatus = 'pending' | 'paid' | 'overdue'

export interface Payment {
  _id: string
  contract: Contract
  amount: number
  dueDate: string
  paidDate?: string
  method?: string
  status: PaymentStatus
  notes?: string
}

export interface AppDocument {
  _id: string
  contract?: { _id: string; contractNo: string }
  customer?: { _id: string; fullName: string }
  name: string
  type: 'contract' | 'id_proof' | 'other'
  storage: 'drive' | 'local'
  driveFileId?: string
  url: string
  createdAt?: string
}

export interface Summary {
  totalUnits: number
  byStatus: Record<UnitStatus, number>
  bySize: { sizeSqf: string; total: number; available: number; occupied: number; maintenance: number }[]
  byFloor: { floor: string; total: number; available: number; occupied: number; maintenance: number }[]
  occupancyPct: number
  activeContracts: number
  revenueThisMonth: number
  expectedThisMonth: number
  expiringContracts: Contract[]
  overduePayments: Payment[]
}
