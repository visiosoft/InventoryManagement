import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { statusLabel } from '../../lib/shopify'
import type { FulfillmentStatus, Merchant, OrderSummary } from '../../lib/shopify'

type OrderRow = OrderSummary & {
  merchant: { _id: string; name: string } | string
  receivedAt: string
  cancelledAt: string | null
  shippingAddress?: OrderSummary['shippingAddress'] & { address1?: string; address2?: string; province?: string; zip?: string }
  lineItems: { sku: string; title: string; quantity: number; fulfillableQuantity: number }[]
  job: {
    _id: string
    status: FulfillmentStatus
    carrier: string
    trackingNumber: string
    shippedAt: string | null
    shopifyFulfillmentId: string
    shopifyPushFailedAt: string | null
    backorderNote: string
  } | null
}
type OrdersPage = { orders: OrderRow[]; total: number; page: number; pages: number; limit: number }

const VIEWS = [
  { value: '', label: 'All orders' },
  { value: 'open', label: 'To fulfil' },
  { value: 'backorder', label: 'Backorders' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'cancelled', label: 'Cancelled' },
]

const jobTone = (status?: FulfillmentStatus) =>
  !status ? 'gray' : status === 'SHIPPED' ? 'green' : status === 'PARTIAL_BACKORDER' ? 'amber' : status === 'CANCELLED' ? 'gray' : 'blue'

const paymentTone = (s: string) => (s === 'paid' ? 'green' : s === 'pending' ? 'amber' : ['refunded', 'voided'].includes(s) ? 'red' : 'gray')

const itemCount = (o: OrderRow) => o.lineItems.reduce((n, li) => n + li.quantity, 0)

function OrderDetail({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  const a = order.shippingAddress
  const job = order.job
  return (
    <Modal open title={`Order ${order.shopifyOrderName}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {job ? <Badge tone={jobTone(job.status)}>{statusLabel(job.status)}</Badge> : <Badge>No fulfillment job</Badge>}
          {order.financialStatus && <Badge tone={paymentTone(order.financialStatus)}>Payment {order.financialStatus.replaceAll('_', ' ')}</Badge>}
          {order.cancelledAt && <Badge tone="red">Cancelled in Shopify</Badge>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Ship to</p>
            {a ? (
              <div className="text-sm leading-relaxed">
                <p className="font-medium">{a.name}</p>
                <p>{[a.address1, a.address2].filter(Boolean).join(', ')}</p>
                <p>{[a.city, a.province, a.zip].filter(Boolean).join(', ')}</p>
                <p>{a.country}</p>
                {a.phone && <p className="text-muted-foreground">{a.phone}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">No shipping address</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Received</p>
            <p className="text-sm">{new Date(order.receivedAt).toLocaleString()}</p>
            {typeof order.merchant === 'object' && <p className="text-sm text-muted-foreground">{order.merchant.name}</p>}
            {job?.trackingNumber && (
              <>
                <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">Shipment</p>
                <p className="text-sm">{job.carrier} · {job.trackingNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {job.shopifyFulfillmentId ? 'Customer notified by Shopify' : job.shopifyPushFailedAt ? 'Not yet sent to Shopify — retrying' : ''}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border divide-y">
          {order.lineItems.map((li, i) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{li.title}</p>
                <p className="text-xs text-muted-foreground">{li.sku || 'No SKU code'}</p>
              </div>
              <span className="tabular-nums">× {li.quantity}</span>
            </div>
          ))}
        </div>

        {job?.backorderNote && <p className="text-xs text-amber-800">{job.backorderNote}</p>}

        {job && (
          <div className="flex justify-end">
            <Link to={`/shopify/fulfillment?job=${job._id}`}>
              <Button>Open in fulfillment queue</Button>
            </Link>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function ShopifyOrders() {
  const [merchant, setMerchant] = useState('')
  const [view, setView] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data: merchants } = useQuery<Merchant[]>({
    queryKey: ['shopify-merchants-picker'],
    queryFn: () => api.get('/shopify/merchants').then(r => r.data),
    retry: false,
  })
  const { data, isLoading } = useQuery<OrdersPage>({
    queryKey: ['shopify-orders', merchant, view, search, page, limit],
    queryFn: () => api.get('/shopify/orders', { params: { merchant: merchant || undefined, view: view || undefined, search: search || undefined, page, limit } }).then(r => r.data),
    refetchInterval: 30_000,
  })
  const open = data?.orders.find(o => o._id === openId) ?? null
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader title="Shopify orders" subtitle="Every order connected stores have sent, and where it is in fulfillment." />
      <div className="flex flex-wrap gap-3">
        {(merchants?.length ?? 0) > 1 && (
          <Select value={merchant} onChange={e => reset(setMerchant)(e.target.value)} className="max-w-xs">
            <option value="">All merchants</option>
            {merchants!.map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
          </Select>
        )}
        <Select value={view} onChange={e => reset(setView)(e.target.value)} className="max-w-xs">
          {VIEWS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </Select>
        <Input value={search} onChange={e => reset(setSearch)(e.target.value)} placeholder="Order #, customer, phone, product…" className="max-w-xs" />
      </div>

      {isLoading ? <Spinner /> : !data?.orders.length ? (
        <EmptyState message={search || view ? 'No orders match.' : 'No orders yet. New Shopify orders appear here within minutes.'} />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <thead>
              <tr><Th>Order</Th><Th>Date</Th><Th>Customer</Th><Th>Items</Th><Th>Payment</Th><Th>Fulfillment</Th><Th>Tracking</Th></tr>
            </thead>
            <tbody>
              {data.orders.map(o => (
                <tr key={o._id} onClick={() => setOpenId(o._id)} className="cursor-pointer hover:bg-muted/40">
                  <Td className="font-medium">
                    {o.shopifyOrderName}
                    {typeof o.merchant === 'object' && (merchants?.length ?? 0) > 1 && <div className="text-xs text-muted-foreground">{o.merchant.name}</div>}
                  </Td>
                  <Td className="text-sm text-muted-foreground whitespace-nowrap">{new Date(o.receivedAt).toLocaleDateString()}</Td>
                  <Td>
                    <div className="text-sm">{o.shippingAddress?.name || '—'}</div>
                    {o.shippingAddress?.city && <div className="text-xs text-muted-foreground">{o.shippingAddress.city}</div>}
                  </Td>
                  <Td className="text-sm">
                    <div className="max-w-[260px] truncate" title={o.lineItems.map(li => `${li.title} ×${li.quantity}`).join(', ')}>
                      {o.lineItems[0]?.title}{o.lineItems.length > 1 ? ` +${o.lineItems.length - 1} more` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">{itemCount(o)} unit{itemCount(o) === 1 ? '' : 's'}</div>
                  </Td>
                  <Td>{o.financialStatus ? <Badge tone={paymentTone(o.financialStatus)}>{o.financialStatus.replaceAll('_', ' ')}</Badge> : '—'}</Td>
                  <Td>{o.job ? <Badge tone={jobTone(o.job.status)}>{statusLabel(o.job.status)}</Badge> : <Badge>{o.cancelledAt ? 'Cancelled' : 'Not queued'}</Badge>}</Td>
                  <Td className="text-sm text-muted-foreground">{o.job?.trackingNumber ? `${o.job.carrier} · ${o.job.trackingNumber}` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={setPage} onLimit={l => { setLimit(l); setPage(1) }} />
        </div>
      )}

      {open && <OrderDetail order={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
