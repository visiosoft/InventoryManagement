export type Merchant = {
  _id: string
  name: string
  shopDomain: string
  apiVersion: string
  authMode: 'static_token' | 'client_credentials'
  clientId: string
  site: string
  warehouse: string
  isActive: boolean
  shopifyLocationId: string
  shopifyLocationName: string
  inventorySyncEnabled: boolean
  lastInventoryPushAt: string | null
  lastInventoryPushError: string
  webhooksRegisteredAt: string | null
  lastInventorySyncAt: string | null
  lastOrderWebhookAt: string | null
  createdAt: string
}

export type ShopifyLocation = { id: string; name: string; fulfillsOnlineOrders: boolean; place: string }
export type ConnectInfo = { scopes: string[]; webhookUrl: string; apiVersion: string }

export type OrderSummary = {
  _id: string
  shopifyOrderId: string
  shopifyOrderName: string
  financialStatus: string
  shippingAddress?: { name?: string; city?: string; country?: string; phone?: string }
}

/** Shopify order IDs made by the test-order tool start with this. */
export const isTestOrder = (order: OrderSummary | string | null | undefined) =>
  typeof order === 'object' && !!order && order.shopifyOrderId.startsWith('MANUAL-')

export type Sku = {
  _id: string
  merchant: string
  shopifyProductId: string
  shopifyVariantId: string
  sku: string
  productTitle: string
  variantTitle: string
  barcode: string
  defaultLocation: string | null
  active: boolean
  onHand: number
  reserved: number
  available: number
}

export const FULFILLMENT_STATES = [
  'AWAITING_STOCK', 'READY_TO_PICK', 'PICKING', 'PICKED', 'PACKED', 'SHIPPED',
  'PARTIAL_BACKORDER', 'CANCELLED',
] as const
export type FulfillmentStatus = typeof FULFILLMENT_STATES[number]

export type FulfillmentLine = {
  sku: Sku | string
  ordered: number
  picked: number
  reserved: number
  pickLocationHint: { _id: string; displayCode: string; name: string } | string | null
}

export type FulfillmentJob = {
  _id: string
  merchant: { _id: string; name: string; shopDomain: string } | string
  shopifyOrder: OrderSummary | string
  site: string
  warehouse: string
  status: FulfillmentStatus
  lines: FulfillmentLine[]
  assignedWorker?: { _id: string; name: string } | string | null
  carrier: string
  trackingNumber: string
  shippedAt: string | null
  shopifyFulfillmentId: string
  shopifyPushFailedAt: string | null
  shopifyPushError: string
  backorderNote: string
  createdAt: string
}

export const statusLabel = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase())

export const statusTone: Record<FulfillmentStatus, string> = {
  AWAITING_STOCK: 'bg-zinc-100 text-zinc-600',
  READY_TO_PICK: 'bg-sky-50 text-sky-800',
  PICKING: 'bg-sky-50 text-sky-800',
  PICKED: 'bg-indigo-50 text-indigo-800',
  PACKED: 'bg-indigo-50 text-indigo-800',
  SHIPPED: 'bg-emerald-50 text-emerald-800',
  PARTIAL_BACKORDER: 'bg-amber-50 text-amber-800',
  CANCELLED: 'bg-zinc-100 text-zinc-500',
}
