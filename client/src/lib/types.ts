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
  discountPct?: number
  shared?: boolean
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
export type LeadSource = 'manual' | 'whatsapp' | 'referral' | 'walk_in' | 'other'
export type DurationUnit = 'week' | 'month'

export interface LeadComment {
  _id: string
  user: { _id: string; name: string; email: string }
  userName: string
  text: string
  createdAt: string
}

export interface LeadTimelineEntry {
  _id?: string
  at: string
  type: string
  text: string
  user?: string
}

export interface Lead {
  _id: string
  firstName?: string
  lastName?: string
  fullName: string
  email?: string
  phone: string
  whatsappNo?: string
  phoneNormalized: string
  preferredContact?: 'email' | 'whatsapp'
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
  labels?: string[]
  comments?: LeadComment[]
  timeline?: LeadTimelineEntry[]
  createdAt?: string
}

export interface IntegrationStatus {
  zoho: { configured: boolean }
  drive: { configured: boolean; folderId?: string; method?: string }
  gmail: { configured: boolean }
  whatsapp: { configured: boolean; missing?: string[] }
  googleContacts: { configured: boolean; missing?: string[] }
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled'

export interface QuoteItem {
  sortOrder: number
  itemDetails: string
  quantity: number
  rate: number
  discountPct: number
  amount: number
}

export interface QuoteUnit {
  unit: string | { _id: string; unitNumber: string; sizeSqf: number; floor: string; price: number; status: string }
  unitNumber: string
  sizeSqf: number
  floor: string
  startDate: string
  endDate: string
  rate: number
  discountPct: number
  amount: number
}

export interface QuoteAddOn {
  name: string
  description?: string
  quantity: number
  rate: number
  amount: number
}

export interface QuoteTimelineEntry {
  at?: string
  type?: string
  text?: string
  user?: string | { _id: string; name: string; email: string }
}

export interface Quote {
  _id: string
  quoteNo: string
  quoteDate: string
  creationDate: string
  salesperson?: string
  expiryDate: string
  pdfTemplate: string
  customer: { _id: string; fullName: string; email?: string; phone?: string }
  lead?: { _id: string; fullName: string; phone?: string; email?: string } | string
  billingPeriod?: 'weekly' | 'monthly'
  billingAddress?: string
  shippingAddress?: string
  subject?: string
  items: QuoteItem[]
  units?: QuoteUnit[]
  addOns?: QuoteAddOn[]
  deposit?: number
  subTotal: number
  adjustment: number
  total: number
  notes?: string
  status: QuoteStatus
  contract?: { _id: string; contractNo: string; status?: string; approvalStatus?: string } | string
  flowStep?: number
  flowStepsDone?: boolean[]
  assignedTo?: string | { _id: string; name: string; email: string }
  timeline?: QuoteTimelineEntry[]
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
  description?: string
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
  vatEnabled?: boolean
  vatPct?: number
  vatAmount?: number
  total: number
  paymentMade?: number
  paymentHistory?: InvoicePaymentEntry[]
  termsAndConditions?: string
  attachments: InvoiceAttachment[]
  status: InvoiceStatus
  createdAt?: string
  // Zoho Books sync
  zohoBooksSyncId?: string | null
  zohoBooksSyncedAt?: string | null
  zohoBooksSyncError?: string | null
}

export interface Product {
  _id: string
  name: string
  description?: string
  rate: number
  unit?: string
  isActive: boolean
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
  discountType?: string
  discount?: number
  discountAmount?: number
  amount: number
  taxAmount?: number
  account?: string
  accountCode?: string
  sku?: string
  isBillable?: boolean
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
  billId?: string
  orderNumber?: string
  purchaseOrderRef?: string
  purchaseDate: string
  terms?: string
  dueDate?: string
  purchaser?: string
  bankInformation?: string
  subject?: string
  vendor?: { _id: string; contactName: string; companyName?: string; email?: string; phone?: string }
  vendorName?: string
  items: PurchaseItem[]
  vendorNotes?: string
  subTotal: number
  total: number
  paymentMade?: number
  paymentHistory?: PurchasePaymentEntry[]
  termsAndConditions?: string
  attachments: PurchaseAttachment[]
  status: PurchaseStatus
  categories?: string[]
  source?: string
  currencyCode?: string
  exchangeRate?: number
  taxAmount?: number
  taxName?: string
  taxPercentage?: number
  taxType?: string
  adjustment?: number
  adjustmentDescription?: string
  billType?: string
  isInclusiveTax?: boolean
  entityDiscountPercent?: number
  entityDiscountAmount?: number
  customerName?: string
  projectName?: string
  submittedBy?: string
  approvedBy?: string
  submittedDate?: string
  approvedDate?: string
  tinNumber?: string
  legalName?: string
  createdAt?: string
}

export interface Expense {
  _id: string
  expenseDate: string
  expenseType?: string
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
  attachments?: PurchaseAttachment[]
  importedAt?: string
  createdAt?: string
  // Zoho Books sync
  zohoBooksSyncId?: string | null
  zohoBooksSyncedAt?: string | null
  zohoBooksSyncError?: string | null
}

export type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'ended' | 'cancelled'

export interface ContractNote {
  at: string
  text: string
  author: string
}

export interface Contract {
  _id: string
  contractNo: string
  customer: Customer
  unit: Unit
  units?: Unit[]
  documentCount?: number
  paymentStatus?: 'paid' | 'partial' | 'unpaid' | 'no_invoice'
  paidAmount?: number
  totalAmount?: number
  contractAmount?: number
  overdueCount?: number
  billingPeriod: 'weekly' | 'monthly'
  rate: number
  deposit: number
  startDate: string
  endDate: string
  status: ContractStatus
  archived?: boolean
  zohoRequestId?: string
  signedDocUrl?: string
  paymentMethod?: string
  firstPaymentDate?: string
  nextPaymentDate?: string
  authorizedPersons?: AccessPerson[]
  notes?: string
  timeline?: ContractNote[]
  quote?: { _id: string; quoteNo: string; status?: string } | string
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approvalNote?: string
  approvedBy?: string
  approvedAt?: string
  source?: string
  totalQuotation?: number
  firstMonthDiscountPct?: number
  createdAt?: string
}

export type PaymentStatus = 'pending' | 'paid' | 'overdue'

export interface Payment {
  _id: string
  contract: Contract
  invoice?: { _id: string; invoiceNo: string; status: InvoiceStatus; dueDate: string; total: number }
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
  moveInsThisMonth: number
  moveInsLastMonth: number
  moveOutsThisMonth: number
  moveOutsLastMonth: number
  moveInsList: Contract[]
  moveOutsList: Contract[]
  availableUnitsList: { _id: string; unitNumber: string; floor: string; sizeSqf: number; monthlyRent: number }[]
}

// ── Moving Business Types ────────────────────────────────────────────────────

export type WorkerRole = 'driver' | 'helper' | 'supervisor' | 'packer'
export type WorkerStatus = 'active' | 'inactive' | 'on_leave'

export interface Worker {
  _id: string
  name: string
  phone?: string
  email?: string
  role: WorkerRole
  dailyRate: number
  status: WorkerStatus
  notes?: string
  emergencyContact?: string
  createdAt?: string
}

export type TruckType = 'small' | 'medium' | 'large' | 'extra_large'
export type TruckStatus = 'available' | 'in_use' | 'maintenance'

export interface Truck {
  _id: string
  name: string
  plateNumber?: string
  type: TruckType
  capacityCbm?: number
  dailyRate?: number
  status: TruckStatus
  lastServiceDate?: string
  nextServiceDate?: string
  notes?: string
  createdAt?: string
}

export type MovingLeadStatus = 'new' | 'contacted' | 'quoted' | 'client_approved' | 'won' | 'lost'
export type MovingLeadSource = 'phone' | 'web_form' | 'mobile_app' | 'whatsapp' | 'referral' | 'walk_in' | 'other'

export interface MovingLead {
  _id: string
  customer?: { _id: string; fullName: string; phone?: string; email?: string }
  prospectName?: string
  prospectPhone?: string
  prospectEmail?: string
  source: MovingLeadSource
  status: MovingLeadStatus
  serviceType?: string
  propertyType?: string
  moveDate?: string
  pickupAddress?: string
  deliveryAddress?: string
  estimatedVolumeCbm?: number
  notes?: string
  images?: { url: string; filename?: string; originalName?: string; size?: number; category?: string }[]
  quotation?: {
    items: { description: string; qty: number; rate: number; amount: number }[]
    subTotal: number
    discount: number
    total: number
    notes?: string
    quotedAt?: string
    quotedBy?: string
  }
  timeline?: ContractNote[]
  createdAt?: string
}

export type MovingJobStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'
export type MovingJobType = 'local' | 'inter_emirate' | 'international' | 'office' | 'storage_to_home' | 'other'

export interface MovingJobCrewMember {
  worker: Worker | { _id: string; name: string; phone?: string; role: string }
  role?: string
  dailyRate?: number
  days?: number
  extraHours?: number
  extraHourRate?: number
  isSupervisor?: boolean
}

export type ExternalHireDuration = 'quarter_day' | 'half_day' | 'full_day' | 'custom'

export interface MovingJobExternalHire {
  title: string
  name?: string
  duration: ExternalHireDuration
  hours: number
  rate: number
  cost: number
  notes?: string
}

export interface MovingJobMaterial {
  item: { _id: string; name: string; sku?: string } | string
  qty: number
  unitCost: number
  notes?: string
}

export interface MovingJobTruck {
  truck: Truck | { _id: string; name: string; plateNumber?: string; type: string }
  dailyRate?: number
  days?: number
  notes?: string
}

export interface MovingJobCosts {
  labor?: number
  truck?: number
  materials?: number
  externalHires?: number
  packing?: number
  extras?: number
  total?: number
}

export interface MovingJobImage {
  _id?: string
  url: string
  filename?: string
  originalName?: string
  size?: number
  category?: string
  storage?: 'local' | 'drive'
  driveFileId?: string
  uploadedAt?: string
}

export interface MovingJob {
  _id: string
  jobNo: string
  customer: { _id: string; fullName: string; phone?: string; email?: string }
  lead?: { _id: string }
  status: MovingJobStatus
  jobType?: MovingJobType
  pickupAddress?: string
  pickupFloor?: string
  pickupHasElevator?: boolean
  deliveryAddress?: string
  deliveryFloor?: string
  deliveryHasElevator?: boolean
  scheduledDate?: string
  scheduledTimeSlot?: string
  estimatedDurationHours?: number
  moveOutPermitRequired?: boolean
  crew?: MovingJobCrewMember[]
  trucks?: MovingJobTruck[]
  teamLead?: Worker | { _id: string; name: string }
  materialUsage?: MovingJobMaterial[]
  externalHires?: MovingJobExternalHire[]
  extraCharges?: Array<{ description: string; amount: number; notes?: string }>
  costs?: MovingJobCosts
  survey?: { _id: string; totalEstimatedVolumeCbm?: number; recommendedTruckType?: string }
  quote?: { _id: string; quoteNo: string; status: string; total: number }
  invoice?: { _id: string; invoiceNo: string; status: string; total: number; balanceDue: number }
  images?: MovingJobImage[]
  fieldPriceOverride?: { amount?: number; notes?: string; supervisorName?: string; adjustedAt?: string }
  clientPackage?: {
    packageType?: string
    label?: string
    agreedPrice?: number
    additionalCharges?: Array<{ description: string; amount: number }>
    notes?: string
  }
  notes?: string
  timeline?: ContractNote[]
  dispatchNotes?: string
  createdAt?: string
}

export interface MovingQuoteItem {
  description: string
  subDescription?: string
  qty: number
  rate: number
  amount: number
}

export type MovingQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'

export interface MovingQuote {
  _id: string
  quoteNo: string
  job?: { _id: string; jobNo: string; status: string; pickupAddress?: string; deliveryAddress?: string; scheduledDate?: string }
  customer: { _id: string; fullName: string; email?: string; phone?: string; address?: string }
  status: MovingQuoteStatus
  quoteDate: string
  expiryDate?: string
  items: MovingQuoteItem[]
  subTotal: number
  discount?: number
  total: number
  depositRequired?: boolean
  depositPct?: number
  notes?: string
  termsAndConditions?: string
  salesperson?: string
  shareToken?: string
  createdAt?: string
}

export interface MovingPaymentEntry {
  date: string
  amount: number
  method: string
  notes?: string
  receivedBy?: string
}

export type MovingInvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'cancelled'

// ── Payment Reminder Types ────────────────────────────────────────────────────

export interface ReminderStage {
  name: string
  daysBeforeDue: number
  frequencyDays: number
  message: string
  channel: 'both' | 'whatsapp' | 'email'
}

export interface ReminderConfig {
  _id?: string
  enabled: boolean
  startDay: number
  emailEnabled: boolean
  whatsappEnabled: boolean
  stages: ReminderStage[]
}

export interface ReminderLog {
  _id: string
  payment: string
  contract: string
  customer: string | { _id: string; fullName: string }
  channel: 'whatsapp' | 'email'
  stage: number
  sentAt: string
  message: string
  success: boolean
  error?: string
}

export interface MovingInvoice {
  _id: string
  invoiceNo: string
  job?: { _id: string; jobNo: string; status: string; pickupAddress?: string; deliveryAddress?: string; scheduledDate?: string }
  customer: { _id: string; fullName: string; email?: string; phone?: string; address?: string }
  status: MovingInvoiceStatus
  invoiceDate: string
  dueDate?: string
  items: MovingQuoteItem[]
  subTotal: number
  total: number
  depositPaid: number
  balanceDue: number
  paymentHistory?: MovingPaymentEntry[]
  bankInformation?: string
  notes?: string
  termsAndConditions?: string
  shareToken?: string
  zohoBooksSyncId?: string
  zohoBooksSyncedAt?: string
  zohoBooksSyncError?: string
  createdAt?: string
}
