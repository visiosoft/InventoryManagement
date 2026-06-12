export interface UnitType {
  _id: string
  sizeSqf: number
  label?: string
  weeklyRate: number
  monthlyRate: number
}

export type UnitStatus = 'available' | 'occupied' | 'reserved' | 'maintenance'

export interface Unit {
  _id: string
  unitNumber: string
  unitType: UnitType
  status: UnitStatus
  notes?: string
}

export interface Customer {
  _id: string
  fullName: string
  email?: string
  phone?: string
  emergencyNumber?: string
  address?: string
  company?: string
  notes?: string
  createdAt?: string
}

export type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'ended' | 'cancelled'

export interface Contract {
  _id: string
  contractNo: string
  customer: Customer
  unit: Unit
  billingPeriod: 'weekly' | 'monthly'
  rate: number
  deposit: number
  startDate: string
  endDate: string
  autoRenew: boolean
  status: ContractStatus
  zohoRequestId?: string
  signedDocUrl?: string
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
  bySize: { sizeSqf: number; total: number; available: number; occupied: number }[]
  occupancyPct: number
  activeContracts: number
  revenueThisMonth: number
  expectedThisMonth: number
  expiringContracts: Contract[]
  overduePayments: Payment[]
}
