export type Location = { _id: string; displayCode: string; name: string; warehouse: string; site: string; kind: string; parent?: string; maxContainers: number | null; maxWeight: number | null; maxVolume: number | null; usedContainers: number; usedWeight: number; usedVolume: number }
export type CustomerRef = { _id: string; fullName: string; clientId: string; phone?: string; address?: string }
export type WarehouseJob = { _id: string; type: 'PICKUP' | 'DELIVERY'; site: string; warehouse: string; customer: CustomerRef | string; address: string; notes: string; partnerName: string; partnerPhone: string; status: 'REQUESTED' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED'; containers: string[]; createdAt: string; completedAt?: string | null }
export const jobTypes = ['PICKUP', 'DELIVERY'] as const
export type Booking = { _id: string; contractNo: string; unit?: { _id: string; unitNumber: string }; units?: { _id: string; unitNumber: string }[]; status: string }
export type Container = { _id: string; displayCode: string; type: string; customer: CustomerRef | string; booking?: Booking | string; currentStatus: string; currentLocation: Location | string | null; description: string; contents: string; condition: string; warehouse: string; weight: number | null; length: number | null; width: number | null; height: number | null; volume: number | null; photoCount: number; storedAt?: string; createdAt: string; photos?: { _id: string }[]; nextAction?: string }
export type ScanResult = { recognized: boolean; objectType?: string; container?: Container; location?: Location; nextAction?: string; message?: string }
export type ScanCommand = { requestId: string; barcode: string; action: 'INSPECT' | 'RECEIVE' | 'PUTAWAY' | 'RELOCATE' | 'DISPATCH'; locationBarcode?: string; notes?: string; deviceId: string }
export type PendingScan = { command: ScanCommand; error?: string }
export const types = ['BOX', 'SUITCASE', 'BAG', 'FURNITURE', 'LOOSE_ITEM', 'PALLET', 'TOTE', 'DOCUMENT_BOX', 'OTHER']
export const locationTypes = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN', 'RECEIVING', 'PACKING', 'DISPATCH']
export const readable = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
export const numeric = (value: FormDataEntryValue | null) => value === '' || value === null ? null : Number(value)
